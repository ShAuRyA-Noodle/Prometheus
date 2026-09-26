"""FastAPI gateway entrypoint.

Middleware order (outer → inner):
    ObservabilityMiddleware
    InputSanitizationMiddleware
    AuthMiddleware
    RateLimitMiddleware
    IdempotencyMiddleware
    CostGuardMiddleware

Routes:
    /health, /          — public, no auth
    /api/...            — protected (JSON API)
    /sse/sessions/{id}  — SSE stream
    /internal/run       — Cloud Tasks worker entry (OIDC)

Errors are mapped to JSON `{code, message, request_id}`. PrometheusError
subclasses become 4xx/5xx based on their `code`.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

import structlog
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse, ORJSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from api import build_api_router
from api.routes_internal import router as internal_router
from api.sse import router as sse_router
from config import settings
from errors import (
    AgentSafetyBlocked,
    CostBudgetExceeded,
    GateRejectedError,
    PrometheusError,
    RateLimited,
    Unauthorized,
)
from logging_setup import configure_logging
from middleware import (
    AuthMiddleware,
    CostGuardMiddleware,
    IdempotencyMiddleware,
    InputSanitizationMiddleware,
    ObservabilityMiddleware,
    RateLimitMiddleware,
)
from models.response_models import HealthResponse
from workers.retention_worker import router as retention_router

log = structlog.get_logger("main")


# ─── lifespan ────────────────────────────────────────────────────────────────


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    configure_logging()
    log.info("app.startup", env=settings.env, project=settings.google_cloud_project)

    # Firebase Admin
    try:
        import firebase_admin
        from firebase_admin import credentials

        if not firebase_admin._apps:
            cred = None
            if settings.google_application_credentials and os.path.exists(
                settings.google_application_credentials
            ):
                cred = credentials.Certificate(settings.google_application_credentials)
            firebase_admin.initialize_app(
                cred,
                options={"projectId": settings.firebase_project_id},
            )
        log.info("app.firebase_initialized")
    except Exception as e:  # noqa: BLE001
        log.warning("app.firebase_init_failed", err=str(e))

    # OpenTelemetry — Cloud Trace exporter (skip in tests / when no project).
    if settings.env != "dev" or os.environ.get("OTEL_ENABLED") == "1":
        try:
            from opentelemetry import trace
            from opentelemetry.exporter.cloud_trace import CloudTraceSpanExporter
            from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
            from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
            from opentelemetry.sdk.resources import Resource
            from opentelemetry.sdk.trace import TracerProvider
            from opentelemetry.sdk.trace.export import BatchSpanProcessor

            provider = TracerProvider(
                resource=Resource.create(
                    {
                        "service.name": "prometheus-backend",
                        "service.version": "2.0.0",
                        "deployment.environment": settings.env,
                    }
                )
            )
            provider.add_span_processor(
                BatchSpanProcessor(CloudTraceSpanExporter(project_id=settings.google_cloud_project))
            )
            trace.set_tracer_provider(provider)
            FastAPIInstrumentor.instrument_app(app)
            HTTPXClientInstrumentor().instrument()
            log.info("app.otel_initialized")
        except Exception as e:  # noqa: BLE001
            log.warning("app.otel_init_failed", err=str(e))

    # Warm gRPC clients lazily — no eager connection here. Firestore / Tasks
    # clients are created on first use to keep cold start fast.

    yield

    log.info("app.shutdown")


# ─── app factory ─────────────────────────────────────────────────────────────


def create_app() -> FastAPI:
    configure_logging()

    app = FastAPI(
        title="PROMETHEUS API",
        version="2.0.0",
        description="Multi-agent startup-in-a-box.",
        default_response_class=ORJSONResponse,
        lifespan=lifespan,
        docs_url="/docs" if settings.env != "prod" else None,
        redoc_url="/redoc" if settings.env != "prod" else None,
        openapi_url="/openapi.json" if settings.env != "prod" else None,
    )

    # ── Trust proxy (Cloud Run terminates TLS, sets X-Forwarded-*).
    app.add_middleware(
        ProxyHeadersMiddleware,
        trusted_hosts="*" if settings.env == "dev" else "169.254.169.254,10.0.0.0/8,127.0.0.1",
    )

    # ── TrustedHost (only in non-dev).
    if settings.env != "dev":
        app.add_middleware(
            TrustedHostMiddleware,
            allowed_hosts=[
                "*.run.app",
                "api.prometheus.app",
                "prometheus.app",
                "localhost",
            ],
        )

    # ── CORS (must be added BEFORE custom middlewares so preflight is handled).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins_list,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "authorization",
            "content-type",
            "idempotency-key",
            "x-request-id",
            "stripe-signature",
        ],
        expose_headers=["x-request-id", "x-quota-warning", "x-quota-used", "x-quota-cap"],
        max_age=600,
    )

    # ── App middleware stack. Starlette runs these LIFO (last-added is outermost).
    # We want OUTERMOST = ObservabilityMiddleware so request_id is set first.
    app.add_middleware(CostGuardMiddleware)
    app.add_middleware(IdempotencyMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(AuthMiddleware)
    app.add_middleware(InputSanitizationMiddleware)
    app.add_middleware(ObservabilityMiddleware)

    # ── Routes.
    @app.get("/health", response_model=HealthResponse, tags=["meta"])
    async def health() -> HealthResponse:
        return HealthResponse(
            ok=True,
            env=settings.env,
            version="2.0.0",
            git_sha=os.environ.get("GIT_SHA"),
        )

    @app.get("/", include_in_schema=False)
    async def root() -> dict:
        return {"name": "PROMETHEUS", "env": settings.env, "version": "2.0.0"}

    app.include_router(build_api_router(), prefix="/api")
    app.include_router(sse_router)
    app.include_router(internal_router)
    app.include_router(retention_router)

    # ── Error handlers.
    _install_error_handlers(app)
    return app


# ─── error handlers ──────────────────────────────────────────────────────────


_PROMETHEUS_HTTP_MAP: dict[type[PrometheusError], int] = {
    Unauthorized: 401,
    AgentSafetyBlocked: 422,
    CostBudgetExceeded: 402,
    RateLimited: 429,
    GateRejectedError: 422,
}


def _install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(PrometheusError)
    async def prometheus_error_handler(request: Request, exc: PrometheusError) -> JSONResponse:
        status_code = _PROMETHEUS_HTTP_MAP.get(type(exc), 500)
        return JSONResponse(
            status_code=status_code,
            content={
                "code": exc.code,
                "message": str(exc) or exc.code,
                "request_id": getattr(request.state, "request_id", None),
            },
        )

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        rid = getattr(request.state, "request_id", None)
        # If the route raised HTTPException(detail={...}) we want to surface that shape
        # while still adding request_id.
        if isinstance(exc.detail, dict):
            payload = {**exc.detail}
            payload.setdefault("code", "HTTP_ERROR")
            payload.setdefault("message", str(exc.detail.get("message") or exc.detail))
            payload["request_id"] = rid
        else:
            payload = {
                "code": "HTTP_ERROR",
                "message": exc.detail if isinstance(exc.detail, str) else "http error",
                "request_id": rid,
            }
        return JSONResponse(status_code=exc.status_code, content=payload, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "code": "VALIDATION_ERROR",
                "message": "request validation failed",
                "request_id": getattr(request.state, "request_id", None),
                # Pydantic errors can contain the submitted value and exception
                # objects in `input`/`ctx`. Do not echo or log idea text here.
                "errors": [{"type": error["type"], "loc": error["loc"]} for error in exc.errors()],
            },
        )

    @app.exception_handler(Exception)
    async def unhandled(request: Request, exc: Exception) -> JSONResponse:
        log.exception("unhandled.exception", path=request.url.path)
        return JSONResponse(
            status_code=500,
            content={
                "code": "INTERNAL_ERROR",
                "message": "internal server error",
                "request_id": getattr(request.state, "request_id", None),
            },
        )


# ─── ASGI entry ──────────────────────────────────────────────────────────────


app = create_app()


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",  # noqa: S104
        port=int(os.environ.get("PORT", "8080")),
        reload=settings.env == "dev",
        proxy_headers=True,
        forwarded_allow_ips="*",
        log_level=settings.log_level.lower(),
    )
