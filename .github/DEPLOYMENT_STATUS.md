# Deployment status

PROMETHEUS is currently **undeployed**. The previous automatic CD workflow was
removed on 2026-09-26 because it could not deploy this repository safely. CI
still runs lint, type checks, tests, dependency audits, and security checks.

The retired workflow depended on GitHub environments and GCP credentials that
are not configured in this repository. It also referenced an absent Firebase
configuration and `scripts/smoke-golden.sh`, and probed `/healthz` and `/readyz`
even though the API exposes `/health`. The configured staging and API hostnames
did not resolve during the retirement check; the apex domain did not serve this
API. A successful source build therefore must not be presented as proof of a
working deployment.

Paid flows are not deployment-ready. Marketplace checkout has no billing
service implementation or matching Stripe webhook, and the frontend order path
does not match the backend route. Subscription checkout also has a route and
service contract mismatch. Mocked route tests do not prove either paid flow
works. Keep these flows disabled until provider configuration, contract tests,
and an end-to-end staging purchase/refund check are in place.

Before restoring CD, establish the actual hosting plan and complete these
checks in a protected staging environment:

1. Provision separate staging and production projects, service accounts,
   Workload Identity Federation, artifact registries, runtime secrets, and
   restricted GitHub environments.
2. Configure the real staging and production API origins, DNS, TLS, Firebase
   deployment configuration, Firestore rules/indexes, and task queues.
3. Build and scan both images, deploy to staging, and exercise the actual
   `/health` route plus an authenticated end-to-end request that verifies a
   completed result without exposing customer data.
4. Require staging verification and manual production approval. Promote the
   exact scanned image digest, verify production health and application flow,
   and retain a tested rollback path.

The deleted CD workflow remains in Git history as a reference, not an
executable deployment plan. The weekly quality benchmark was also retired: it
claimed to read last week's production samples but had no configured sample
source or cloud authentication. The staging load test remains available for
manual runs after `STAGING_HOST` is configured; its automatic schedule is
disabled while staging is absent. Do not restore scheduled deployment checks
until a real environment and data source are verified.
