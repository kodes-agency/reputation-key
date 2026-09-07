# Alerts and security posture

Numbered incident procedures remain in [Operational runbooks](runbooks.md).

## Security posture (BQC-7.6)

Request-boundary and OAuth hardening controls, how they are wired, and how
each is verified. Unless noted, the mechanism lives in `src/shared/security/**`
(unit-tested) with thin nitro-plugin wiring in `server/plugins/**`.

**Security response headers (B0.7, STD-P1-07).** The full set (default-deny
CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
`Referrer-Policy: strict-origin-when-cross-origin`, restrictive
`Permissions-Policy`, plus HSTS in production only) is applied to every
response by the nitro v3 `response` hook in
`src/shared/security/security-headers.ts`, wired via
`server/plugins/security-headers.ts` through the explicit `plugins` array in
`vite.config.ts` (nitro serverDir scanning stays off under TanStack Start —
the array is the ONLY registration path; the original nitropack-v2 plugin was
inert, STD-P1-07). **Proof:** CI boots the built production artifact and
asserts every header on 200, 404, and 413 responses
(`pnpm check:security-headers` → `scripts/check-security-headers.mjs`, check
job after "Web build"; the script generates per-run random secrets, so the
placeholder-secret guard below does not refuse the probe boot). Unit semantics
are additionally covered by `src/shared/security/security-headers.test.ts`.
The production image entry point in `Dockerfile` therefore serves the verified
header set on every response.

**Trusted proxy model.** `TRUSTED_PROXY_MODE` pins the deployed edge contract.
Production defaults to `railway-edge`, which consumes Railway's documented
`X-Real-IP` only when Railway edge/request markers are also present and ignores
caller-controlled `X-Forwarded-For`. `direct` trusts no forwarded address.
`xff` is an explicit non-Railway mode: it validates every hop, rejects empty,
malformed, overlong, and excessive chains, then selects `length − N` using
`TRUSTED_PROXY_COUNT`; `TRUSTED_PROXY_MAX_HOPS` defaults to 8. Server functions
have no socket-peer address, so any contract failure yields `unknown`, never a
forwarded fallback. All rate-limit/IP call-sites (registration, sign-in, guest
rating/feedback/scan/click, and the better-auth catch-all) go through
`clientIpFromHeaders` (`src/shared/security/client-ip.ts`). Keep the Railway
service reachable only through its public edge when this mode is active. See
[Railway public-networking specifications](https://docs.railway.com/networking/public-networking/specs-and-limits).

**Body-size limit + request IDs.** The request-guard plugin
(`server/plugins/request-guard.ts` → `src/shared/security/request-guard.ts`)
rejects requests whose declared `content-length` exceeds
`REQUEST_BODY_LIMIT_BYTES` (default 1 MiB) with a content-free 413 before
routing (chunked bodies without a declared length cannot be pre-empted — the
platform gateway is the backstop). Every response carries `x-request-id`:
a sane inbound id (≤128 chars, token charset) is echoed, otherwise one is
generated. `requestId` is an approved correlation field (BQC-7.3 schema).
**Time limits:** there is deliberately no server-boundary timeout mechanism —
adapter-level timeouts exist where hangs are possible (e.g. the alert webhook
POST at 3s) and the platform gateway owns the outer request deadline.

**Rate controls.** better-auth's built-in limiter guards its native endpoints
(disabled only under the authorized `E2E=1` test identity). When `REDIS_URL`
is configured, its atomic custom storage shares the allowance across web
replicas and stores only an HMAC-derived client/path bucket with the active
window TTL. Redis command failure fails the auth request closed. The adapter is
rate-limit-only: Better Auth sessions and verification records remain in
Postgres, not Redis. The shared Redis limiter
(`src/shared/rate-limit/middleware.ts`) guards registration, sign-in, guest
submissions, the auth catch-all, and app-owned invitation create/resend. The
two invitation actions share one HMAC-derived budget of 20 sends per actor per
hour and 100 per Organization per day. When Redis is absent or erroring it
**fails closed in production** (deny + error log) and fails open with a warn
elsewhere.

**Origin checks.** better-auth is configured with
`trustedOrigins: [BETTER_AUTH_URL]` — origin/host validation fails closed to
the configured app URL. Cookies: `Secure` in production, `HttpOnly`,
`SameSite=Lax`; sessions 30d expiry / 24h rolling update.

**OAuth (custom Google flow).** State is HMAC-signed
(`OAUTH_STATE_SECRET`) and bound to the initiating user (`sub` claim — the
callback rejects a state redeemed by a different session, fail closed to the
generic `invalid_state` redirect); 10-minute freshness window;
constant-time signature comparison. PKCE S256: the verifier is stored
server-side in Redis under the state nonce (TTL = state TTL, one-time use via
atomic GETDEL) and only the challenge leaves the process; a missing/expired/
replayed verifier fails closed. **Redirect allowlist:** the OAuth redirect URI
is the fixed `${BETTER_AUTH_URL}/api/auth/google/callback` and post-callback
redirects are fixed app paths (`/import?…`) — no request-derived redirect
target is ever honored. Tokens are AES-256-GCM encrypted at rest
(`ENCRYPTION_KEY`); refresh runs through the single refresh use case; revoke
on disconnect. In production, every credential-bearing direct socket now
fails before network access with no environment opt-out. Refresh leadership
uses Cache Redis across replicas: an opaque HMAC connection key, renewable
lease, ownership proof immediately before credential-generation CAS, and
shared 5–300 second failure backoff. A Redis outage denies refresh before
credential decryption. The typed credential gateway/admission consumer for
OAuth exchange/refresh/revoke and Notifications is still a SAFE-04 release
blocker; keep those capabilities killed until its sandbox drill passes. Key
rotation remains runbook-manual (§2) and is a registered platform finding —
do not improvise rotation in an incident.

**Error sanitization.** Server-fn errors map to generic tagged errors
(`catchUntagged`); the root error boundary renders a generic message in
production (raw only in dev); the 413/429/404 guard responses are
content-free JSON. No stack, SQL, or secret material reaches a client.

**Placeholder-secret boot guard.** Production processes refuse to boot when a
secret matches the known test/CI/`.env.example` placeholder family
(`src/shared/config/production-secrets.ts`): the web process via the
first-registered nitro plugin (`production-secret-guard.ts`), the worker via
`assertProductionSecrets` in `src/worker/index.ts`. The error names offending
FIELDS only, never values.

**Health/metrics exposure.** `/api/health/metrics` is token-gated
(`OPS_METRICS_TOKEN`, BQC-7.2 — absent or wrong credential 404s, keeping the
surface dark); network-level restriction of the ops surface is platform-owned
(Railway private networking). Liveness/readiness carry no dependency detail.

**Dependencies.** `nitropack` (v2) was removed — the build runs nitro v3
(`nitro` devDependency, build-time only); nothing references the v2 API.

---

## Alerts (BQC-7.4)

Every alert is defined in `src/shared/observability/alert-definitions.ts` (owner, severity per ADR 0038, threshold/window) and evaluated by the health-check job every 5 minutes against the OperationsSnapshot plus the aux reads (retention runs, policy denials, quarantine region-attempts, and content-free beta-feedback triage age/count).

**Dispatch:** every firing alert emits a schema-conformant structured `error` log line (`[alert] <name> firing`, fields: alert/severity/owner/runbook/value/threshold/windowMs/detail/firedAt — content-free) and, when `ALERT_WEBHOOK_URL` is set, POSTs the same payload to that operator webhook (3s timeout, best-effort — the log line is the durable record).

**Hysteresis:** edge-trigger — an alert dispatches on the ok→firing transition, re-notifies at most every 24h while continuously firing (Redis state key TTL), and clears on recovery so the next breach fires immediately.

| Alert                                         | Sev | Threshold / window                                                                                                              | Runbook |
| --------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `worker.heartbeat.stale`                      | P1  | heartbeat missing or age > 10min                                                                                                | §7      |
| `worker.job-runtime-unready`                  | P1  | any governed family violates handler/scheduler, dark-work, freshness, queue-age, stall, repair, or dead-letter contract         | §17     |
| `guest.observation-loss`                      | P1  | any suppressed scan/review-link observation in trailing 24h, or the content-free monitor is unavailable                         | §18     |
| `queue.oldest-age`                            | P2  | oldest unpublished outbox event > 15min                                                                                         | §7      |
| `queue.stalled`                               | P2  | any lease held > 2× its lease (single eval — stalled work IS the impact)                                                        | §7      |
| `queue.quarantine-growth`                     | P2  | oldest quarantined job > 24h (redrive SLA)                                                                                      | §4      |
| `queue.quarantine-nonempty`                   | P1  | any job in the unconsumed quarantine > 15min (dropped work; §4 is the same condition aged past the redrive SLA)                 | §14     |
| `source.freshness-deadline`                   | P1  | nearest hard expiry among refresh-due reviews < 2d away                                                                         | §3      |
| `sync.sweep-lag`                              | P1  | oldest past-due incremental sync > 60min overdue (4 missed 15-min sweeps — new reviews are not arriving)                        | §13     |
| `sync.failed-nonzero`                         | P2  | any coded sync failure whose retry is due                                                                                       | §13     |
| `retention.failure`                           | P1  | latest retention run failed for any subject                                                                                     | §8      |
| `reply.ambiguous-aging`                       | P2  | oldest ambiguous publication > 15min past reconcile_due                                                                         | §6      |
| `routing.region-attempts`                     | P2  | any quarantined wrong/unresolved/denied-region attempt                                                                          | §12     |
| `db.pool-exhaustion`                          | P1  | any connection request queued behind a saturated pool                                                                           | §8      |
| `notification.in-app-delivery-lag`            | P1  | oldest incomplete active-family delivery is over 60s from its durable source clock                                              | §15     |
| `notification.immediate-email-acceptance-lag` | P2  | source-to-provider acceptance exceeds 5min, or source linkage/bounded evidence is unevaluable                                   | §15     |
| `notification.missing-for-inbox-item`         | P1  | any inbox item still missing a notification past the grace edge (delivery/repair is not keeping up)                             | §15     |
| `notification.email-stalled`                  | P2  | oldest overdue queued email > 2h AND (email globally enabled OR rows already attempted) — silent while email is capability-dark | §15     |
| `beta-feedback.triage-backlog`                | P2  | oldest delivered unresolved local feedback receipt > 72h, or aggregate observation unavailable                                  | §16     |

Defined but not yet implemented (registered with owner/severity/runbook; the signal source lands in a later slice — injection happens there, before BQC-8 acceptance):

| Alert              | Sev | Signal source                                                                                                         | Runbook |
| ------------------ | --- | --------------------------------------------------------------------------------------------------------------------- | ------- |
| `web.availability` | P1  | External synthetic probe (self-report is circular; the probe also covers the p95 ≤ 750ms latency SLO) — BQC-8 staging | §12     |
| `backup.pitr`      | P3  | Platform backup schedule + BQC-8 timed restore drill (not app-readable) — BQC-7.8                                     | §8      |
| `security.scan`    | P2  | Supply-chain/secret-detection gate failure — BQC-7.7                                                                  | §9      |

**`backup.pitr` signal note (BQC-7.8):** the platform's backup/PITR status is
not readable from the app (Railway Postgres backups are console/provider
state), so there is deliberately no runtime `backup.pitr` dispatcher at app
level. The signal path is: the platform backup schedule (configuration +
verification: `docs/operations/backup-and-lifecycle.md` §1) plus the BQC-8
TIMED restore drill — the phase-doc "inject every alert" requirement is
satisfied by that drill evidence, not app dispatch. The row above stays "not
implemented at app level" by design, mirroring the `security.scan`
disposition below.

REG-04 expands that aggregate registration into the exact external `cell-us`
authority in `src/shared/observability/regional-platform-signals.ts`: latest
backup success age, WAL/PITR health, restore range, logical-export success,
external web availability, Sentry error rate, and release/config drift.
Application-owned queue, outbox, reply, and Google-sync signals cover worker
readiness. The catalogue deliberately contains no `europe` or `global` monitor
because those cells are dormant and must not be provisioned for beta. A green
catalogue test proves coverage only; external configuration and alert-injection
receipts remain required before customer data.

**`security.scan` signal note (BQC-7.7):** the supply-chain/secret gates now
exist — as CI hard gates, not app-level alert injection. The signal path is:
any red gate (dependency audit, gitleaks, license, action-pins, grype,
CodeQL analysis failure) fails the GitHub check → branch protection blocks
merge and the check failure notifies on-call via the repository's GitHub
notification routing. There is deliberately no runtime `security.scan`
dispatcher at app level (a CI gate red state is pre-deploy evidence, not a
production signal) — the row above stays "not implemented at app level" by
design. Gate inventory + thresholds: `docs/operations/security-ci-policy.md`.
