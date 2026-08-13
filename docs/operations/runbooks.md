# B3.9 — Operational Runbooks

**Date:** 2026-07-14
**Owner:** Bozhidar Denev
**Scope:** Internal beta operations

Each runbook follows the structure:
**Trigger/Symptoms → Impact → Prerequisites → Diagnostics → Containment → Recovery → Verification → Escalation → Evidence**

---

## Operator commands (BQC-7.5)

Every `ops:*` command runs through the operator-command harness
(`scripts/ops/operator-command.ts`). The invocation contract:

- `--operator <id>` — REQUIRED named operator; must be registered in
  `OPS_OPERATOR_IDENTITIES` (unregistered → `operator_not_registered` deny).
- Every invocation (reads included) is evaluated through the ExecutionPolicy
  operator branch and lands in `policy_decision_audit` (allow AND deny —
  content-free: actor/action/scope/decision/reason + correlation id, printed
  on every run).
- Mutations are DRY-RUN by default; `--apply` executes and requires
  `--reason <text>` (`--ticket <ref>` where the op needs one). Destructive
  commands additionally require the typed confirmation `--yes <command>`.
- Commands that enqueue or redrive work go through the BQC-3 contract
  (`jobEnqueueOptions` / `createRedriveJob`) — never direct handler calls;
  dispatch re-authorizes at execution.

The commands:

- `ops:queue <status|pause|resume> <queue>` — pause/resume a BullMQ queue (containment; jobs preserved). §3/§7
- `ops:quarantine <list|redrive <id>>` — failure-quarantine inspection + redrive to the original queue. §4/§7
- `ops:refresh <reviews|metrics-daily|metrics-weekly|metrics-inbox>` — enqueue one bounded refresh-sweep run. §3/§4
- `ops:purge <reviews|retention>` — enqueue one bounded purge/retention run (destructive, typed confirmation). §10
- `ops:rebuild-projection --org <id> [--property <id>]` — repair the inbox projection (bounded, dry-run report first). §5
- `ops:reconcile-publication <replyId> | --all-ambiguous` — reconcile ambiguous Google reply publication (provider re-read; never a send). §6
- `ops:reconcile-regions [--org <id>]` / `ops:reconcile-grants [--org <id> ...]` — report-first reconciliations (conflicts/anomalies never auto-converted). §12
- `ops:suspend-property` / `ops:restore-property --org <id> --property <id> --ticket <ref>` — suspend/restore property processing. §10
- `ops:inspect region|policy ...` — read-only routing/policy decision explanation. §12
- `ops:disconnect-connection <connectionId> --org <id>` — revoke Google connection credentials (destructive; reconnect completes rotation). §2/§10
- `ops:restore-preflight` — guided runbook §8 restore preflight (isolated-target check, journal readability, backup-window checklist); NOT a PITR executor — restore is platform-owned. §8
- `ops:restore-verify` — restore-drill purge-before-serving proof (requires RESTORE_MODE=isolated + isolated target; runs the source-policy purge in-process, asserts zero expired rows, prints retention_runs evidence); destructive, typed confirmation. §8
- `ops:google-import-lifecycle inspect` — read the bounded global expiry/release backlog.
- `ops:google-import-lifecycle inspect-request <importJobId> --org <id>` — identifier-only tenant request inspection.
- `ops:google-import-lifecycle cancel-request <importJobId> --org <id>` — dry-run by default; `--apply --reason <text> --yes ops:google-import-lifecycle` fences, receipt-reconciles, terminalizes, and scrubs one request.
- Google import compatibility mutations (`switch-connected-events`,
  `switch-oauth-state`, `mark-v1-events-drained`, `quiesce-legacy`,
  `drain-legacy-queues`, `close-legacy`, `archive-legacy`) run only from the
  rollout-only `Dockerfile.google-import-compatibility` image. Production web
  and worker images contain no compatibility entry point.

### Google import artifact cutover and rollback

CI builds three independently content-addressed images: final web, final
worker, and rollout-only Google import compatibility. Before expand rollout,
push all three and record the exact `repo@sha256:...` values from the
`Google import image digests` CI summary in the change record. Tags and local
image IDs are not rollback identities.

The compatibility image is a non-serving, non-root operator binary. Run it as
an authenticated one-shot job by exact digest; its only entry point is
`google-import-lifecycle.js`. Never attach a route/domain, worker replica, or
autoscaling policy to it. Final images are labelled
`com.repkey.google-import-contract=final`; the compatibility image is labelled
`com.repkey.google-import-contract=compatibility` and
`com.repkey.rollout-scope=google-import-only`.

Rollback is permitted only before the contract migration removes old
columns/tables. Stop the rollout, retain the expanded schema, and redeploy the
recorded compatibility digest; never rebuild the tag or reverse DDL. After the
contract migration, compatibility rollback is forbidden: fix forward, because
the removed persistence contract cannot be reconstructed safely. The CI
artifact gate (`pnpm check:google-import-artifacts`) proves final bundles omit
legacy Google identity/state/job/schema adapters while the compatibility
bundle retains the frozen rollout surface.

Registered gaps (owned elsewhere, do NOT improvise in an incident): metric-rollup
watermark reset (metric owner — use `ops:refresh metrics-*` for a bounded re-run),
ENCRYPTION_KEY rotation (platform owner — runbook §2 manual), PITR execution
(platform owner — `ops:restore-preflight` + `ops:restore-verify` are the app-side
checklist/verify surface only; procedure: docs/operations/backup-and-lifecycle.md).

---

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
placeholder-secret guard below does not refuse the probe boot). The wiring is
additionally pinned by `src/shared/architecture/security-headers-wiring.test.ts`.
The BQC-7.1 deployment contract (Dockerfile + railway.json + this runbook)
therefore serves the verified header set on every response.

**Trusted proxy model.** Client IPs are derived from `X-Forwarded-For` by
trusted position, never the spoofable leftmost hop:
`TRUSTED_PROXY_COUNT` (default 1 — one edge proxy, the platform load
balancer) selects the hop at `length − (N+1)`; with 0 the header is not
trusted at all. All rate-limit/IP call-sites (registration, sign-in, guest
rating/feedback/scan, the better-auth catch-all) go through
`clientIpFromHeaders` (`src/shared/security/client-ip.ts`). Set the count to
the real proxy chain length when the fronting topology changes.

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
(disabled only under `E2E=1`). The shared Redis limiter
(`src/shared/rate-limit/middleware.ts`) guards registration, sign-in, guest
submissions, and the auth catch-all; when Redis is absent or erroring it
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
on disconnect. Key rotation remains runbook-manual (§2) and is a registered
platform finding — do not improvise rotation in an incident.

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

## 1. Account Compromise and Session Revoke

**Trigger:** Suspected account compromise, reported credential leak, unauthorized access detected.
**Impact:** P0 — potential cross-tenant data access.
**Diagnostics:** Check `audit_logs` for suspicious actions by the user ID. Check `session` table for active sessions.
**Containment:** Immediately invalidate all sessions for the user (`DELETE FROM session WHERE "userId" = $1`). Suspend the user's organization via `BETA_SUSPENDED_ORGS`.
**Recovery:** Require password reset. Re-verify email. Re-issue sessions only after identity confirmation.
**Verification:** Confirm no active sessions remain. Audit log shows no further activity from the compromised account.
**Escalation:** Page Bozhidar Denev immediately. Document incident timeline.

---

## 2. OAuth Token / Encryption Key Compromise

**Trigger:** Google OAuth token leak suspected, encryption key exposure detected.
**Impact:** P0 — unauthorized Google API access possible.
**Diagnostics:** Check `google_connections` for the affected connection. Identify `encryption_key_id` version.
**Containment:** Revoke the Google refresh token via Google API (`ops:disconnect-connection <connectionId> --org <id>` — revoke + redact + purge; destructive, typed confirmation). If encryption key compromised: begin key rotation — new tokens encrypted with new key, old tokens re-encrypted (runbook-manual, platform owner).
**Recovery:** User must re-authenticate via Google OAuth. New tokens encrypted with new key version.
**Verification:** Confirm old tokens are revoked at Google. Confirm no API calls succeed with old tokens.
**Escalation:** Page Bozhidar Denev. Notify Google if API abuse detected.

---

## 3. Google API Suspension / Quota Exhaustion

**Trigger:** Google returns 429 (quota) or 403 (suspended) consistently.
**Impact:** P1 — review sync and reply publish unavailable.
**Diagnostics:** Check `classifySyncError` output. Check Google Cloud Console for quota status.
**Containment:** Pause sync jobs for the affected connection. Set connection status to `degraded`.
**Recovery:** Wait for quota reset (usually daily). If suspended, resolve the policy issue with Google Cloud support. Resume sync after clearance.
**Verification:** Confirm sync resumes. Check `last_successful_sync_at` advances.
**Escalation:** Bozhidar Denev. Google Cloud support ticket if suspended.

---

## 4. Pub/Sub Backlog / DLQ / Replay

**Trigger:** Notification backlog growing, messages in dead-letter queue.
**Impact:** P1 — delayed review visibility.
**Diagnostics:** Check queue depth via `HealthSnapshot.syncMetrics`. Check `inbound_webhook_receipts` for duplicate/missing messages.
**Containment:** Increase worker concurrency temporarily. Pause non-urgent jobs to free capacity.
**Recovery:** Process backlog. Redrive dead-lettered messages via `ops:quarantine redrive <id> --reason <text> --apply` (list first with `ops:quarantine list`). Reconcile any gaps via bounded reconciliation (`ops:refresh reviews`).
**Verification:** Queue depth returns to normal. `review_sync_state.watermark_updated_at` advances.
**Escalation:** Bozhidar Denev if backlog exceeds 1 hour.

---

## 5. Import Stuck / Partial

**Trigger:** Import job running too long, stuck at a checkpoint, or reporting failure.
**Impact:** P2 — delayed first-time setup for a property.
**Diagnostics:** Check `gbp_import_jobs` status. Check `review_sync_state` checkpoint. Check worker logs for errors.
**Containment:** Cancel the stuck job. Property remains in `active` lifecycle state.
**Recovery:** Restart import from last checkpoint (durable — resumes, doesn't restart). Check Google API connectivity first.
**Verification:** Import progresses past the stuck checkpoint. Review count increases.
**Escalation:** Bozhidar Denev if import fails after retry.

---

## 6. Ambiguous or Duplicate Reply Investigation

**Trigger:** Possible duplicate reply published to Google, or publish outcome unknown.
**Impact:** P0 if duplicate confirmed — duplicate externally visible effect.
**Diagnostics:** Check reply `publication_state`. If `outcome_unknown`/`ambiguous`, run reconciliation: `ops:reconcile-publication <replyId> --org <id>` (dry-run first, then `--apply`; `--all-ambiguous` reconciles one bounded due batch) — queries Google API for the reply, never sends. Check `event_consumer_receipts` for duplicate processing.
**Containment:** If duplicate found, do NOT delete from Google (may confuse the reviewer). Document the duplicate. If `outcome_unknown`, prevent retry until reconciliation completes.
**Recovery:** Reconciliation determines actual state → `published`, `retryable`, or `manual_review`. If duplicate, file incident report.
**Verification:** Exactly one reply visible on Google. Publication workflow in terminal state.
**Escalation:** P0 — page Bozhidar Denev immediately for confirmed duplicates.

---

## 7. Redis Loss / Backlog / Poison Job

**Trigger:** Redis unreachable, queue backlog building, or a poison job crashing workers repeatedly.
**Impact:** P1 — external effects delayed.
**Diagnostics:** Check Redis connectivity. Check BullMQ stalled/failed counts. Identify poison job pattern.
**Containment:** If Redis down: outbox accumulates events (no data loss). Web stays healthy. If poison job: quarantine via dead-letter, stop retry cycle.
**Recovery:** Redis restore → relay drains backlog. Poison job → fix handler code, redrive from DLQ.
**Verification:** Queue depth normal. No repeated failures. Outbox `published_at` advances.
**Escalation:** Bozhidar Denev if backlog > 30 minutes.
**Durability posture:** Redis is disposable-and-rebuild — the Postgres outbox is the durable fact store, no AOF is required for correctness (backup-and-lifecycle.md §2). BullMQ history prunes by count; dead-letter quarantine entries expire after `QUARANTINE_TTL_DAYS` (default 30d) via the daily `quarantine-ttl-sweep` (per-entry `job.remove()`, evidence subject `quarantine.ttl`) — the 24h `queue.quarantine-growth` redrive SLA is unchanged.

---

## 8. Database Saturation / Failed Migration / Restore

**Trigger:** Connection pool exhausted, slow queries, migration failure, or restore needed.
**Impact:** P0 for migration failure or data loss. P1 for saturation.
**Diagnostics:** Check `pg_stat_activity` for connection count. Check the Railway console (Postgres service metrics) for compute/storage. Check migration logs.
**Containment:** Reduce worker concurrency. Pause non-critical jobs. If the predeploy migration failed: the deploy is already blocked (Railway `preDeployCommand` exited non-zero) — the previous containers keep serving; do NOT hand-roll partial schema state.
**Recovery:** Saturation → tune pool sizes, add indexes. Migration → forward recovery only: the trio (`scripts/migrate-deploy.ts`, advisory-locked, idempotent) leaves no half-applied state beyond its idempotent steps — fix the failing migration/sidecar SQL forward and redeploy; the rerun converges (see the script header + src/shared/db/CONTEXT.md "Deploy apply order"). Never roll the schema back mid-flight. Restore → the full procedure is [backup-and-lifecycle.md](backup-and-lifecycle.md) §1: `ops:restore-preflight` (isolated target, journal readability, backup-window checklist) → PITR to an isolated project (Railway console, platform-owned) → migration parity → boot ISOLATED (`RESTORE_MODE=isolated` — worker refuses, web capabilities deny fail-closed) → `ops:restore-verify` (in-process source-policy purge + zero-expired proof + evidence) → cutover (UNSET `RESTORE_MODE` + redeploy). Restore is the only rollback path, reserved for data loss.
**Verification:** Connection count under budget. Migration journal consistent. Restore passes `ops:restore-verify` (zero expired-content rows, `retention_runs` evidence) before cutover.
**Escalation:** P0 — page Bozhidar Denev for migration/restore. Railway support if platform issue.

---

## 9. Leaked Secret / Tenant Data Incident

**Trigger:** Secret detected in logs, code, or public repository. Tenant data exposed.
**Impact:** P0 — security incident.
**Diagnostics:** Identify what was leaked (token, review content, email). Identify scope (which tenants, how many records).
**Containment:** Rotate the leaked credential immediately. Revoke affected sessions/tokens. If code repository: force-push to remove, rotate all exposed secrets.
**Recovery:** Rotate all potentially exposed secrets. Audit access logs for misuse. Patch the leak source (logging config, error handler, etc.).
**Verification:** Secret scanning confirms no remaining exposure. Access logs show no unauthorized use.
**Escalation:** P0 — page Bozhidar Denev immediately. Document for potential notification requirements.

---

## 10. Property Suspend / Disconnect / Archive / Purge

**Trigger:** Operator needs to suspend, disconnect, archive, or purge a property.
**Impact:** Varies — P2 for archive, P1 for disconnect, P0 for purge (irreversible).
**Diagnostics:** Check property `lifecycle_state`; use `ops:google-import-lifecycle inspect-request <importJobId> --org <id>` for identifier-only import state. Check for active sync jobs, pending publications, inbox items.
**Containment:** Suspend → `ops:suspend-property --org <id> --property <id> --reason <text> --ticket <ref> --apply` (blocks new processing via the capability store; restore with `ops:restore-property`). Disconnect → `ops:disconnect-connection <connectionId> --org <id>` (fences import work, revokes Google tokens, and sets connection `disconnected`). A stuck request may be fenced with `ops:google-import-lifecycle cancel-request <importJobId> --org <id> --reason <text> --apply --yes ops:google-import-lifecycle`.
**Recovery:** Archive → data preserved, can restore to `active`. Purge → irreversible, confirm via typed property name; bounded purge/retention sweeps re-run via `ops:purge <reviews|retention>` (destructive — typed confirmation). Property/member/connection/org removal fences matching import parents/items and invalidates provider references before authority disappears.
**Verification:** Lifecycle state correct. `ops:google-import-lifecycle inspect` reports zero overdue/release backlog; scoped inspection reports no outstanding authority. Purge evidence includes `integration.google_import_v2.lifecycle`.
**Escalation:** Purge requires operator confirmation + evidence report. Bozhidar Denev signs off.

---

## 11. Beta Stop (Global Kill Switch)

**Trigger:** Any P0 stop condition from ADR 0038 (tenant isolation breach, data loss, duplicate effect, token leak, policy violation).
**Impact:** P0 — all external effects must stop immediately.
**Containment:** Full stop → set `BETA_CAPABILITIES_OFF=all` and restart web + worker. Targeted stop → set a comma list, e.g. `BETA_CAPABILITIES_OFF=property.connect_gbp,property.publish_reply` stops Google sync/import/publish (interactive gates deny; the sync/import/publish job handlers re-check capability before side effects and skip cleanly — enqueued jobs are preserved, not deleted). Worker startup logs the effective capability manifest (kill switch, disabled list, blocked set).
**Recovery:** Investigate root cause. Fix. Re-enable capabilities one at a time with monitoring (remove list entries, restart).
**Verification:** No new external effects after kill switch. Canonical data preserved.
**Escalation:** Bozhidar Denev decides on restart. All P0 conditions require written sign-off before re-enabling.

---

## 12. Region Outage (No Cross-Region Failover)

**Trigger:** US region infrastructure unavailable (Railway Postgres, Redis, or Google API).
**Impact:** P1 — service degraded or unavailable for US properties.
**Containment:** Do NOT fail over to another region (policy: no silent cross-region data movement). Set readiness to 503. Show honest "service unavailable" state.
**Recovery:** Wait for provider recovery. Outbox accumulates events (no data loss). Resume normally when infrastructure recovers.
**Verification:** All dependencies healthy. Backlog drained. Freshness indicators return to normal.
**Escalation:** Bozhidar Denev. Provider support tickets (Railway, Redis provider, Google Cloud).

---

## Alerts (BQC-7.4)

Every alert is defined in `src/shared/observability/alert-definitions.ts` (owner, severity per ADR 0038, threshold/window) and evaluated by the health-check job every 5 minutes against the OperationsSnapshot plus the aux reads (retention runs, policy denials, quarantine region-attempts).

**Dispatch:** every firing alert emits a schema-conformant structured `error` log line (`[alert] <name> firing`, fields: alert/severity/owner/runbook/value/threshold/windowMs/detail/firedAt — content-free) and, when `ALERT_WEBHOOK_URL` is set, POSTs the same payload to that operator webhook (3s timeout, best-effort — the log line is the durable record).

**Hysteresis:** edge-trigger — an alert dispatches on the ok→firing transition, re-notifies at most every 24h while continuously firing (Redis state key TTL), and clears on recovery so the next breach fires immediately.

| Alert                       | Sev | Threshold / window                                                                                                        | Runbook |
| --------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------- | ------- |
| `worker.heartbeat.stale`    | P1  | heartbeat missing or age > 10min                                                                                          | §7      |
| `queue.oldest-age`          | P2  | oldest unpublished outbox event > 15min                                                                                   | §7      |
| `queue.stalled`             | P2  | any lease held > 2× its lease (single eval — stalled work IS the impact)                                                  | §7      |
| `queue.quarantine-growth`   | P2  | oldest quarantined job > 24h (redrive SLA)                                                                                | §4      |
| `source.freshness-deadline` | P1  | nearest hard expiry among refresh-due reviews < 2d away                                                                   | §3      |
| `retention.failure`         | P1  | latest retention run failed for any subject                                                                               | §8      |
| `reply.ambiguous-aging`     | P2  | oldest ambiguous publication > 15min past reconcile_due                                                                   | §6      |
| `routing.region-attempts`   | P2  | any quarantined wrong/unresolved/denied-region attempt                                                                    | §12     |
| `policy.denial-drift`       | P2  | > 50 policy denials in the trailing hour (starting point — tune with real traffic; §11 for containment if drift confirms) | §9      |
| `db.pool-exhaustion`        | P1  | any connection request queued behind a saturated pool                                                                     | §8      |

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

**`security.scan` signal note (BQC-7.7):** the supply-chain/secret gates now
exist — as CI hard gates, not app-level alert injection. The signal path is:
any red gate (dependency audit, gitleaks, license, action-pins, grype,
CodeQL analysis failure) fails the GitHub check → branch protection blocks
merge and the check failure notifies on-call via the repository's GitHub
notification routing. There is deliberately no runtime `security.scan`
dispatcher at app level (a CI gate red state is pre-deploy evidence, not a
production signal) — the row above stays "not implemented at app level" by
design. Gate inventory + thresholds: `docs/operations/security-ci-policy.md`.
