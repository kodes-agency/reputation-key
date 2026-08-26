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
- `ops:purge <reviews|retention>` — report the static-rule retention backlog by default, or enqueue one bounded purge/retention run with `--apply` (destructive, typed confirmation); inspect Google import lifecycle separately. §10
- `ops:rebuild-projection --org <id> [--property <id>]` — repair the inbox projection (bounded, dry-run report first). §5
- `ops:reconcile-publication <replyId> | --all-ambiguous` — reconcile ambiguous Google reply publication (provider re-read; never a send). §6
- `ops:reconcile-regions [--org <id>]` / `ops:reconcile-grants [--org <id> ...]` — report-first reconciliations (conflicts/anomalies never auto-converted). §12
- `ops:reconcile-people-team [--org <id>]` — reconcile retired Staff assignments into canonical participation, Team-quarantine, Portal responsibility, and Portal Group intervals. `--apply` requires `--evidence <new-json-path>`, verifies post-apply parity, and writes an artifact only when every mapping is exact. A release artifact must come from a global (no `--org`) run. §12
- `ops:suspend-property` / `ops:restore-property --org <id> --property <id> --ticket <ref>` — suspend/restore property processing. §10
- `ops:inspect region|policy ...` — read-only routing/policy decision explanation. §12
- `ops:disconnect-connection <connectionId> --org <id>` — revoke Google connection credentials (destructive; reconnect completes rotation). §2/§10
- `ops:gbp-subscribe --org <id>` — re-assert the organization's GBP `notificationSetting` at `GBP_PUBSUB_TOPIC` (idempotent PATCH per connection). Dry-run by default; `--reason <text> --apply` executes. Run it (a) to backfill tenants that connected before the import path subscribed automatically, and (b) after ANY change to `GBP_PUBSUB_TOPIC` — Google stores the topic on the GBP account, so existing subscriptions keep publishing to the old topic until this re-runs. Exits 1 on any candidate short of `subscribed`. §2
- `ops:restore-preflight` — guided runbook §8 restore preflight (isolated-target check, journal readability, backup-window checklist); NOT a PITR executor — restore is platform-owned. §8
- `ops:restore-verify` — restore-drill retention + recovery-fence proof (requires `RESTORE_MODE=isolated` plus an attested loopback/Railway PITR sibling target; invalidates restored authority, fences unpublished effects, and records a cell recovery generation); destructive, typed confirmation. §8
- `ops:google-import-lifecycle inspect` — read the bounded global expiry/release backlog.
- `ops:google-import-lifecycle inspect-request <importJobId> --org <id>` — identifier-only tenant request inspection.
- `ops:google-import-lifecycle cancel-request <importJobId> --org <id>` — dry-run by default; `--apply --reason <text> --yes ops:google-import-lifecycle` fences, receipt-reconciles, terminalizes, and scrubs one request.
- Google import compatibility mutations (`switch-connected-events`,
  `switch-oauth-state`, `mark-v1-events-drained`, `quiesce-legacy`,
  `drain-legacy-queues`, `close-legacy`, `archive-legacy`) run only from the
  rollout-only `Dockerfile.google-import-compatibility` image. Production web
  and worker images contain no compatibility entry point.

`pnpm release:beta` is an operator command too — it just does not run through
the `ops:*` harness until `--apply`:

- `pnpm release:beta --manifest <file> --signature-bundle <file>
--manifest-sha256 <sha256> --people-cutover-evidence <file>
--cell <us|europe|global>` — validate one
  canonical CI promotion manifest and print the exact ordered Data Cell plan.
  Dry-run invokes no Railway command.
- Add `--apply --operator <id> --reason "<text>"` for the audited
  path: it runs through the same harness as every `ops:*` mutation, so the
  operator must be in `OPS_OPERATOR_IDENTITIES` and the decision lands in
  `policy_decision_audit`. There is no unaudited promotion bypass; emergency
  releases still require a named operator, reason, durable decision row, and
  signature verification.
- Promotion never uploads or rebuilds a working tree. Before its first Railway
  mutation, it recomputes global people-authority parity and requires the same
  fingerprint/counts plus the named operator's matching decision audit in the
  supplied artifact. It then verifies the Sigstore bundle, rejects legacy revision-variable overrides, attaches each exact
  `repo@sha256:...` image, and deploys `web` first so its IaC-owned migration
  command settles before the other five services.
- Add `--verify-only` to read back people parity, the manifest digest, source
  revision, active image digest, health, and AI heads without deploying. A mismatch on any
  service is blocking.

The authoritative procedure, prerequisites, rollback boundary, and evidence
contract are in `immutable-release-promotion.md`. The dated
`closed-beta-release-runbook-2026-08-19.md` records the superseded local-build
procedure and must not be used for a `cell-*` environment. §8

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

### Canonical synthetic Google resource

Incident notes, logs, evidence, and provider-support records must never paste a
Google account, location, or review resource. The generated value below is the
only repository documentation example; it is unmistakably synthetic and must
never be sent to Google.

<!-- google-provider-identifiers-v1:start -->

> Generated from `test-fixtures/google-provider-identifiers-v1.json` (google-provider-identifiers-v1, SHA-256 `44a91d879c25e473d709bea469bd826b2649e6a5d40c6aa3157ce1c580f88a87`). Do not edit this block.
> Canonical synthetic review resource: `accounts/repkey-synthetic-do-not-use-account-0001/locations/repkey-synthetic-do-not-use-location-0001/reviews/repkey-synthetic-do-not-use-review-0001`.

<!-- google-provider-identifiers-v1:end -->

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

**Trigger:** Queue Redis or Cache Redis unreachable, queue backlog building, or a poison job crashing workers repeatedly.
**Impact:** P1 — external effects delayed.
**Diagnostics:** Check Redis connectivity and worker boot logs. `BullMQ Redis runtime verified` records the non-secret Redis version, `noeviction` policy, and GETDEL capability; `[CONFIG] BullMQ Redis runtime is incompatible: <code>` means the process refused a missing, uninspectable, unsupported, or eviction-capable queue store. Check BullMQ stalled/failed counts and identify the poison-job pattern.
**Containment:** If Queue Redis is down, the Postgres outbox accumulates events without losing accepted durable facts; serving processes stay live but readiness degrades. If Cache Redis is down, cache reads degrade and production rate-limited public actions fail closed without affecting queue keys. If poison job: quarantine via dead-letter, stop retry cycle.
**Recovery:** Rebuild/restore only the failed Redis resource, preserve the distinct `REDIS_URL`/`QUEUE_REDIS_URL` mapping, then let the relay drain the backlog. Poison job → fix handler code, redrive from DLQ.
**Verification:** Queue depth normal. No repeated failures. Outbox `published_at` advances.
**Escalation:** Bozhidar Denev if backlog > 30 minutes.
**Durability posture:** Redis is disposable-and-rebuild — the Postgres outbox is the durable fact store, no AOF is required for correctness (backup-and-lifecycle.md §2). BullMQ history prunes by count; dead-letter quarantine entries expire after `QUARANTINE_TTL_DAYS` (default 30d) via the daily `quarantine-ttl-sweep` (per-entry `job.remove()`, evidence subject `quarantine.ttl`) — the 24h `queue.quarantine-growth` redrive SLA is unchanged.

**Connection policy:** `Queue` producers use one request retry plus a 5-second connect/command timeout. They return failure to the caller (or leave a durable outbox row unpublished for the next relay pass) instead of waiting forever. `Worker` blocking connections use `maxRetriesPerRequest=null` and continue reconnecting; SIGTERM/SIGINT stops new claims and the worker drain budget bounds shutdown. Do not copy the Worker connection policy onto producer queues.

**Process-failure policy:** The first SIGTERM/SIGINT owns one bounded drain and exits 0. The first `unhandledRejection` or `uncaughtException` is fatal: its centrally sanitized error identity is logged, the same drain runs, and the process exits 1 so Railway restarts it. Later signals/failures cannot start competing close sequences; a rejecting drain forces exit 1.

---

## 8. Database Saturation / Failed Migration / Restore

**Trigger:** Connection pool exhausted, slow queries, migration failure, or restore needed.
**Impact:** P0 for migration failure or data loss. P1 for saturation.
**Diagnostics:** Check `pg_stat_activity` for connection count. Check the Railway console (Postgres service metrics) for compute/storage. Check migration logs.
**Containment:** Reduce worker concurrency. Pause non-critical jobs. If the predeploy migration failed: the deploy is already blocked (Railway `preDeployCommand` exited non-zero) — the previous containers keep serving; do NOT hand-roll partial schema state.
**Recovery:** Saturation → tune pool sizes, add indexes. Migration → forward recovery only: the trio (`scripts/migrate-deploy.ts`, advisory-locked, idempotent) leaves no half-applied state beyond its idempotent steps — fix the failing migration/sidecar SQL forward and redeploy; the rerun converges (see the script header + src/shared/db/CONTEXT.md "Deploy apply order"). Never roll the schema back mid-flight. Restore → follow [backup-and-lifecycle.md](backup-and-lifecycle.md) §1 exactly: contain one Data Cell → Railway PITR to its generated sibling service → exact-target preflight through a Railway tunnel → migration parity → dry-run inventory → destructive retention/recovery fence → isolated signed-image read verification → fresh Redis and controlled connection cutover with the verified recovery run/generation pinned. Railway leaves the live source serving; volume restore is not this procedure. Restore-only variables are verifier-service/process scoped; the cutover run/generation remains on every sibling consumer as its permanent boot attestation. Restore is the only database rollback path, reserved for data loss.
**Verification:** Connection count under budget. Migration journal consistent. Restore has one replayable `recovery_runs` generation, zero overdue retention/Google-import backlog, zero unfenced restored authority, no claimable fenced outbox rows, critical reads/tenant isolation green, fresh empty queues, and no duplicate external effect before cutover.
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
**Diagnostics:** Check property `lifecycle_state`; use `ops:google-import-lifecycle inspect-request <importJobId> --org <id>` for identifier-only import state. Check for active sync jobs, pending publications, inbox items. Before a general retention apply, run `pnpm ops:purge retention --operator <id>` and attach its content-free per-rule backlog/cutoff report.
**Containment:** Suspend → `ops:suspend-property --org <id> --property <id> --reason <text> --ticket <ref> --apply` (blocks new processing via the capability store; restore with `ops:restore-property`). Disconnect → `ops:disconnect-connection <connectionId> --org <id>` (fences import work, revokes Google tokens, and sets connection `disconnected`). A stuck request may be fenced with `ops:google-import-lifecycle cancel-request <importJobId> --org <id> --reason <text> --apply --yes ops:google-import-lifecycle`.
**Recovery:** Archive → data preserved, can restore to `active`. Purge → irreversible, confirm via typed property name; bounded purge/retention sweeps re-run via `ops:purge <reviews|retention> --reason <text> --apply --yes ops:purge` (destructive — typed confirmation). Property/member/connection/org removal fences matching import parents/items and invalidates provider references before authority disappears.
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

## 13. Discovery Sweep Lag (New Reviews Not Arriving)

**Alert:** `sync.sweep-lag` (P1) — the oldest past-due `review_sync_state.next_incremental_at` is more than 60 minutes overdue (four consecutive 15-minute sweeps failed to reach it).

**What it means:** a property that was scheduled for an incremental sync has not been polled. Every value written to `next_incremental_at` is already in the future by the poll interval, so overdue age is pure sweep lag — the alert is not measuring "properties are waiting", it is measuring "the sweep stopped working". With Google Pub/Sub push dark (`sync.gbp_push_enabled = 0`) the sweep is the ONLY path a new review has into the app: nobody gets notified, the inbox goes quiet, and there is no error anywhere.

**First three things to check:**

1. Is the sweep even firing? `ops:queue status background` and look for the `discover-new-reviews` repeatable job; check `worker.heartbeat.age_ms` / `worker.heartbeat.stale` on `/api/health/metrics`. A dead worker explains everything.
2. Is it firing and failing? Search worker logs for the `discover-new-reviews` job name and its `errorClass` field. An enqueue failure defers the offending property and re-throws for a queue retry, so a single poison property shows up as a repeating failure with a stuck cursor.
3. Is it firing, succeeding, and starving? Compare `sync.due_for_incremental` against the batch budget (200 per batch × 10 batches = 2000 properties per run). If the due count exceeds that, the sweep is healthy but under-provisioned and the oldest property never gets reached.

**Remediate:** dead worker → §7. Poison property → read `review_sync_state.error_class` / `last_terminal_error_at` for the property at the cursor and clear or fix it, then `ops:refresh reviews` for one bounded catch-up run. Starving sweep → raise `REVIEW_DISCOVERY_INTERVAL_MINUTES` so fewer properties come due per tick, or raise the batch budget; the alert clears once the oldest overdue property is polled. Quota/throttle from Google → §3.

**Verification:** `sync.oldest_due_age_ms` falls back under 60 minutes and keeps falling; `sync.due_for_incremental` drains.

**Escalation:** Bozhidar Denev.

---

## 14. Quarantine Non-Empty (Dropped Work)

**Alert:** `queue.quarantine-nonempty` (P1) — a job has been sitting in the `quarantine` queue for more than 15 minutes. `queue.quarantine-growth` (P2, §4) is the same condition aged past the 24-hour operator redrive SLA.

**What it means:** the quarantine is a dead-letter queue with **no consumer** — nothing drains it, and the daily `quarantine-ttl-sweep` DELETES entries after `QUARANTINE_TTL_DAYS` (default 30d). A job that lands there is lost work that no retry will ever pick up. If it was a review sync, a notification fan-out, or a reply publication, that unit of work simply never happened and nobody was told. Fifteen minutes is three health-check evaluation cadences: long enough that an operator actively redriving right now does not trip it, short enough that the loss is still recoverable.

**First three things to check:**

1. `ops:quarantine list` — what is in there, and how many distinct job names? One entry is a poison payload; a growing pile of one job name is a systemic handler failure.
2. The quarantine reason. Region/routing denials (`routing_blocked:*`, `wrong_cell`) are a policy problem, not a handler bug — see §12 and the `routing.region-attempts` alert. Anything else is a handler that threw past its retry budget.
3. `queue.quarantine.oldest_age_ms` versus `QUARANTINE_TTL_DAYS`. This tells you how much time is left before the TTL sweep deletes the evidence along with the work.

**Remediate:** fix the underlying handler failure FIRST (a redrive into a broken handler just re-quarantines), then `ops:quarantine redrive <id>` per entry — the redrive returns the job to its original queue. If the payload is genuinely undeliverable, record the identifiers in the incident before the TTL sweep removes it, because after that there is no record of what was lost.

**Verification:** `queue.quarantine.depth` returns to 0 and the redriven jobs complete in their original queue.

**Escalation:** Bozhidar Denev. Any quarantined entry that cannot be redriven is a data-loss event and needs written sign-off.

---

## 15. Notification Delivery Stalled

**Alerts:** `notification.missing-for-inbox-item` (P1) and `notification.email-stalled` (P2).

**What `notification.missing-for-inbox-item` means:** an inbox item exists with no notification attached — a review arrived, was projected into the inbox, and the user was never told. There is no benign cause and no self-healing path: nothing re-derives a missed notification, so the user will never learn about that review. A single occurrence pages. The usual cause is a handler that threw while the review commit had already succeeded: in-process delivery is best-effort (`emitAfterCommit` catches and warns), so a throw in the notification handler loses the notification silently while the review is safely committed.

**First three things to check:**

1. Worker logs for the notification handler around the affected window — look for the warn line from the after-commit emit (content-free: `correlationId`, counts, error class). That is where a lost notification leaves its only trace.
2. Whether the durable path is carrying anything: `OUTBOX_DISPATCHER_ENABLED` and the notification family's cutover flag. While the family ships `record-only` the durable consumer is registered but inert, so the in-process bus is the only live delivery path and a single throw is a permanent loss.
3. `outbox.unpublished` / `queue.oldest-age` — if the outbox is backed up, the gap may be delivery lag rather than a lost notification, and §7 is the right runbook.

**Remediate:** fix the throwing handler, then backfill the missing notifications for the affected inbox items (bounded, report-first — `ops:rebuild-projection` repairs the inbox projection; the notification backfill is a scripted replay of the affected events). Flipping the notification outbox family off `record-only` converts this failure mode from silent loss into a retried delivery and is the durable fix.

**What `notification.email-stalled` means:** queued notification emails are sitting `pending` more than two hours past their due time (`next_attempt_at` → `not_before` → `created_at`) — two missed hourly digest ticks, past any legitimate cadence, batching, or retry backoff.

**Read `notification.email.delivery_enabled` FIRST.** While it reads `0`, outbound email is capability-dark (`notification.send_email` is not globally enabled), the email job handlers are effectively inert, and a pending backlog is the EXPECTED state — this alert deliberately stays silent on it, so if you are reading it, one of two things is true: email is globally enabled and genuinely not going out, or `notification.email.attempted_stuck` is non-zero, meaning the delivery path reached those rows, tried, and left them pending. The second case fires even while the global flag reads `0`, because a per-organization allowlist grant is not globally enumerable and would otherwise breakage-hide.

**First three things to check:**

1. `notification.email.delivery_enabled` and `notification.email.attempted_stuck` — these two tell you which of the two cases you are in, and therefore whether to look at policy or at the provider.
2. If rows were attempted: `last_error_class` / `provider_state` on the overdue rows and the email transport logs. A provider outage, a suppression list, or an expired credential all land here.
3. If nothing was attempted and email IS enabled: the digest and urgent job registrations. `ops:queue status default` / `background` for `notification-urgent-email` and the hourly digest job; a no-op registration log line (`registered no-op job handler (capability dark/blocked)`) means the gate closed at boot and a restart is needed after the policy change.

**Remediate:** capability/policy cause → enable `notification.send_email` for the intended scope and restart the worker so the handler registers for real. Provider cause → fix the credential/suppression and let the retry schedule drain; rows keep their idempotency key, so replay cannot double-send. Never bulk-clear `pending` rows to silence the alert — that deletes the only record that a user was owed an email.

**Verification:** `notification.email.pending_overdue` drains and `notification.email.oldest_pending_overdue_age_ms` falls under two hours; `notification.email.attempted_stuck` returns to 0.

**Escalation:** Bozhidar Denev.

---

## 16. Error Monitoring Not Delivering

**Trigger/Symptoms:** A Data Cell refuses startup with `SENTRY_DSN is required`
or `Germany ingestion host`; logs contain `Error monitoring initialization
failed`, `capture failed`, or `flush timed out`; or the Sentry project receives
no web/worker events for the deployed release.

**Impact:** Application work continues when the SDK or ingestion transport
fails, but automatic error diagnosis and incident alerting are degraded. A
missing or non-Germany DSN is different: the affected Railway web/worker
process refuses startup because monitoring is mandatory for beta Data Cells.

**Prerequisites:** Named incident owner; access to the cell's Railway shared
variables and Germany-hosted Sentry project; candidate release SHA. Never paste
the DSN, event payload, review text, contact data, or credentials into a ticket
or chat transcript.

**Diagnostics:**

1. Confirm both `web` and `worker` use the same cell-scoped `SENTRY_DSN` and
   `SENTRY_TRACES_SAMPLE_RATE`, and that the DSN host ends in
   `.ingest.de.sentry.io`. There is intentionally no `SENTRY_ENABLED` switch.
2. Search content-safe boot logs by `releaseSha`, `processingCell`, and
   `service` for `Error monitoring initialized`. An SDK failure is logged as an
   error but does not expose the DSN or exception message.
3. Confirm the image command preloads
   `web-observability-preload.mjs`/`worker-observability-preload.js` before the
   application entry. A command override that omits `--import` is configuration
   drift even if the Nitro hook later appears to initialize.
4. In Sentry, filter by `release`, `environment`, `service`, and
   `processing_cell`. Events intentionally omit request bodies, headers,
   cookies, user/extra data, exception messages, breadcrumb content, local
   variables, and source context.

**Containment:** Do not disable monitoring. If a newly pinned SDK causes
resource or startup instability, roll back to the last signed image digest;
runtime SDK/transport exceptions already fail open. Treat any prohibited
content found in an event as a tenant-data incident and follow §9 immediately.

**Recovery:** Correct the shared Germany DSN or transport/project state and
redeploy the exact candidate through the normal promotion path. Do not add a
second worker process-level uncaught-error handler: RepKey owns worker
drain/exit and the Sentry worker defaults are deliberately removed to avoid
races and duplicates. Web retains the SDK's fatal handlers because it has no
equivalent application-owned fatal process boundary.

**Verification:** Send one controlled synthetic exception from each process in
each affected cell through the staging/RC drill. Verify one event per failure,
the correct release/environment/service/cell tags, readable stack frames, and
absence of the seeded secret, review, feedback, contact, cookie, and token
markers. Terminate web and worker once and confirm bounded flush completes
inside the Railway drain window.

**Escalation/Evidence:** Bozhidar Denev. Record cell, release SHA, service,
Sentry event ID, alert receipt, drill time, and scrubber inspection result. Do
not record event bodies. Source-map upload and external alert routing remain RC
evidence gates; runtime initialization alone does not close OBS-01.

---

## Alerts (BQC-7.4)

Every alert is defined in `src/shared/observability/alert-definitions.ts` (owner, severity per ADR 0038, threshold/window) and evaluated by the health-check job every 5 minutes against the OperationsSnapshot plus the aux reads (retention runs, policy denials, quarantine region-attempts).

**Dispatch:** every firing alert emits a schema-conformant structured `error` log line (`[alert] <name> firing`, fields: alert/severity/owner/runbook/value/threshold/windowMs/detail/firedAt — content-free) and, when `ALERT_WEBHOOK_URL` is set, POSTs the same payload to that operator webhook (3s timeout, best-effort — the log line is the durable record).

**Hysteresis:** edge-trigger — an alert dispatches on the ok→firing transition, re-notifies at most every 24h while continuously firing (Redis state key TTL), and clears on recovery so the next breach fires immediately.

| Alert                                 | Sev | Threshold / window                                                                                                              | Runbook |
| ------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------- | ------- |
| `worker.heartbeat.stale`              | P1  | heartbeat missing or age > 10min                                                                                                | §7      |
| `queue.oldest-age`                    | P2  | oldest unpublished outbox event > 15min                                                                                         | §7      |
| `queue.stalled`                       | P2  | any lease held > 2× its lease (single eval — stalled work IS the impact)                                                        | §7      |
| `queue.quarantine-growth`             | P2  | oldest quarantined job > 24h (redrive SLA)                                                                                      | §4      |
| `queue.quarantine-nonempty`           | P1  | any job in the unconsumed quarantine > 15min (dropped work; §4 is the same condition aged past the redrive SLA)                 | §14     |
| `source.freshness-deadline`           | P1  | nearest hard expiry among refresh-due reviews < 2d away                                                                         | §3      |
| `sync.sweep-lag`                      | P1  | oldest past-due incremental sync > 60min overdue (4 missed 15-min sweeps — new reviews are not arriving)                        | §13     |
| `retention.failure`                   | P1  | latest retention run failed for any subject                                                                                     | §8      |
| `reply.ambiguous-aging`               | P2  | oldest ambiguous publication > 15min past reconcile_due                                                                         | §6      |
| `routing.region-attempts`             | P2  | any quarantined wrong/unresolved/denied-region attempt                                                                          | §12     |
| `policy.denial-drift`                 | P2  | > 50 policy denials in the trailing hour (starting point — tune with real traffic; §11 for containment if drift confirms)       | §9      |
| `db.pool-exhaustion`                  | P1  | any connection request queued behind a saturated pool                                                                           | §8      |
| `notification.missing-for-inbox-item` | P1  | any inbox item with no notification (single eval — the user was never told and nothing re-derives it)                           | §15     |
| `notification.email-stalled`          | P2  | oldest overdue queued email > 2h AND (email globally enabled OR rows already attempted) — silent while email is capability-dark | §15     |

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
