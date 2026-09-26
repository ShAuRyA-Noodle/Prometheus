# PROMETHEUS — Architecture Deep Dive

> **Tagline:** "The orchestration is the product. This document is how it works."

---

## 0. How to read this document

This doc is the **visual ground truth** for V2 architecture. Every flow has an ASCII diagram + sequence detail + latency annotation + failure mode. If a future change to the codebase contradicts a diagram here, **update the diagram first** in the same PR (CI gate enforces this if `backend/agents/orchestrator.py` or `backend/api/*` changed).

Sections:
1. Component map
2. Full pipeline run (request → enqueue → orchestrate → SSE → completion → email)
3. Branch creation
4. Deployment with domain purchase
5. Weekly retention diff cron
6. Marketplace job lifecycle
7. Stripe webhook flow
8. Failure injection points + recovery

---

## 1. Component Map (V2)

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                                CLIENT LAYER                                         │
│  React 18 + TS 5 strict + Tailwind v4 + Framer Motion + Firebase Web SDK + Vite    │
│                                                                                      │
│  ┌─────────────────────┐   ┌─────────────────────┐   ┌──────────────────────────┐  │
│  │ Voice / Text input  │   │ Streaming sidebar   │   │ Progressive canvas        │  │
│  │ (Deepgram Nova-2 +  │   │ (custom SSE hook)   │   │ + In-app editors          │  │
│  │  Web Speech API)    │   │                      │   │ (Tiptap, Recharts, Monaco)│  │
│  └──────────┬──────────┘   └──────────────────────┘   └───────────────────────────┘  │
└─────────────┼────────────────────────────────────────────────────────────────────────┘
              │ HTTPS  Idempotency-Key + Firebase JWT
              │
              │  edge: Cloud Armor (OWASP CRS, rate limit, geofence, reCAPTCHA)
              ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                          GATEWAY  (Cloud Run, FastAPI)                              │
│   2 vCPU · 1 GiB · min=1 max=20 · concurrency=80 · ingress=internal-and-LB         │
│                                                                                      │
│   Middleware stack (ordered):                                                       │
│   ┌────────────────────────────────────────────────────────────────────────────┐   │
│   │ RequestId → CORS → SizeLimit(32KB) → Auth(Firebase JWT) → Idempotency      │   │
│   │ → RateLimit(uid+IP) → Safety(VertexAI) → CostBudget → OTel → Route         │   │
│   └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
│   Routes:                                                                           │
│     POST  /api/generate           — main entry; enqueues Cloud Task                │
│     GET   /api/session/{id}       — session state                                   │
│     GET   /api/session/{id}/stream — SSE bridge over Firestore events              │
│     POST  /api/session/{id}/regen  — single-agent regen with steering              │
│     POST  /api/session/{id}/branch — fork run                                       │
│     POST  /api/session/{id}/export — Workspace OAuth + drive.file create           │
│     POST  /api/session/{id}/deploy — Cloudflare Pages publish                       │
│     /api/billing/*                 — Stripe webhooks + Customer Portal              │
│     /api/me/*                      — DSAR + account                                 │
│     /healthz, /readyz                                                                │
└──────────┬───────────────────────────────────────────────────────────────────────────┘
           │ Cloud Tasks (HTTPS, OIDC-signed)
           │ Queue: prometheus-pipeline (min-backoff 10s, max-backoff 60s, max-attempts 5)
           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│                        WORKER  (Cloud Run, FastAPI)                                 │
│   4 vCPU · 4 GiB · min=0 max=50 · concurrency=4 · no-cpu-throttling                │
│   ingress=internal · no-allow-unauthenticated                                       │
│                                                                                      │
│   POST /internal/run  — verifies OIDC, runs orchestrator                            │
│                                                                                      │
│   ORCHESTRATOR  (backend/agents/orchestrator.py)                                    │
│   ┌────────────────────────────────────────────────────────────────────────────┐   │
│   │  Pre-Wave   ┃ idea_parser → articulation                                    │   │
│   │  Wave 1     ┃ ParallelAgent[market, competitive, business, brand,          │   │
│   │             ┃                risk, tech]                                     │   │
│   │  Gate 1     ┃ schema + Vertex Safety + USPTO + Domainr + WCAG              │   │
│   │  Wave 2     ┃ ParallelAgent[financial, landing, legal, gtm]                 │   │
│   │  Gate 2     ┃ schema + reconciliation + HTML sanitize + safety             │   │
│   │  Wave 3     ┃ ParallelAgent[pitch_deck, executive_summary]                  │   │
│   │  Gate 3     ┃ schema + coherence_score + cross-artifact name check         │   │
│   └────────────────────────────────────────────────────────────────────────────┘   │
│                                                                                      │
│   Each agent uses gemini_client.call_structured(response_schema=Pydantic)           │
│   + retry-once on validation, abort on safety block, cost telemetry per call.       │
└──────────┬───────────────────────────────────────────────────────────────────────────┘
           │ Firestore writes (session, agent_outputs, events)
           │ External calls: Gemini, Vertex Safety, Imagen, USPTO, Domainr,
           │                 Crunchbase, Statista, Termly/iubenda, Workspace
           ▼
┌──────────────────────────────────────────────────────────────────────────────────┐
│  FIRESTORE (regional us-central1, EU mirror for eu users)                           │
│   users/{uid}/companies/{cid}/branches/{bid}/runs/{rid}                             │
│       ├── (Session model fields)                                                    │
│       ├── agent_outputs/{agent_name}                                                │
│       ├── events/{event_id} (TTL 7d, SSE feed)                                      │
│       └── outbox/{event_id} (TTL 24h after processed)                               │
│   idempotency_keys/{key} (TTL 24h)                                                   │
│   share_tokens/{token}                                                              │
│   billing_events/{stripe_event_id}                                                  │
│   caches/{integration}/{hash} (per-integration TTL)                                 │
└──────────┬───────────────────────────────────────────────────────────────────────────┘
           │
   ┌───────┴───────┬─────────────────┬─────────────────┬─────────────────┬──────────┐
   ▼               ▼                 ▼                 ▼                 ▼          ▼
┌─────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  ┌─────┐
│Workspace│  │ Cloudflare    │  │ Stripe        │  │ Resend / FCM │  │ Cloud    │  │PostHg│
│Slides + │  │ Workers/Pages │  │ + Connect     │  │ email/push    │  │ Functions│  │analy │
│Docs +   │  │ + Registrar   │  │ + Atlas (Y2)  │  │               │  │ (cron,  │  │tics  │
│Sheets   │  │ deploy + DNS  │  │               │  │               │  │ outbox) │  │      │
└─────────┘  └──────────────┘  └──────────────┘  └──────────────┘  └──────────┘  └─────┘
```

### Component sizing

| Component | vCPU | RAM | Min | Max | Concurrency | Purpose |
|---|---|---|---|---|---|---|
| Gateway | 2 | 1 GiB | 1 | 20 | 80 | Stateless, fast, ingress |
| Worker | 4 | 4 GiB | 0 | 50 | 4 | Orchestrator (CPU-bound on parallel waves) |
| Cron worker | 1 | 512 MiB | 0 | 1 | 1 | Weekly retention diff |
| Outbox processor (Cloud Function) | — | 256 MiB | — | 10 | — | Eventarc trigger on outbox writes |
| Budget kill-switch (Cloud Function) | — | 128 MiB | — | 1 | — | Pub/Sub trigger on budget alert |

---

## 2. Full Pipeline Run

> **Sequence: voice/text input → idempotency check → safety pre-filter → enqueue Cloud Task → worker claim → orchestrator → Pre-Wave → Wave 1 → Gate 1 → Wave 2 → Gate 2 → Wave 3 → Gate 3 → SSE events → Firestore writes → completion → email.**

### 2.1 Sequence diagram

```
User      Frontend     Gateway      Cloud Tasks   Worker     Firestore     Gemini    Workspace   Resend
│            │             │             │           │             │           │            │          │
│ speak/type │             │             │           │             │           │            │          │
│───────────▶│             │             │           │             │           │            │          │
│            │ Deepgram WS │             │           │             │           │            │          │
│            │             │             │           │             │           │            │          │
│            │ POST /api/generate (Idempotency-Key + JWT)            │           │            │          │
│            │────────────▶│             │           │             │           │            │          │
│            │             │ verifyJWT   │           │             │           │            │          │
│            │             │ idempotKey  │           │             │           │            │          │
│            │             │ safetyChk   │ <-(VertexAI Safety)──────────────────│            │          │
│            │             │ rateLimit   │           │             │           │            │          │
│            │             │ costBudget  │           │             │           │            │          │
│            │             │ create Sess │──────────write─────────▶│           │            │          │
│            │             │             │           │             │           │            │          │
│            │             │ enqueue ────▶│           │             │           │            │          │
│            │  202 + sid  │             │           │             │           │            │          │
│            │◀────────────│             │           │             │           │            │          │
│            │             │             │           │             │           │            │          │
│            │ GET /api/session/{sid}/stream (SSE)                    │           │            │          │
│            │────────────▶│             │           │             │           │            │          │
│            │             │ onSnapshot  │ ◀────────────────────────│           │            │          │
│            │  SSE: open  │             │           │             │           │            │          │
│            │◀────────────│             │           │             │           │            │          │
│            │             │             │           │             │           │            │          │
│            │             │             │ POST /internal/run (OIDC)│           │            │          │
│            │             │             │──────────▶│             │           │            │          │
│            │             │             │           │ verify OIDC │           │            │          │
│            │             │             │           │ load Sess ◀─────────────│           │            │          │
│            │             │             │           │             │           │            │          │
│            │             │             │           │  ┌─ Pre-Wave (5s) ─┐    │            │          │
│            │             │             │           │  │ idea_parser     │────▶│            │          │
│            │             │             │           │  │ articulation    │────▶│            │          │
│            │             │             │           │  └─────────────────┘    │            │          │
│            │             │             │           │   write events ────────▶│           │            │          │
│            │ SSE: pre-wave events       │           │             │           │            │          │
│            │◀────────────│             │           │             │           │            │          │
│            │             │             │           │  ┌─ Wave 1 parallel ×6 (~28s) ─┐                  │
│            │             │             │           │  │ market+ground   │────▶│            │          │
│            │             │             │           │  │ competitive     │────▶│            │          │
│            │             │             │           │  │ business        │────▶│            │          │
│            │             │             │           │  │ brand+USPTO+Dom │────▶│ + USPTO/Domainr        │
│            │             │             │           │  │ risk            │────▶│            │          │
│            │             │             │           │  │ tech            │────▶│            │          │
│            │             │             │           │  └─────────────────┘    │            │          │
│            │             │             │           │   write outputs ───────▶│           │            │          │
│            │ SSE: wave1 brand card etc │           │             │           │            │          │
│            │             │             │           │  Gate 1 (~1.2s) — schema+safety+USPTO+WCAG       │
│            │             │             │           │  ─if fail→ status PARTIAL, downstream SKIPPED ─  │
│            │             │             │           │             │           │            │          │
│            │             │             │           │  ┌─ Wave 2 parallel ×4 (~22s) ─┐                  │
│            │             │             │           │  │ financial+engine│────▶│            │          │
│            │             │             │           │  │ landing+sanitize│────▶│            │          │
│            │             │             │           │  │ legal_template  │────▶│ Termly/iubenda          │
│            │             │             │           │  │ gtm             │────▶│            │          │
│            │             │             │           │  └─────────────────┘    │            │          │
│            │             │             │           │   write outputs ───────▶│           │            │          │
│            │             │             │           │  Gate 2 (~1.0s)         │            │          │
│            │             │             │           │  ┌─ Wave 3 parallel ×2 (~22s) ─┐                  │
│            │             │             │           │  │ pitch_deck+slides│───▶│ + Slides API           │
│            │             │             │           │  │ executive summary│───▶│            │          │
│            │             │             │           │  └─────────────────┘    │            │          │
│            │             │             │           │  Gate 3 (~0.8s)         │            │          │
│            │             │             │           │  status=COMPLETED ─────▶│           │            │          │
│            │             │             │           │  outbox event ─────────▶│           │            │          │
│            │             │             │ 200       │             │           │            │          │
│            │             │             │◀──────────│             │           │            │          │
│            │ SSE: complete                │           │             │           │            │          │
│            │◀────────────│             │           │             │           │            │          │
│            │             │             │  Eventarc trigger on outbox/{evt}    │            │          │
│            │             │             │   ─Cloud Function─▶ Resend send "Your run is ready"────────▶│
│            │  email      │             │           │             │           │            │          │
│            │◀───────────────────────────────────────────────────────────────────────────────────────│
```

### 2.2 Data carried at each step

```
POST /api/generate (request body)
{
  "idea_text": "AI-native vital monitor for senior dogs ...",
  "locale": "en-US",
  "client_event_ts": "2026-05-11T07:42:18Z"
}
Headers:
  Authorization: Bearer <Firebase JWT>
  Idempotency-Key: 3e2b1f9d-...-uuidv4
  X-Request-Id: <generated by frontend or omit>
Response: 202 Accepted
{
  "session_id": "01J5Z3...",
  "company_id": "01J5Z2...",
  "branch_id": "main",
  "stream_url": "/api/session/01J5Z3.../stream"
}
```

### 2.3 Latency budget (p50 / p95)

| Stage | p50 | p95 |
|---|---|---|
| TLS + Cloud Armor | 50 ms | 120 ms |
| Auth + idempotency check | 80 ms | 200 ms |
| Vertex Safety pre-filter | 250 ms | 600 ms |
| Cost-budget check | 30 ms | 80 ms |
| Cloud Tasks enqueue | 100 ms | 300 ms |
| Worker pickup (cold start) | 0 ms (warm) / 800 ms (cold, min=0) | 1.5 s |
| Pre-Wave | 4.5 s | 7.5 s |
| Wave 1 | 18 s | 28 s |
| Gate 1 | 1.2 s | 2.5 s |
| Wave 2 | 14 s | 22 s |
| Gate 2 | 1.0 s | 2.0 s |
| Wave 3 | 22 s | 35 s |
| Gate 3 | 0.8 s | 1.5 s |
| Final write + outbox | 200 ms | 500 ms |
| Email send | async (300 ms median) | n/a |
| **Wall-clock total** | **~78 s** | **~120 s** |

### 2.4 Failure modes per stage

| Stage | Failure | Recovery |
|---|---|---|
| Auth | Firebase JWT expired | 401 with `WWW-Authenticate: Bearer` |
| Idempotency hit | Same key, same uid | 200 with existing `session_id` (no re-run) |
| Idempotency conflict | Same key, different body | 409 with `Idempotency-Key-Conflict` |
| Vertex Safety block | CSAM/weapons/etc. detected | 422 with category list, log hash |
| Rate limit | uid > 3/h or 20/d | 429 with `Retry-After` |
| Cost budget | tier exceeded | 402 with `Upgrade` link |
| Cloud Tasks enqueue | network blip | 503; client retry (idempotency safe) |
| Worker cold start > timeout | Cloud Tasks retries up to 5 with backoff | DLQ on attempt 5 |
| Agent validation (Pydantic) | JSON shape wrong | retry-once with error in re-prompt; if 2nd fails, agent → FAILED, gate decides |
| Gate fail | schema/safety/USPTO/WCAG | session → PARTIAL, downstream agents → SKIPPED |
| Gemini quota | global quota exhausted | circuit breaker; degraded mode (Flash-only); user banner |
| Imagen safety post-filter | NSFW output | fall back to gradient hero |
| Workspace API quota | per-user pacing | exponential backoff; fall back to local PPTX/DOCX/XLSX |

---

## 3. Branch Creation

> **Sequence: user clicks "branch" with steering note → backend forks state → enqueues new task → orchestrator runs only affected agents.**

```
User    Frontend    Gateway     Firestore      Cloud Tasks    Worker
 │        │            │            │               │            │
 │  click "branch" + note            │            │            │
 │───────▶│            │            │               │            │
 │        │ POST /api/session/{rid}/branch         │            │
 │        │  body: { steering: "pivot to enterprise" }            │
 │        │───────────▶│            │               │            │
 │        │            │ load run, copy {Pre-Wave, Wave1 frozen} │
 │        │            │ create branches/{new_bid}              │
 │        │            │ runs/{new_rid}.steering = "pivot..."    │
 │        │            │────write──▶│              │            │
 │        │            │            │              │            │
 │        │            │ enqueue task with branch_id, steering   │
 │        │            │───────────────────────────▶│            │
 │   202 + new_rid     │            │              │            │
 │        │◀───────────│            │              │            │
 │        │ GET stream/{new_rid}    │              │            │
 │                                                  │ pickup     │
 │                                                  │            │
 │                                                  │ load parent run state
 │                                                  │ run articulation with steering
 │                                                  │   prompt prefix:
 │                                                  │   "User has pivoted: pivot to enterprise"
 │                                                  │ run Wave 1 (ALL 6 agents — context changed)
 │                                                  │ Gate 1
 │                                                  │ Wave 2
 │                                                  │ Gate 2
 │                                                  │ Wave 3
 │                                                  │ Gate 3
 │                                                  │ COMPLETED
```

### 3.1 What gets re-run

By default, **every agent re-runs** on branch creation because the steering note can shift industry, target market, or pricing. Optimization for Year 2: agent-level dependency tracker may skip identical runs (deferred — V2 ships full re-run for safety).

### 3.2 Side-by-side compare UI

Frontend `BranchingView.tsx` queries both `runs/{parent_rid}` and `runs/{new_rid}`, renders all 13 agent cards side-by-side with diff highlights. Diff is structural (DataPoint by DataPoint), not text-diff — `competitive_analysis.competitors[0].name` either matches or doesn't.

---

## 4. Deployment with Domain Purchase

> **Sequence: user clicks "Deploy to my domain" → Stripe charges → Cloudflare Registrar buys domain → Cloudflare Pages publishes → DNS propagates.**

```
User    Frontend    Gateway     Stripe     Cloudflare Reg.  Cloudflare Pages   Firestore
 │        │            │           │              │                │              │
 │ pick domain "rotunda.vet" + click Deploy       │                │              │
 │───────▶│            │           │              │                │              │
 │        │ POST /api/session/{id}/deploy          │                │              │
 │        │   body: { domain: "rotunda.vet", payment_method_id }    │              │
 │        │───────────▶│           │              │                │              │
 │        │            │ check user tier ≥ Founder Pro              │              │
 │        │            │ check Stripe 3DS done    │                │              │
 │        │            │ Stripe charge $36 (incl. registrar markup) │              │
 │        │            │──────────▶│              │                │              │
 │        │            │ ◀── 200 OK│              │                │              │
 │        │            │           │              │                │              │
 │        │            │ Cloudflare Registrar API: register domain  │              │
 │        │            │────────────────────────────▶│              │              │
 │        │            │ ◀── domain registered (24h delay buffer)    │              │
 │        │            │           │              │                │              │
 │        │            │ Cloudflare Pages API: create project       │              │
 │        │            │   upload landing.html_sanitized + assets   │              │
 │        │            │───────────────────────────────────────────▶│              │
 │        │            │ ◀── Pages URL `prometheus-rotunda.pages.dev`              │
 │        │            │           │              │                │              │
 │        │            │ Cloudflare DNS: CNAME rotunda.vet → pages   │              │
 │        │            │────────────────────────────▶│              │              │
 │        │            │ ◀── DNS record created    │                │              │
 │        │            │           │              │                │              │
 │        │            │ outbox event: "deploy_completed" ─────────────────────────▶│
 │   202 + deploy_id   │           │              │                │              │
 │        │◀───────────│           │              │                │              │
 │        │  poll deploy status                                                    │
 │        │ GET /api/deploy/{id}                                                    │
```

### 4.1 Failure recovery

- **Domain unavailable** (race condition between availability check and registrar): Stripe refund; surface alternative
- **Stripe charge fails** (3DS, fraud): hold deploy, surface error
- **Pages publish fails** (CSP violation, asset 404): roll back; user keeps domain

---

## 5. Weekly Retention Diff Cron

> **Sequence: Cloud Scheduler triggers weekly → cron worker re-runs market + competitive for each watched company → diffs result → emails users with diff > threshold.**

```
Cloud Scheduler   Cron Worker   Firestore     Worker (orchestrator)   Resend
       │              │              │              │                  │
   weekly @ Sun 06:00 UTC            │              │                  │
       │──────────────▶│              │              │                  │
       │              │ query users/*/companies where watched=true     │
       │              │  AND (uid % 7 == today_day_of_week)            │
       │              │─────────────▶│              │                  │
       │              │ ◀── batch of 700 companies  │                  │
       │              │              │              │                  │
       │              │  for each company:                              │
       │              │  ┌───────────────────────────────┐              │
       │              │  │ kick "diff_run" Cloud Task    │              │
       │              │  │   that ONLY runs market +     │              │
       │              │  │   competitive agents          │              │
       │              │  └───────────────────────────────┘              │
       │              │              │              │                  │
       │              │              │              │ pickup           │
       │              │              │              │ run market+comp │
       │              │              │              │ write outputs   │
       │              │              │              │ compute diff vs. last week
       │              │              │              │  if abs(TAM diff) > 2%   │
       │              │              │              │  OR new competitor in    │
       │              │              │              │  top-10 SimilarWeb       │
       │              │              │              │ → outbox event          │
       │              │              │              │  type=watch_diff        │
       │              │              │              │                          │
       │              │              │ Eventarc → Cloud Function → Resend send │
       │              │              │              │                  │       │
   user inbox: "PROMETHEUS Wire — your watch report"                            │
```

### 5.1 Cost optimization

Cron only runs market + competitive (not the full pipeline). Per-company cost ~$0.18 (Pro grounded × 2). At 700 companies/week, $126/week = $546/month. Acceptable at M4 scale (3,500 Pro users × 70% opt-in × 7-day spread).

### 5.2 Throttling

`uid % 7 == day_of_week` spreads load across the week. Per-day batch is 100–200 companies. Cron worker uses a backoff if Cloud Tasks queue depth > 100.

---

## 6. Marketplace Job Lifecycle

> **Sequence: user posts brief → operators bid → user accepts → Stripe Connect escrow → operator delivers → user releases → Stripe Connect transfer.**

```
User   Frontend   Gateway    Stripe Connect   Operator   Firestore
 │       │            │            │              │            │
 │ "polish my deck for $400"                       │            │
 │──────▶│            │            │              │            │
 │       │ POST /api/marketplace/jobs (brief)     │            │
 │       │───────────▶│            │              │            │
 │       │            │ create marketplace_jobs/{jid}           │
 │       │            │────────────────────────────────────────▶│
 │       │            │ notify operators (matching category + rating)
 │       │            │              ─push/email──▶│            │
 │       │            │            │              │            │
 │       │            │            │ operator submits bid: $380, 3 days
 │       │            │ POST /api/marketplace/bids               │
 │       │            │ ◀────────────────────────│              │
 │       │            │ write bid                │              │
 │       │            │────────────────────────────────────────▶│
 │ user reviews bids; accepts $380 from "Maria"   │            │
 │       │ POST /api/marketplace/jobs/{jid}/accept              │
 │       │───────────▶│            │              │            │
 │       │            │ Stripe Connect: create PaymentIntent + escrow
 │       │            │──────────▶│              │            │
 │       │            │ ◀── PI authorized (held in PROMETHEUS escrow account)
 │       │            │            │              │            │
 │       │            │ job status = IN_PROGRESS                │
 │       │            │────────────────────────────────────────▶│
 │       │            │            │              │            │
 │       │            │            │ operator delivers (uploads .pptx, .pdf)
 │       │            │            │              ◀───────────│
 │       │            │ outbox: notify user                     │
 │ user reviews, releases funds                   │            │
 │       │ POST /api/marketplace/jobs/{jid}/release            │
 │       │───────────▶│            │              │            │
 │       │            │ Stripe Connect transfer to operator (80%)
 │       │            │ PROMETHEUS take (20%) booked            │
 │       │            │──────────▶│              │            │
 │       │            │ ◀── transfer ok│            │            │
 │       │            │ job status = COMPLETED                  │
 │       │            │────────────────────────────────────────▶│
```

### 6.1 Dispute path

User can dispute within 48 hours of release. Funds held longer (escrow extension); CS first responder reviews; if escalated, operator + user → arbitration (Stripe Connect dispute mechanism).

---

## 7. Stripe Webhook Flow

> **Sequence: Stripe event → webhook → signature verify → idempotency check → process → outbox.**

```
Stripe         Gateway              Firestore             Cloud Function (outbox)
   │                │                   │                            │
   │ event: invoice.payment_succeeded   │                            │
   │ POST /api/billing/webhook (sig)    │                            │
   │ ──────────────▶│                   │                            │
   │                │ verify signature  │                            │
   │                │ check idempotency:                             │
   │                │   billing_events/{stripe_event_id} exists?     │
   │                │     yes → 200 (no-op)                          │
   │                │     no  → write event (transactional)          │
   │                │ ─────write──────▶│                            │
   │                │                   │                            │
   │                │ process: update users/{uid}.plan_tier          │
   │                │ ─────write──────▶│                            │
   │                │                   │                            │
   │                │ outbox event: "plan_changed"                   │
   │                │ ─────write──────▶│                            │
   │   200 OK        │                   │                            │
   │ ◀──────────────│                   │                            │
   │                │                   │ Eventarc trigger ──────────▶
   │                │                   │                            │ Resend send "Plan upgraded"
```

### 7.1 Webhook events handled

| Event | Action |
|---|---|
| `customer.subscription.created` | set plan_tier, allocate quota |
| `customer.subscription.updated` | adjust plan_tier, re-allocate quota |
| `customer.subscription.deleted` | set plan_tier=whisper, cancel quota |
| `invoice.payment_succeeded` | confirm renewal, reset monthly counters |
| `invoice.payment_failed` | grace period 7 days, then downgrade |
| `charge.refunded` | partial refund accounting |
| `payment_intent.succeeded` | (Stripe Connect) marketplace escrow |
| `transfer.created` | marketplace operator payout |

### 7.2 Idempotency

Every Stripe event has a unique `stripe_event_id`. Firestore document write is conditional (`create` not `set`) — if the document exists, the webhook returns 200 immediately without re-processing.

---

## 8. Failure injection points + recovery

| Layer | Failure | Detection | Recovery |
|---|---|---|---|
| Edge | Cloud Armor blocks legit traffic | Monitor 4xx rate | Tune rule severity; allow-list |
| Auth | Firebase quota exhausted | 5xx spike | Failover to read-replica region |
| Gateway | Cloud Run cold start spike | p95 latency alarm | Bump min-instances |
| Cloud Tasks | DLQ depth > 0 | Alarm | Replay tool: `scripts/replay-dlq.sh` |
| Worker | OOM kill | Cloud Run incident | Increase RAM (current 4 GiB → 8 GiB) |
| Gemini | Quota exhausted | 429 from API | Multi-region failover; degraded mode (Flash-only) |
| Vertex Safety | API down | 5xx | Conservative deny by default; user banner |
| USPTO | API timeout | 5xx | Skip check; surface warning to user |
| Domainr | Rate limit | 429 | Cache-only mode; skip live check |
| Crunchbase | Outage | 5xx | Cache fallback (30d); fallback to grounded search |
| Imagen | NSFW post-filter | safety violation | Gradient hero fallback |
| Workspace | Quota | 429 | Per-user backoff; local PPTX export fallback |
| Termly | Outage | 5xx | iubenda fallback; if both fail, deliver template stubs + lawyer-review CTA |
| Stripe | Webhook signature mismatch | 400 | Reject; log; alert if rate > 1% |
| Cloudflare | Pages publish fail | 5xx | Retry; user keeps domain |
| Firestore | Quota | 429 | Exponential backoff; degrade reads to cache |
| Resend | Quota | 5xx | SendGrid fallback |

---

## 9. Observability

### 9.1 Trace spans

Every request emits an OpenTelemetry trace with the following spans:

```
gateway.request
├─ gateway.auth
├─ gateway.idempotency
├─ gateway.safety
├─ gateway.cost_budget
├─ gateway.enqueue
worker.run (linked via X-Trace-Id)
├─ worker.load_session
├─ orchestrator.pre_wave
│  ├─ agent.idea_parser
│  └─ agent.articulation
├─ orchestrator.wave_1
│  ├─ agent.market_research
│  │  ├─ external.gemini_pro_grounded
│  │  ├─ external.crunchbase
│  │  └─ external.statista
│  ├─ agent.competitive_analysis
│  ├─ agent.business_model
│  ├─ agent.brand_identity
│  │  ├─ external.uspto
│  │  ├─ external.domainr
│  │  └─ external.imagen
│  ├─ agent.risk_analysis
│  └─ agent.tech_architecture
├─ gate.gate_1
├─ orchestrator.wave_2
│  ├─ agent.financial_model
│  │  ├─ external.gemini_pro
│  │  └─ internal.finance_engine
│  ├─ agent.landing_page
│  │  ├─ external.gemini_flash
│  │  ├─ external.imagen × N
│  │  └─ internal.sanitization
│  ├─ agent.legal_documents
│  │  └─ external.termly
│  └─ agent.go_to_market
├─ gate.gate_2
├─ orchestrator.wave_3
│  ├─ agent.pitch_deck
│  └─ agent.executive_summary
└─ gate.gate_3
```

### 9.2 Metrics

| Metric | Type | Labels |
|---|---|---|
| `pipeline_duration_seconds` | histogram | tier, status |
| `agent_duration_seconds` | histogram | agent |
| `agent_cost_usd_total` | counter | agent |
| `gate_pass_rate` | gauge | gate |
| `safety_block_total` | counter | category |
| `idempotency_hit_total` | counter | — |
| `cost_per_session_usd` | histogram | tier |
| `pipeline_pass_rate` | gauge | — |
| `coherence_score_distribution` | histogram | — |
| `external_api_latency_seconds` | histogram | api |
| `firestore_writes_total` | counter | collection |

### 9.3 SLOs

| SLO | Target | Window |
|---|---|---|
| Gateway p95 latency | < 500 ms | rolling 28 d |
| Worker pipeline p95 | < 120 s | rolling 28 d |
| Pipeline pass rate | > 95% | rolling 7 d |
| Gate 1 pass rate | > 95% | rolling 7 d |
| Gate 3 pass rate | > 95% | rolling 7 d |
| Cost per session p95 | < $1.00 | rolling 28 d |
| Error rate (5xx) | < 1% | rolling 28 d |

---

## 10. Why these choices (decision log)

| Decision | Why | Considered alternatives |
|---|---|---|
| Gateway / Worker split | Long-running pipelines must not block the request thread; Cloud Tasks gives retry + DLQ for free | Single Cloud Run with background tasks (rejected: timeout + retry semantics fight) |
| Cloud Tasks not Pub/Sub | OIDC auth + at-least-once + retry semantics fit "task" model better | Pub/Sub (rejected: pull semantics + need DLQ infra anyway) |
| SSE not WebSocket | One-way server → client, simpler to scale, survives reconnects with `Last-Event-Id` | WebSocket (rejected: no two-way needed) |
| Firestore not Postgres | Real-time `onSnapshot` is the killer feature for the progressive canvas | Postgres (rejected: would need Realtime via Supabase or equivalent) |
| ADK + Gemini not LangChain | Native Google tooling, `response_schema` first-class, grounding-tool first-class | LangChain (rejected: schema validation is bolt-on; latency overhead) |
| Pydantic v2 not v1 | Forward compatibility; performance | Pydantic v1 (rejected: deprecated) |
| Tailwind v4 not v3 | Native PostCSS, faster, no JIT config | Tailwind v3 (rejected: legacy) |
| Tiptap not Slate | Better extension ecosystem; cleaner schema | Slate (rejected: more bespoke wiring) |
| Recharts not D3 | Declarative + React-idiomatic | D3 (rejected: imperative; slower iteration) |
| Termly + iubenda not LLM-drafted ToS | Legal liability; lawyer-review CTA | LLM (rejected: V1 audit hard finding) |
| Workload Identity Federation not service-account.json | Security; CLAUDE.md hard rule | service-account.json (rejected: leak surface) |
| `drive.file` not `drive` | Least-privilege; CLAUDE.md hard rule | full `drive` (rejected: over-permissioned) |
| nh3 + DOMPurify (defense in depth) | Server + client sanitize; single layer = single failure | DOMPurify only (rejected: server output reaches DOM only via client; safer to also enforce server-side) |

---

> **The diagrams in this doc are the contract.** When you change the topology, update the diagram in the same PR. CI fails the PR if `backend/agents/orchestrator.py` changes and `docs/ARCHITECTURE.md` does not.

## Current implementation status (2026-09-26)

This repository is undeployed; [deployment status](../.github/DEPLOYMENT_STATUS.md)
records the missing infrastructure and paid-flow prerequisites. The API
authentication routes now verify Firebase claims, persist a user before issuing
a backend session JWT, and reject a failed persistence step. Middleware accepts
verified Firebase tokens and backend session JWTs. Protected SSE streams still
check the requested session's owner against the authenticated user.

Marketplace order creation now uses the Firestore job service's actual
signature and refuses to create an unpaid job when checkout is unavailable.
The frontend and backend marketplace paths, Stripe checkout/webhook handling,
and subscription checkout service contract still need integration work before
paid flows can be enabled. Mocked route tests do not validate those provider
flows.
