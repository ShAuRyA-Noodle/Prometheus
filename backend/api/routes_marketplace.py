"""Marketplace: paid human reviews (lawyer / brand / cfo)."""
from __future__ import annotations

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ._dependencies import get_current_user

router = APIRouter(prefix="/marketplace", tags=["marketplace"])
log = structlog.get_logger("api.marketplace")


_PRICING_USD: dict[str, float] = {
    "lawyer_review": 199.0,
    "brand_polish": 149.0,
    "cfo_review": 249.0,
}


class OrderRequest(BaseModel):
    job_type: str = Field(..., pattern=r"^(lawyer_review|brand_polish|cfo_review)$")
    company_id: str
    notes: str | None = Field(default=None, max_length=2000)


class OrderResponse(BaseModel):
    job_id: str
    job_type: str
    price_usd: float
    checkout_url: str
    status: str


@router.post(
    "/order",
    response_model=OrderResponse,
    summary="Create a marketplace job (lawyer/brand/cfo) — returns Stripe checkout URL.",
)
async def create_order(
    payload: OrderRequest,
    user=Depends(get_current_user),
) -> OrderResponse:
    from services import billing_service, firestore_service

    price = _PRICING_USD[payload.job_type]

    create_job = getattr(firestore_service, "create_marketplace_job", None)
    if not callable(create_job):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={"code": "NOT_IMPLEMENTED", "message": "marketplace not wired"},
        )

    create_one_off = getattr(billing_service, "create_marketplace_checkout", None)
    if not callable(create_one_off):
        raise HTTPException(
            status_code=status.HTTP_501_NOT_IMPLEMENTED,
            detail={"code": "NOT_IMPLEMENTED", "message": "billing.marketplace not wired"},
        )

    job_id: str = await create_job(
        uid=user.uid,
        company_id=payload.company_id,
        job_type=payload.job_type,
        session_id=None,
        status="pending_payment",
    )
    if not job_id:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "JOB_CREATION_FAILED", "message": "marketplace job unavailable"},
        )

    checkout = await create_one_off(
        uid=user.uid,
        email=user.email,
        job_id=job_id,
        amount_usd=price,
        description=f"PROMETHEUS Marketplace — {payload.job_type}",
    )

    return OrderResponse(
        job_id=job_id,
        job_type=payload.job_type,
        price_usd=price,
        checkout_url=getattr(checkout, "url", None) or checkout["url"],
        status="awaiting_payment",
    )
