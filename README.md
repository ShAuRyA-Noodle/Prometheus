# PROMETHEUS

> **Tagline:** "You whisper a startup idea. 75 seconds later you have a full company."

PROMETHEUS is the operating layer between an idea and a company. A swarm of specialized AI agents, running on Google ADK plus Gemini 2.5 Pro and Flash, fans out across three dependency waves to produce a coherent, real-data-grounded, editable company package: brand, business model, market research, competitive analysis, financial model, pitch deck, landing page, legal docs, GTM plan, risk register, technical architecture, and executive summary.

This is the **V2 production rebuild** of the original blueprint. Real-data integrations, validation gates, structured outputs, ownership transfer, payments, persistence, mobile, accessibility, and a streaming UX with in-app deck, landing, and financial editors. No demo theater, no fabricated stats, no service-account-owned files.

**Deployment status:** This repository is not deployed. Automated releases are
disabled until the hosting infrastructure and staging checks described in
[`.github/DEPLOYMENT_STATUS.md`](.github/DEPLOYMENT_STATUS.md) are in place.

## Quickstart

```bash
# Backend (Python 3.11+)
cd backend
python -m venv .venv && source .venv/bin/activate  # Windows: .venv\Scripts\Activate
pip install -r requirements.txt
cp ../.env.example ../.env  # fill in credentials
uvicorn main:app --reload --port 8080

# Frontend (Node 20+)
cd frontend
npm install
npm run dev  # http://localhost:5173
```

## Repo structure

See `PROMETHEUS_BLUEPRINT_V2.md` for the full architecture and `PROMETHEUS_ROADMAP.md` for the 6-month product plan.

```
backend/   FastAPI gateway + Cloud Tasks worker + ADK agents + services
frontend/  React 18 + Vite + TS + Tailwind v4 + Framer Motion + in-app editors
infrastructure/  Cloud Run, Firestore rules, Cloud Tasks queue, Cloud Armor
scripts/   setup, dev, deploy, test, benchmark, seed
docs/      ARCHITECTURE, SECURITY, DEPLOYMENT, REFERENCE_*
.claude/   Claude Code project config (commands, skills, settings)
```

## How it works

The pipeline runs as three dependency waves with a validation gate after each:

- **Pre-wave:** idea parsing and articulation polish the raw input.
- **Wave 1 (parallel):** market research, competitive analysis, business model, brand identity, risk analysis, and technical architecture.
- **Gate 1:** Pydantic schema validation, Vertex AI safety, USPTO trademark, and Domainr domain checks on the brand.
- **Wave 2 (parallel):** a deterministic financial model, landing page, legal docs by template fill, and go-to-market.
- **Gate 2:** schema, WCAG palette validation, and landing HTML sanitization.
- **Wave 3 (parallel):** pitch deck and executive summary.
- **Gate 3:** final cross-artifact coherence check.

## Stack

**Backend:** Python 3.11, FastAPI, Pydantic v2, Google ADK, Gemini 2.5 Pro and Flash, Vertex AI Agent Engine, Cloud Tasks, Cloud Run, Firestore, Workload Identity Federation, OpenTelemetry to Cloud Trace.

**Frontend:** React 18 with TypeScript 5, Vite, Tailwind CSS v4, Framer Motion 11, Firebase JS SDK, DOMPurify, Tiptap (deck editor), Recharts (financial), cmdk (Cmd-K palette), PostHog.

**Real-data integrations:** USPTO (trademark), Domainr (domain availability), Crunchbase and Statista (market and competitor data), SimilarWeb (traffic proxies), Imagen 3 and Recraft (logo and hero images), Deepgram Nova-2 (cross-browser STT), Termly and iubenda (legal templates), Cloudflare Workers and Registrar (deploy and domain purchase), Stripe (billing).

## Security

- Secrets stay out of git. Production uses Workload Identity Federation and Secret Manager; local dev uses a gitignored `.env`.
- All agent-emitted HTML and SVG passes through server-side sanitization and DOMPurify before rendering.
- Generated landing pages render in iframes with `sandbox="allow-forms"` only. No `allow-scripts`, no `allow-same-origin`.
- CORS uses an explicit allowlist with no wildcard. Idea input is length-capped and safety-filtered before any agent runs.
- Report vulnerabilities privately to the address in `SECURITY.md`.

## License

Proprietary. All rights reserved.
</content>
</invoke>
