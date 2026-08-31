# B3.9 — Operational Runbooks

**Date:** 2026-07-14
**Owner:** Bozhidar Denev
**Scope:** Internal beta operations

Each runbook follows the structure:
**Trigger/Symptoms → Impact → Prerequisites → Diagnostics → Containment → Recovery → Verification → Escalation → Evidence**

**Default incident commander: Bozhidar Denev.**
**Default communications/support owner: Bozhidar Denev.** The roles remain
separate in every incident record even while one person fills both during the
closed beta. The incident commander alone owns containment, recovery, and
stop/restart decisions. The communications/support role owns the status
timeline, manager-facing updates, provider/support cases, and the final
resolution notice. At incident opening, record the person filling each role;
delegation must be explicit and never implies authority to bypass a gate.

---

## Operator commands (BQC-7.5)

Every `ops:*` command runs through the operator-command harness
(`scripts/ops/operator-command.ts`). The invocation contract:

- `--operator <id>` — REQUIRED named operator; must be registered in
  `OPS_OPERATOR_IDENTITIES` (unregistered → `operator_not_registered` deny).
- Every invocation (reads included) is evaluated through the ExecutionPolicy
  operator branch and lands in `policy_decision_audit` (allow AND deny —
  content-free: actor/action/scope/decision/reason + correlation id, printed
  on every run). The sole first-empty-database exception is
  `release:migrate-cell`: it uses the same argument/identity harness but writes
  a canonical no-overwrite authorization artifact and digest sidecar before
  Railway mutation because the audit table may not exist yet.
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
- `ops:purge <reviews|reviews-shadow|retention>` — report Review lifecycle eligibility, Review expand/cache parity, or the static-rule retention backlog. Review targets are content-free and report-only even when enqueued; they never grant destructive apply. `retention --apply` remains destructive and requires typed confirmation. Do not treat local Review reports as production erasure or parity evidence. Inspect Google import lifecycle separately. §10
- `ops:rebuild-projection --org <id> [--property <id>]` — repair the inbox projection (bounded, dry-run report first). §5
- `ops:rebuild-metric-projection <portalId> --org <id> --property <id>` — inspect or repair one anonymous Portal lifetime projection from its sealed baseline plus retained governed facts. Dry-run is the default; apply requires `--reason`. §7
- `ops:reconcile-publication <replyId> | --all-ambiguous [--resume <token>]` — reconcile ambiguous Google reply publication (one frozen keyset page; provider re-read, never a send). §6
- `ops:reconcile-regions [--org <id>]` / `ops:reconcile-grants [--org <id> ...]` — report-first reconciliations (conflicts/anomalies never auto-converted). §12
- `ops:reconcile-people-team [--org <id>]` — reconcile retired Staff assignments into canonical participation, Portal responsibility, and Portal Group intervals while leaving Team relations opaque and untouched in quarantine. `--apply` requires `--evidence <new-json-path>`, verifies post-apply parity, and writes a version-2 artifact only when every supported mapping is exact. Version-1 artifacts are refused and must be regenerated. A release artifact must come from a global (no `--org`) run. §12
- `ops:cutover-single-us-data-cell` — report/fence/backfill/verify the one-time Data Cell policy-v3 transition. Apply handles at most one reviewed batch, remains fenced across invocations, and emits release evidence only after locked live verification. Follow `railway-data-cells.md`; never replace it with a deploy-time bulk rewrite.
- `infra:railway:google-content-approval <plan|apply|recover|verify>` — initial production `cell-us` Google Content approval activation. It consumes all four signed capability bundles in one private reviewed intent, requires all four capabilities killed and fully drained, installs retained exact-runtime approval rows, changes only the two approved shared variables, and leaves serving-source activation to `release:beta`. Follow `railway-data-cells.md`; the single-bundle `ops:google-content-approval` command remains validation-only.
- `pnpm exec tsx scripts/ops/report-people-authority.ts --operator <id> --as-of <ISO-8601> [--org <id>]` — produce the read-only, deterministic People authority report across membership, access, participation, attribution, manager responsibility, and retained Team/legacy rows. See `people-authority-reconciliation.md`; every non-`exact` row requires separate review.
- `ops:report-portal-beta-readiness --operator <id> --as-of <ISO-8601> [--org <id> ...]` — produce the read-only, deterministic POR-01 legacy Portal inventory. It reports identifier-only ownership/provenance, group, address/artifact, brand/locale, and raw-link gaps and has no apply mode. See `portal-beta-readiness-reconciliation.md`; ambiguous Portals remain Disabled/Archived and raw links quarantined until separately reviewed.
- `ops:report-guest-response-readiness --operator <id> --observed-at <ISO-8601> [--org <id> ...]` — produce the read-only, deterministic GST-01 Guest Response reconciliation. It classifies legacy Rating/Feedback/session relationships, audits canonical snapshot/lifecycle/Inbox/retention evidence, and retains separate 1–5 distributions plus source/correction/retraction identities. See `guest-response-reconciliation.md`; it has no apply or inferred-provenance path.
- `ops:triage-beta-feedback --operator <id>` — list the global content-free native-feedback support queue. Applying one exact local-reference transition additionally requires all 14 reviewed positional values, `--ticket`, `--reason`, and `--apply`; it is revision/transition-ID guarded, appends immutable evidence, and never reads report text/downloads attachments or creates an engineering issue. §16
- `ops:recover-recent-activity --operator <id> [--batch-size 100] [--apply --reason <text>] <observed-at> [<after-occurred-at> <after-replay-key>]` — report Recent Activity projection readiness or restore one bounded, cursor-resumable page from Activity-owned replay facts. Report-only is the default. See `recent-activity-recovery.md`.
- `ops:reconcile-recent-activity-vocabulary --operator <id> --org <id>` — report grouped historical Recent Activity vocabulary without content. Applying one reviewed source→canonical mapping additionally requires the exact report count/fingerprint, an operation UUID, `--ticket`, `--reason`, `--apply`, and typed confirmation. See `recent-activity-identifier-cutover.md`; unmappable pairs are never inferred.
- Operational Action History currently exposes a context-owned restricted
  AccountAdmin list/export seam, wired to current Identity authority, plus internal readiness, hold,
  redaction, and retention-assessment use cases. There is intentionally no
  standalone operator command or destructive retention apply yet. Follow
  `operational-action-history.md`; counsel approval is required before any
  destructive retention path is designed or enabled.
- `ops:suspend-property` / `ops:restore-property --org <id> --property <id> --ticket <ref>` — suspend/restore property processing. §10
- `ops:inspect region|policy ...` — read-only routing/policy decision explanation. §12
- `ops:disconnect-connection <connectionId> --org <id>` — revoke Google connection credentials (destructive; reconnect completes rotation). §2/§10
- `ops:gbp-subscribe --org <id>` — re-assert the organization's GBP `notificationSetting` at `GBP_PUBSUB_TOPIC` (idempotent PATCH per connection). Dry-run by default; `--reason <text> --apply` executes. Run it (a) to backfill tenants that connected before the import path subscribed automatically, and (b) after ANY change to `GBP_PUBSUB_TOPIC` — Google stores the topic on the GBP account, so existing subscriptions keep publishing to the old topic until this re-runs. Exits 1 on any candidate short of `subscribed`. §2
- `ops:restore-preflight` — guided runbook §8 restore preflight (isolated-target check, journal readability, backup-window checklist); NOT a PITR executor — restore is platform-owned. §8
- `ops:restore-verify` — restore-drill report and sealed apply surface (requires `RESTORE_MODE=isolated` plus an attested loopback/Railway PITR sibling target). Dry-run emits the bounded inventories and exact aggregate-only Review approval artifacts. Apply remains unavailable unless an independently reviewed, current, trusted Ed25519 bundle binds the exact target/run/generation/policy/report; a one-shot durable receipt rejects retargeting and reuse. See `review-lifecycle-recovery-approval.md`. Local code/tests are not a Railway drill or serving proof. §8
- Current on Google has no operator mutation command. Review publishes its content-minimal aggregate only after a double-scan-verified provider run and bounded reconciliation; Metric stores it outside bounded-period readings and hides it after a source-epoch rebind. Follow `current-google-reputation-snapshot.md`. There is no standalone rebuild command or production activation proof yet.
- Organization lifecycle has an Identity-owned request/status/recoverable-cancel application seam, quarantined bounded worker families, and a read-only `ops:report-organization-lifecycle` diagnostic. It still has no manager route, mutating independently authorized operator command, reviewed contributor set, cleanup/export/purge apply, or reactivation command. Follow `organization-lifecycle.md`. Never clear the Organization suspension merely because a lifecycle request was canceled.
- `ops:google-import-lifecycle inspect` — read the bounded global expiry/release backlog.
- `ops:identity-invitation-facts <inspect|switch-v2|scrub|verify|complete|rollback-v1>` — rolling v1→v2 invitation-fact privacy cutover, bounded PostgreSQL/Redis/quarantine scrub, and zero-copy verification. Follow `identity-invitation-fact-cutover.md`; mutating phases require paused `default` and `domain-events` queues.
- `ops:google-import-lifecycle inspect-request <importJobId> --org <id>` — identifier-only tenant request inspection.
- `ops:google-import-lifecycle cancel-request <importJobId> --org <id>` — dry-run by default; `--apply --reason <text> --yes ops:google-import-lifecycle` fences, receipt-reconciles, terminalizes, and scrubs one request.
- Google import compatibility mutations (`switch-connected-events`,
  `switch-oauth-state`, `mark-v1-events-drained`, `quiesce-legacy`,
  `drain-legacy-queues`, `close-legacy`, `archive-legacy`) run only from the
  rollout-only `Dockerfile.google-import-compatibility` image. Production web
  and worker images contain no compatibility entry point.

`pnpm release:migrate-cell` is the audited schema stage for every signed
candidate; on the first rollout it also installs the `0140` cutover authority.
Its dry run validates the canonical signed manifest, migration head, and fresh
full-candidate plan artifact without invoking Railway. `--apply --operator <id>
--reason "<text>" --audit-evidence <new-json-path>` uses the same harness,
requires membership in `OPS_OPERATOR_IDENTITIES`, and creates the canonical
authorization artifact plus SHA-256 sidecar before any Railway command. It
then pins Railway's opaque project/environment IDs, proves `cell-us` is the
project's only environment and all eight managed services have exactly one
instance there, and saves an IaC plan that changes only the restart-`NEVER`
`schema-migrator` source to the manifest's exact web image. It applies that
same plan and accepts only a newly observed `SUCCESS` deployment reporting that
digest. The job has only database, auth, and migrator variables. On the first
rollout, run it before
`ops:cutover-single-us-data-cell`; never replace it with `pnpm
db:migrate-deploy` from a working tree. Recapture the full-candidate plan after
it succeeds. `release:beta` continues to use the database-backed operator audit
below.

The manifest's `contract.releaseControllerSha256`, plan evidence's
`release.controllerSha256`, and recomputed local release-authority digest must
match before Cosign, Railway, or audit actions. The migrator rechecks after
Cosign, and its version-2 authorization artifact records the signed digest. A
matching IaC digest alone is not release authority.

`pnpm release:beta` is an operator command too — it just does not run through
the `ops:*` harness until `--apply`:

- `pnpm release:beta --manifest <file> --signature-bundle <file>
--manifest-sha256 <sha256> --people-cutover-evidence <file>
--data-cell-cutover-evidence <file> --data-cell-cutover-evidence-sha256 <sha256>
--railway-plan-evidence <file> --railway-plan-evidence-sha256 <sha256>
--cell <us>` — validate the canonical CI promotion manifest, the completed
  Data Cell transition, and the exact reviewed Railway target before printing
  the ordered `cell-us` plan. Dormant future cells are refused.
  Dry-run invokes no Railway command.
- Add `--apply --operator <id> --reason "<text>"` for the audited
  path: it runs through the same harness as every `ops:*` mutation, so the
  operator must be in `OPS_OPERATOR_IDENTITIES` and the decision lands in
  `policy_decision_audit`. There is no unaudited promotion bypass; emergency
  releases still require a named operator, reason, durable decision row, and
  signature verification.
- Promotion never uploads or rebuilds a working tree. Before its first Railway
  mutation, it matches the retained Data Cell evidence to a freshly locked
  live `us`/policy-3 topology check, recomputes global people-authority parity,
  requires an exact live rerun of the retained manifest-bound full-candidate
  plan, and matches the currently linked Railway project/environment names and
  IDs exactly. It rejects any additional environment or missing/duplicate
  managed service instance, verifies the Sigstore bundle and legacy
  revision-variable absence, then saves and applies
  one non-destructive IaC source plan at a time for each exact
  `repo@sha256:...` image. It settles provider Redis, then deploys `web` so its
  IaC-owned migration command idempotently rechecks the already-migrated schema
  before the remaining services. The final full-candidate plan must be
  no-drift. `railway service source connect` is prohibited.
- Promotion also binds manifest `contract.releaseControllerSha256` to plan
  `release.controllerSha256` and the recomputed local controller sources before
  Cosign/Railway/audit work. It rechecks after Cosign and again immediately
  before dynamically importing the operator authority.
- Add `--verify-only` to read back the Data Cell and people cutovers, exact
  Railway target, post-apply no-drift plan, manifest/source/image identity,
  health, and AI heads without deploying. Any mismatch is blocking.

REL-01 evidence producers, in the order a release uses them. Each fails closed
rather than emitting a plausible artifact from absent input:

- `pnpm release:freeze-candidate` — pins one SHA before any proof is collected.
  Refuses a dirty worktree, a SHA that is not merged, generated-artifact drift,
  or an existing freeze file.
- `pnpm release:capture-readback` — writes the four typed promotion read-back
  artifacts, including when a check failed, and exits non-zero if any artifact
  failed or is schema-invalid, so a failed promotion cannot be quietly omitted.
- `pnpm release:deployed-journeys` — runs the isolated read-only browser project
  with zero retries against the production origin, after checking its
  authorization window.
- `pnpm release:observe-canary` — samples the production origin over GET only
  against the ratified threshold profile. It currently exits non-zero because
  the observation window duration in ADR 0059 is still an open decision for an
  operating owner; ratify it there first.
- `pnpm release:import-live-evidence` — normalizes an operator capture against
  the schema for one gate. It never synthesizes a field and names any missing
  one. `--list` prints the importable gate ids.
- `pnpm release:rehearse-recovery` — report-first. `--plan` writes one plan and
  stops; `--apply` proceeds only under an authorization whose digest equals that
  exact plan, with a named operator, a reason, and an operator-supplied platform
  receipt. Reverse DDL is rejected at plan build.
- `pnpm release:create-legal-revision-set` — refuses while any counsel-owned
  document is a draft, which is the current state.
- `pnpm release:prepare-approval` — prints the canonical payload each of the six
  roles signs offline. It holds no key material, so engineering cannot sign an
  approval that belongs to another role.

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
(platform owner — `ops:restore-preflight` plus the report-first, independently
approved `ops:restore-verify` are the current app-side surface; the Railway
apply/cutover drill and evidence remain external work; procedure:
docs/operations/backup-and-lifecycle.md).

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
The BQC-7.1 deployment contract (Dockerfile + `.railway/railway.ts` + this runbook)
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

## 1. Account Compromise and Session Revoke

**Trigger:** Suspected account compromise, reported credential leak, unauthorized access detected.
**Impact:** P0 — potential cross-tenant data access.
**Prerequisites:** Open a restricted incident record; name both operating roles; record the user pseudonym, Organization scope, `cell-us`, release SHA, discovery time, and correlation identifiers without copying account content or credentials.
**Diagnostics:** Check `audit_logs` for suspicious actions by the user ID. Check `session` table for active sessions.
**Containment:** Immediately invalidate all sessions for the user (`DELETE FROM session WHERE "userId" = $1`). Suspend the user's organization via `BETA_SUSPENDED_ORGS`.
**Recovery:** Require password reset. Re-verify email. Re-issue sessions only after identity confirmation.
**Verification:** Confirm no active sessions remain. Audit log shows no further activity from the compromised account.
**Escalation:** Page Bozhidar Denev immediately. Document incident timeline.
**Evidence:** Retain the incident timeline, content-free session revocation count, affected release/cell, identity-verification outcome, and signed recovery decision. Do not retain session material.

---

## 2. OAuth Token / Encryption Key Compromise

**Trigger:** Google OAuth token leak suspected, encryption key exposure detected.
**Impact:** P0 — unauthorized Google API access possible.
**Prerequisites:** Stop affected provider capabilities; name both operating roles; record only the connection pseudonym, cell, release, credential/key generation, and discovery time. Never copy token/key bytes.
**Diagnostics:** Check `google_connections` for the affected connection. Identify `encryption_key_id` version.
**Containment:** Kill Google capabilities and pause provider work first. `ops:disconnect-connection <connectionId> --org <id>` fences imports and redacts the local connection, but it is not revocation evidence until the governed OAuth revoke route is active: the production direct route is deliberately refused. During that transition, revoke the OAuth grant in the approved Google operator surface and attach its evidence. If the encryption key is compromised, begin key rotation — new tokens encrypted with the new key and old tokens re-encrypted (runbook-manual, platform owner).
**Recovery:** User must re-authenticate via Google OAuth. New tokens encrypted with new key version.
**Verification:** Confirm old tokens are revoked at Google through provider-authoritative evidence; a local disconnected row alone is insufficient. Confirm no API calls succeed with old tokens.
**Escalation:** Page Bozhidar Denev. Notify Google if API abuse detected.
**Evidence:** Retain capability-stop time, credential/key generation, provider revocation evidence identifier, reauthorization/rotation head, reconciliation outcome, and restart approval without provider content.

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
**Prerequisites:** Stop automatic retry for the affected operation, name both operating roles, and record only the reply/publication identifiers, cell, release, source epoch, and correlation id. Never paste Review/reply text into incident evidence.
**Diagnostics:** Check reply `publication_state`. If `outcome_unknown`/`ambiguous`, run reconciliation: `ops:reconcile-publication <replyId> --org <id>` (dry-run first, then `--apply`). For tenant-cross work, `ops:reconcile-publication --all-ambiguous --operator <id> --batch-size <n>` reads one bounded keyset page. A full page reports `coverage: "partial"` and returns `nextResumeToken`; pass it back with `--resume <token>` until that frozen `dueThrough` keyset segment reports `coverage: "complete"`. Resume tokens are mode-bound: continue a dry-run token only in dry-run, and restart without a token when changing to `--apply`. The command queries Google for current truth and never sends a reply. Check `event_consumer_receipts` for duplicate processing.

`coverage` describes scanning, not healing. Each report's outcome counts cover only `current_page`; `startedAfter` and `dueThrough` define the exact frozen keyset segment proved by that invocation. Keep the ordered page reports when claiming end-to-end sweep coverage. `notConfirmed`, `failed`, or `unresolvedInPage` remain unresolved even when the segment is complete, and a fresh sweep without `--resume` revisits persistent rows. Run a fresh sweep after completing a continuation chain to include work that became due after its frozen `dueThrough` boundary.
**Containment:** If duplicate found, do NOT delete from Google (may confuse the reviewer). Document the duplicate. If `outcome_unknown`, prevent retry until reconciliation completes.
**Recovery:** Reconciliation determines actual state → `published`, `retryable`, or `manual_review`. If duplicate, file incident report.
**Verification:** Exactly one reply visible on Google. Publication workflow in terminal state.
**Escalation:** P0 — page Bozhidar Denev immediately for confirmed duplicates.
**Evidence:** Retain the publication state transitions, each bounded reconciliation page/coverage token, provider-truth result, receipt/idempotency outcome, and final decision without Review or reply content.

---

## 7. Redis Loss / Backlog / Poison Job

**Trigger:** Queue Redis or Cache Redis unreachable, queue backlog building, or a poison job crashing workers repeatedly.
**Impact:** P1 — external effects delayed.
**Prerequisites:** Name both operating roles; capture the exact `cell-us` release/config heads, queue family, oldest-age/depth snapshot, worker heartbeat, and stop time. Do not record job payloads.
**Diagnostics:** Check Redis connectivity and worker boot logs. `BullMQ Redis runtime verified` records the non-secret Redis version, `noeviction` policy, and GETDEL capability; `[CONFIG] BullMQ Redis runtime is incompatible: <code>` means the process refused a missing, uninspectable, unsupported, or eviction-capable queue store. Check BullMQ stalled/failed counts and identify the poison-job pattern.
**Containment:** If Queue Redis is down, the Postgres outbox accumulates events without losing accepted durable facts; serving processes stay live but readiness degrades. If Cache Redis is down, cache reads degrade and production rate-limited public actions fail closed without affecting queue keys. If poison job: quarantine via dead-letter, stop retry cycle.
**Recovery:** Rebuild/restore only the failed Redis resource, preserve the distinct `REDIS_URL`/`QUEUE_REDIS_URL` mapping, then let the relay drain the backlog. Poison job → fix handler code, redrive from DLQ.
**Verification:** Queue depth normal. No repeated failures. Outbox `published_at` advances.
**Escalation:** Bozhidar Denev if backlog > 30 minutes.
**Durability posture:** Redis is disposable-and-rebuild — the Postgres outbox is the durable fact store, no AOF is required for correctness (backup-and-lifecycle.md §2). BullMQ history prunes by count; dead-letter quarantine entries expire after `QUARANTINE_TTL_DAYS` (default 30d) via the daily `quarantine-ttl-sweep` (per-entry `job.remove()`, evidence subject `quarantine.ttl`) — the 24h `queue.quarantine-growth` redrive SLA is unchanged.

**Connection policy:** Request, relay, scheduler, and operator `Queue` producers use one request retry plus a 5-second connect/command timeout. They return failure to the caller (or leave a durable outbox row unpublished for the next relay pass) instead of waiting forever. `Worker` blocking connections use `maxRetriesPerRequest=null` and continue reconnecting; SIGTERM/SIGINT stops new claims and the worker drain budget bounds shutdown. The sole producer exception is the worker-owned failure-quarantine publication barrier: it also uses `maxRetriesPerRequest=null` with no command timeout because a client timeout cannot cancel an already buffered Redis command. Its handler stays unsettled while the process is live, and every invitation payload/failure reason is sanitized before the add so privacy does not depend on lock retention. Do not copy this exception to request, relay, scheduler, or operator producers.

**Process-failure policy:** The first SIGTERM/SIGINT owns one bounded drain and exits 0. The first `unhandledRejection` or `uncaughtException` is fatal: its centrally sanitized error identity is logged, the same drain runs, and the process exits 1 so Railway restarts it. Later signals/failures cannot start competing close sequences; a rejecting drain forces exit 1.

**Evidence:** Retain before/after queue and outbox age/depth, the content-free process/drain sequence, quarantine/redrive decision, replay/idempotency check, alert receipt, and recovery time. Never attach a BullMQ payload or error message.

---

## 8. Database Saturation / Failed Migration / Restore

**Trigger:** Connection pool exhausted, slow queries, migration failure, or restore needed.
**Impact:** P0 for migration failure or data loss. P1 for saturation.
**Prerequisites:** Name both operating roles and record the exact cell, release manifest, migration head, failed phase, source database service, last known good digest/config, and backup/PITR observations. Do not start a restore until the exact sibling target and independent Review lifecycle approval path are available.
**Diagnostics:** Check `pg_stat_activity` for connection count. Check the Railway console (Postgres service metrics) for compute/storage. Check migration logs.
**Containment:** Reduce worker concurrency. Pause non-critical jobs. If the predeploy migration failed: the deploy is already blocked (Railway `preDeployCommand` exited non-zero) — the previous containers keep serving; do NOT hand-roll partial schema state.
**Recovery:** Saturation → tune pool sizes, add indexes. Migration → forward recovery only: the trio (`scripts/migrate-deploy.ts`, advisory-locked, idempotent) leaves no half-applied state beyond its idempotent steps — fix the failing migration/sidecar SQL forward and redeploy; the rerun converges (see the script header + src/shared/db/CONTEXT.md "Deploy apply order"). Never roll the schema back mid-flight. Restore → follow [backup-and-lifecycle.md](backup-and-lifecycle.md) §1 exactly: contain one Data Cell → Railway PITR to its generated sibling service → exact-target preflight through a Railway tunnel → migration parity → dry-run inventory → destructive retention/recovery fence → isolated signed-image read verification → fresh Redis and controlled connection cutover with the verified recovery run/generation pinned. Railway leaves the live source serving; volume restore is not this procedure. Restore-only variables are verifier-service/process scoped; the cutover run/generation remains on every sibling consumer as its permanent boot attestation. Restore is the only database rollback path, reserved for data loss.
**Verification:** Connection count under budget. Migration journal consistent. Restore has one replayable `recovery_runs` generation, zero overdue retention/Google-import backlog, zero unfenced restored authority, no claimable fenced outbox rows, critical reads/tenant isolation green, fresh empty queues, and no duplicate external effect before cutover.
**Escalation:** P0 — page Bozhidar Denev for migration/restore. Railway support if platform issue.
**Evidence:** Retain migration/backup heads, failure class, forward-fix or restore decision, signed recovery report/bundle identifiers, source/sibling and fresh-Redis identities, cutover/rollback read-backs, RPO/RTO, and alert receipts. Local tests are not this evidence.

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
**Recovery:** Archive → data preserved, can restore to `active`. General retention purge → irreversible, confirm via typed property name and re-run with `ops:purge retention --reason <text> --apply --yes ops:purge`. Review expiry purge is unavailable while SAFE-03 quarantine is active; escalation cannot bypass it with configuration. Property/member/connection/org removal fences matching import parents/items and invalidates provider references before authority disappears.
**Verification:** Lifecycle state correct. `ops:google-import-lifecycle inspect` reports zero overdue/release backlog; scoped inspection reports no outstanding authority. Purge evidence includes `integration.google_import_v2.lifecycle`.
**Escalation:** Purge requires operator confirmation + evidence report. Review raw-content erasure additionally requires the reviewed REV-01 cutover; until then it blocks release. Bozhidar Denev signs off.

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
**Prerequisites:** Name both operating roles; record the exact `cell-us` project/environment, affected services/dependencies, release/config heads, first failed external probe, and provider incident identifiers.
**Diagnostics:** Compare the external `cell-us` availability and sidecar-readiness probes with PostgreSQL, Cache Redis, Queue Redis, provider-status, release-SHA, and configuration-drift signals. Confirm that every denied `europe` or `global` routing attempt remains a refusal rather than a fallback.
**Containment:** Do NOT fail over to another region (policy: no silent cross-region data movement). Set readiness to 503. Show honest "service unavailable" state.
**Recovery:** Wait for provider recovery. Outbox accumulates events (no data loss). Resume normally when infrastructure recovers.
**Verification:** All dependencies healthy. Backlog drained. Freshness indicators return to normal.
**Escalation:** Bozhidar Denev. Provider support tickets (Railway, Redis provider, Google Cloud).
**Evidence:** Retain outage/probe timeline, provider cases, `europe`/`global` fallback-refusal result, readiness recovery, queue/outbox reconciliation, freshness recovery, and restart decision without tenant content.

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

1. `ops:quarantine list` — what is in there, how many distinct job names, and is each entry `confirmed_failed`? One entry is a poison payload; a growing pile of one job name is a systemic handler failure. `pending_failure` means the worker staged evidence before rejecting but did not observe BullMQ's completed failed transition; redrive requires fresh proof that the original remains failed, so a recovered/completed original cannot be duplicated.
2. The quarantine reason. Region/routing denials (`routing_blocked:*`, `wrong_cell`) are a policy problem, not a handler bug — see §12 and the `routing.region-attempts` alert. Anything else is a handler that threw past its retry budget.
3. `queue.quarantine.oldest_age_ms` versus `QUARANTINE_TTL_DAYS`. This tells you how much time is left before the TTL sweep deletes the evidence along with the work.

**Remediate:** fix the underlying handler failure FIRST (a redrive into a broken handler just re-quarantines), then `ops:quarantine redrive <id>` per entry — the redrive returns the job to its original queue. For `pending_failure`, the apply path first reads the original job and proceeds only when BullMQ still reports it as `failed`; that proof idempotently confirms the staged copy. A recovered, active, waiting, completed, or missing original is refused and must not be force-redriven. Invitation-event and invitation-Activity payloads are sanitized again at this move boundary, so a concurrent privacy-verification scan cannot miss content moved between queues. If the payload is genuinely undeliverable, record the identifiers in the incident before the TTL sweep removes it, because after that there is no record of what was lost.

**Verification:** `queue.quarantine.depth` returns to 0 and the redriven jobs complete in their original queue.

**Escalation:** Bozhidar Denev. Any quarantined entry that cannot be redriven is a data-loss event and needs written sign-off.

---

## 15. Notification Delivery Stalled

**Alerts:** `notification.in-app-delivery-lag` (P1), `notification.immediate-email-acceptance-lag` (P2), `notification.missing-for-inbox-item` (P1), and `notification.email-stalled` (P2).

**What `notification.in-app-delivery-lag` means:** an active beta Notification source fact has remained incomplete for more than 60 seconds from its durable source clock. `notification.delivery.source_receipt_pending` is source work the durable consumer has not acknowledged; `notification.delivery.materialization_pending` is Redis-accepted work without its atomic PostgreSQL notification/materialization receipt. The alert uses the oldest outstanding source age as a breach signal. It does not by itself prove the deployed p99 latency distribution.

**First three things to check:**

1. Read both pending counts and their saturation gauges. A saturated count is a lower bound, shown with `+` in the alert detail; do not treat it as an exact backlog size.
2. Compare `notification.delivery.oldest_materialization_source_age_ms` with `notification.delivery.oldest_materialization_enqueue_age_ms`. A large source age with a small enqueue age points to outbox/dispatch delay; both growing points to the insert-notification worker, PostgreSQL settlement, or Queue Redis.
3. For missing source receipts, inspect outbox dispatcher/`domain-events` health. For missing materializations, inspect the insert-notification job state and quarantine before changing any receipt.

**Remediate:** restore the failing stage first. Missing base receipts replay through the durable outbox consumer; deterministic per-recipient job identities converge repeated enqueue. Redis-accepted work normally repairs through BullMQ retry/redrive, and PostgreSQL settlement makes a replay duplicate-safe. If Queue Redis state was lost after its enqueue receipt committed, the lag report deliberately stays red but cannot reconstruct a job from receipt hashes; perform a bounded scripted replay of the affected source facts only after proving the materialization receipt is absent. Never delete a materialization receipt or invent a notification row to silence the gauge.

**Verification:** both pending counts return to 0, both saturation flags are false, and all oldest source/enqueue clocks and ages return to null. Retain a separate deployed latency record for the p99 ≤60-second target.

**What `notification.immediate-email-acceptance-lag` means:** immediate email that was eligible to send exceeded five minutes from its durable source fact to provider acceptance, or the bounded evidence cannot evaluate that target safely. The signal combines completed source-to-acceptance p99 with the oldest still-awaiting source age. A retained `not_before` quiet-hours or policy hold is intentionally excluded from both. This target is operational evidence, not a customer SLA.

The alert remains quiet when email is globally dark and the database contains only untouched, source-linked backlog. An accepted sample or an attempted row proves narrower delivery activation and makes the latency signal relevant even when the global capability gauge is `0`. `notification.email.immediate_acceptance_source_unlinked > 0` and `notification.email.immediate_acceptance_saturated = 1` are independent evidence failures: the first has no trustworthy durable clock, while the second means the 1,000-row bounded scan cannot report a full-window p99.

**First three things to check:**

1. Read `notification.email.immediate_acceptance_p99_ms`, `notification.email.immediate_acceptance_oldest_source_age_ms`, and the accepted/awaiting sample counts. This distinguishes completed provider delay from work still awaiting acceptance.
2. Check `notification.email.immediate_acceptance_source_unlinked` and `notification.email.immediate_acceptance_saturated` before interpreting the latency value. Do not treat a missing p99 as healthy when either is non-zero.
3. For linked attempted rows, inspect the immediate-email worker and provider response classes. For unattempted rows while email is enabled, inspect job registration, Queue Redis, and the per-Organization capability decision. For unlinked rows, inspect the notification's content-free event identifier and active durable route; do not infer a source timestamp from queue insertion.

**Remediate:** restore the earliest failing stage. Repair source linkage or durable routing before using the latency target; restore the immediate-email worker/provider path for attempted or waiting rows and let its existing idempotency/retry state converge. A saturated scan requires draining the backlog or a separately reviewed increase supported by query/index evidence. Do not clear rows, rewrite source/acceptance clocks, or remove legitimate policy holds to make the alert quiet.

**Verification:** source-unlinked and saturation return to `0`; awaiting and attempted-awaiting drain; the oldest awaiting source age returns to null; and an unsaturated accepted sample reports p99 at or below 300,000 ms. Retain a deployed provider acceptance record and alert-injection result separately—the local snapshot is necessary evidence, not proof of the deployed target.

**What `notification.missing-for-inbox-item` means:** an inbox item past the grace edge still has no notification attached — a review arrived, was projected into the inbox, and nobody has been told yet. The bounded `reconcile-missing-notifications` sweep is the repair authority, so a non-zero count means either ordinary delivery is late or that repair is not keeping up. A single occurrence pages because the manager-facing journey is already incomplete.

**First three things to check:**

1. Worker logs for the notification handler around the affected window — look for the warn line from the after-commit emit (content-free: `correlationId`, counts, error class). That is where a lost notification leaves its only trace.
2. Whether the durable path is carrying anything: `OUTBOX_DISPATCHER_ENABLED` and the notification family's cutover flag. While the family ships `record-only` the durable consumer is registered but inert, so the in-process bus is the only live delivery path and a single throw is a permanent loss.
3. `outbox.unpublished` / `queue.oldest-age` — if the outbox is backed up, the gap may be delivery lag rather than a lost notification, and §7 is the right runbook.

**Remediate:** fix the throwing handler or stalled worker first, then let the bounded `reconcile-missing-notifications` sweep re-enqueue the affected items through the ordinary preference-aware path. If the sweep cannot resolve the candidates, use a bounded report-first replay of the affected source facts. The active durable consumers are the primary prevention path; do not disable them or manufacture rows directly.

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

> **Current repository status (2026-08-28):** web and worker have executable
> preload/capture/flush wiring. All four retained sidecars now initialize the
> same scrubbed SDK before dynamically loading their protected runtimes,
> capture startup/process/dependency failures, flush during their sole bounded
> shutdown path, and remove competing SDK fatal handlers. Final route
> exclusions and the consent/create/preview/remove/cancel flow are implemented
> for the Bug-only masked-layout wireframe; ordinary screenshots and every
> `Replay*` integration remain absent. Source-map upload, Germany-project and
> provider-retention inspection, external journey monitoring, alert routing,
> and the supported-device drill remain OBS-01/release evidence. Local bundle,
> browser-story, migration, and scrubber tests are implementation evidence, not
> live Germany-project delivery, expiry, or alert-routing evidence.

**Trigger/Symptoms:** A Data Cell refuses startup with `SENTRY_DSN is required`
or `Germany ingestion host`; logs contain `Error monitoring initialization
failed`, `capture failed`, or `flush timed out`; or the Sentry project receives
no web/worker/sidecar events for the deployed release.

**Impact:** Application work continues when the SDK or ingestion transport
fails, but automatic error diagnosis and incident alerting are degraded. A
missing or non-Germany DSN is different: the affected Railway web, worker, or
sidecar process refuses startup because monitoring is mandatory for beta Data
Cells.

**Prerequisites:** Named incident owner; access to the cell's Railway shared
variables and Germany-hosted Sentry project; candidate release SHA. Never paste
the DSN, event payload, review text, contact data, or credentials into a ticket
or chat transcript.

**Diagnostics:**

1. Confirm `web`, `worker`, and all four retained sidecars use the same
   cell-scoped `SENTRY_DSN` and `SENTRY_TRACES_SAMPLE_RATE`, and that the DSN
   host ends in `.ingest.de.sentry.io`. There is intentionally no
   `SENTRY_ENABLED` switch.
2. Search content-safe boot logs by `releaseSha`, `processingCell`, and
   `service` for `Error monitoring initialized`. An SDK failure is logged as an
   error but does not expose the DSN or exception message.
3. Confirm the image command preloads
   `web-observability-preload.mjs`/`worker-observability-preload.js` before the
   application entry. Each sidecar's bundled entry must call
   `runSidecarStartup` before its dynamic protected-runtime import. A command or
   bundle override that bypasses either boundary is configuration drift.
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
second worker or sidecar process-level uncaught-error handler: RepKey owns their
drain/exit and the matching Sentry defaults are deliberately removed to avoid
races and duplicates. Web retains the SDK's fatal handlers because it has no
equivalent application-owned fatal process boundary.

**Verification:** Send one controlled synthetic exception from each process in
each affected cell through the staging/RC drill. Verify one event per failure,
the correct release/environment/service/cell tags, readable stack frames, and
absence of the seeded secret, review, feedback, contact, cookie, and token
markers. Terminate web, worker, and each retained sidecar once and confirm
bounded flush completes inside the Railway drain window. Exact health and
private-metrics polling transactions must be absent; ordinary product
transactions remain present only after strict scrubbing.

Before that deployed drill, run the repository-owned cross-surface canary at
`src/shared/architecture/privacy-exfiltration-canary.test.ts`. It exercises the
same secret/review/contact markers through logs, traces, Sentry scrubbing,
metric labels, durable facts, and the masked-layout attachment boundary. It
proves the synthetic markers cannot enter the geometry/SVG contract while
ordinary screenshot/base64/replay shapes are rejected. A green local canary
does not substitute for provider inspection.

**Escalation/Evidence:** Bozhidar Denev. Record cell, release SHA, service,
Sentry event ID, alert receipt, drill time, and scrubber inspection result. Do
not record event bodies. Source-map upload and external alert routing remain RC
evidence gates; runtime initialization alone does not close OBS-01.

### Native beta feedback intake and triage

The authenticated top bar exposes **Beta feedback** to authorized beta
managers. Bug and Suggestion remain separate strict contracts. Suggestions are
always text-only. A Bug may optionally include one `masked-layout-v1` preview
on an explicitly allowlisted, non-sensitive authenticated route. It is a
low-resolution geometry wireframe rendered from closed block kinds, not an
ordinary screenshot or Replay payload. Text, input values, images, media,
URLs, colors, request data, and arbitrary client attachment bytes cannot enter
that contract.

Consent is per submission: checking the consent box does not capture anything.
Capture starts only when the manager chooses **Create preview**. The manager
can inspect and remove the preview before sending. Removing it, unchecking the
control, switching away, or canceling/closing the dialog discards the local
snapshot. Sensitive routes—including Inbox/private feedback, Google/OAuth,
Security, uploads, public Portal, unknown routes, and Property Review pages—do
not expose the control. SDK Replay integrations remain absent globally.

The server first writes a content-free local UUID receipt, then sends the
manager-authored report to the restricted monitoring project. PostgreSQL stores
only controlled type/impact/route/viewport/role values, audience-separated HMAC
pseudonyms, delivery/triage state, masked-layout presence and expiry clocks,
provider linkage, and append-only transition evidence. It never stores report
text or SVG bytes. The provider event is tagged with the local reference; the
private provider reference is not returned to the manager or printed by the
queue report. A malformed/missing provider receipt leaves the local record
failed and returns a retryable 503. If provider delivery succeeds but the final
database update fails, the record remains `prepared`; search the restricted
provider project by the local reference and retain the reconciliation finding.
There is currently no unaudited/direct-database settlement shortcut.

Masked layout expiry is calculated by the server at exactly 30 days from
capture and the delivery seam rejects a longer or invalid lifetime. This local
clock does not configure deletion at Sentry: the provider/project attachment
retention must independently be set to no more than 30 days and verified before
activation. Report-event retention, operator access, the notice, and the
subprocessor/region record also remain subject to the approved retention and
legal review.

Limits are five submissions per actor/hour and twenty per Organization/day,
actor first. Production Redis failure denies submission. Do not add a direct
browser-to-Sentry call: the server is the authentication, abuse,
pseudonymization, validation, rendering, and provider-delivery boundary.

Use the content-free operator queue first:

```text
pnpm ops:triage-beta-feedback --operator <registered-operator>
```

Apply changes to exactly one local reference with the 14 reviewed positional
values printed by the command usage, plus `--operator`, `--ticket`, `--reason`,
and `--apply`. Every mutation is optimistic-concurrency protected by the
expected revision, exact transition-ID retries are idempotent, and the state
change plus immutable transition evidence commit together. Never paste the
report text into command arguments, tickets, logs, or engineering issues.

Triage each delivered report in this order:

1. **Privacy and security screen:** classify `privacy` and `security` before
   ordinary reproduction. Escalated privacy and suspected/confirmed security
   reports move immediately to their restricted queue and invoke §9. Do not
   copy the event body elsewhere.
2. **Impact:** choose P0–P3 using the actual manager impact and whether a
   critical journey is unavailable. `cannot_complete`, privacy, or security
   concern receives an immediate incident handoff rather than waiting for the
   normal queue.
3. **Validate and reproduce:** use only controlled tags and approved synthetic
   fixtures. Never ask a manager to paste guest/review/contact data into a
   ticket.
4. **Dedupe and assign:** choose `unique` or link a different delivered local
   reference as `duplicate`; assign one pseudonymous owner and the correct
   queue. The controlled states are `new`, `screened`, `reproducing`,
   `accepted`, `declined`, and `resolved`.
5. **Engineering handoff:** manually create/link a private engineering issue
   only after acceptance. Store only the safe issue reference in triage; never
   auto-create an issue or copy provider content.
6. **Close the loop:** record `sent` or `not_required` before resolution and
   respond through the agreed beta support channel without exposing another
   tenant or report.

Regular feedback is reviewed during office hours; next business day is an
expectation, not a guarantee. P0 status updates are hourly until containment,
P1 updates occur each business day, and P2/P3 updates follow material triage
state changes. After hours, use only the existing bounded containment controls:
disable an affected non-core capability, suspend affected Property processing,
pause the affected queue without deleting work, or roll back to the last signed
release. A core journey outage uses the incident commander and §11; it is not
silently hidden by a capability toggle.

The exact one-cell journey-monitoring and support contract lives in
`src/shared/observability/beta-support-operations.ts`. Google sync and ambiguous
reply aging already have application signals. The content-free
`beta-feedback.triage-backlog` application alert fires when the oldest delivered,
unresolved local receipt is older than 72 hours, or fails visible when its
aggregate database observation is unavailable. It reports only count and age;
the next-business-day review target remains an expectation rather than an SLA.
Invitation/onboarding, Google connection/import, Inbox, Portal gateway, and
native-feedback delivery still require external synthetic configuration. Those
external rows and the alert-delivery drill remain **external evidence required**,
not a claim that a dashboard or alert route is deployed.

For local verification, submit one Bug and one Suggestion from manager
fixtures; prove the Suggestion cannot carry an attachment; exercise consent,
preview, remove, cancel, sensitive-route denial, and the exact 30-day envelope;
inspect tags for raw IDs; exceed each Redis budget; stop capture and prove
503/no delivered receipt; seed email/token/review/contact markers through every
boundary; and exercise CAS plus exact transition retry on a fresh migrated
PostgreSQL database. Full OBS-01 closure additionally requires the Germany
project inspection, one test event per process/cell, inbound scrubber and source
map inspection, external alert receipt, supported-device manual journey,
provider expiry proof, and legal/retention approval.

---

## 17. Governed Job Runtime Contract Unready

**Alert:** `worker.job-runtime-unready` (P1) — at least one governed job
family is alive but does not satisfy its executable runtime contract.

**What it means:** the worker heartbeat alone is not enough. The identifier-only
job report joins the governed catalogue to the current handler set, live BullMQ
schedulers and retained jobs, Queue Redis boot/success/failure heads, and the
quarantine. A firing alert therefore means the report is unavailable, at least
one active family has a missing handler or scheduler, missed its last-success or
queue-age objective, stalled, needs repair, or has a dead letter; or a
dark/quarantined family has forbidden executable work. The report retains the observed cell, owner,
processor, action, capability, queue policy, cadence, timeout, concurrency,
freshness objectives, runbook, and repair command for each family. It contains
no tenant or payload content.

**First three things to check:**

1. Read `/api/health/metrics` and inspect `jobs.rows` where `ready` is false.
   Treat the row's stable `reasons` as the diagnosis; do not infer health from
   a recent heartbeat or an empty queue.
2. For `handler_missing` or `scheduler_missing`, compare the deployed release
   identity and capability policy with the row's processor/capability/schedule.
   A dark family with a handler, scheduler, queued item, or post-boot execution
   is a containment failure; do not redrive it.
3. For missed objectives, stalled work, repair-required state, or dead letters,
   inspect the original queue and run `pnpm ops:quarantine list --operator
<registered-operator>` before applying the row's exact repair command.

**Remediate:** repair configuration/handler/scheduler drift by promoting a
reviewed immutable release; never register an ad-hoc handler or repeat entry in
Redis. Remove forbidden dark/quarantined schedules through normal scheduler
reconciliation and disposition their queued work without executing it. For an
active poison item, fix the handler cause first, review the quarantine report,
then execute the row's report-linked redrive command. A domain-specific
reconciliation or rebuild remains authoritative when its runbook says replaying
one queue item cannot reconstruct the projection.

**Verification:** `jobs.ready` is true; `jobs.failing`, missing handler/scheduler,
forbidden-dark-work, missed-objective, queue-age, stalled, repair-required, and
dead-letter counts are all zero; every active scheduled row has a recent
`lastSucceededAt`; and a second health-check cadence remains green after a
worker restart.

**Escalation:** Bozhidar Denev. A dark family that executed, or an active family
that cannot be deterministically repaired, is a release blocker.

---

## 18. Guest Observation Loss or Monitor Unavailable

**Alert:** `guest.observation-loss` (P1) — at least one best-effort scan or
qualified review-link observation was suppressed in the trailing 24-hour
window, or the shared loss monitor cannot prove a complete retained window.

**What it means:** the approved public journey remained available, but its
analytics completeness is either measurably below 100% or currently unknown.
The authority is one global Cache Redis hash. It contains only a continuity
epoch and five-minute fields named for the closed class `scan` or
`review_link` plus bucket epoch. Keeping coverage and counters in one evictable
unit prevents partial key eviction from looking like zero. It contains no
Organization, Property, Portal, destination, session, network pseudonym,
rating, content, or staff identity. Every access removes fields outside the
24-hour window and refreshes a 24-hour-plus-one-bucket TTL on the single key.
The aggregate survives web/worker replica and process restarts. After Cache
Redis loss/reset/eviction, `monitorAvailable` remains false for one complete
24-hour window, making incomplete history visible instead of inventing zero
evidence.
When that outage also removes alert hysteresis state, the health checker still
dispatches fail-visible without prior-state suppression; repeated alerts on the
five-minute cadence are expected until Cache Redis returns.

Private rating is deliberately `not_applicable_durable` with loss count zero
in this signal. A rating command commits its canonical response fact and
outbox row atomically or fails for an honest retry; an ordinary retryable
rating error must never be relabelled as lost analytics.

**First three things to check:**

1. Read `/api/health/metrics`. If `monitorAvailable` is false or the
   `guest.observationLoss` degraded marker is present, check Cache Redis health,
   connectivity, recent restart/flush history, and the separate
   `worker.heartbeat.stale` signal before interpreting any count. After a known
   reset, keep the incident open through the full 24-hour warm-up window.
2. If the monitor is available, compare only the global `scanLossCount` and
   `reviewLinkLossCount`. Do not seek tenant, Portal, session, destination, or
   guest identifiers: they were intentionally never retained.
3. For scan loss, check Access Artifact/Guest observation-store health. For
   review-link loss, check the network-pressure authority and atomic
   destination-action store/outbox health. Use controlled synthetic Portal
   actions to reproduce; never paste Guest feedback, contact data, URLs with
   tokens, or raw request headers into incident notes.

**Remediate:** restore Cache Redis first when visibility is unavailable, then
repair the failing observation dependency and repeat one controlled scan and
one controlled Google/secondary action. Do not block an already-approved
Portal render/navigation, infer missing provenance, manufacture replacement
facts, or claim complete traffic while a loss bucket remains in the window.
Historical individual losses cannot be reconstructed from this minimized
aggregate; dashboards and release evidence must label the affected window as
measured/incomplete.

**Verification:** `monitorAvailable=true`, the degraded marker is absent, a
controlled monitor injection raises exactly one content-free alert, and after
the bounded window expires both loss counts return to zero. Confirm
`ratingLossCount=0` and `ratingDisposition=not_applicable_durable`; separately
prove a failed rating transaction exposes retry state and commits neither its
response fact nor outbox row.

**Escalation:** Bozhidar Denev. Monitor unavailability or continuing loss after
one health-check cadence blocks claims of complete Guest analytics and any
capability activation whose release gate requires that evidence.

---

## 19. Post-Boot Sidecar Dependency Loss

> **Current repository status (2026-08-28):** the content-free dynamic health
> controller/server and bounded process-lifecycle owner are implemented and
> unit-tested and adopted by all four executable sidecar boundaries. The
> single-`cell-us` Railway graph and temporary legacy configs target their
> ordinary health port while retaining the separate protected mTLS port. A
> live external dependency-loss/alert/replacement injection is still required;
> repository checks alone are not exercised beta evidence.

**Trigger/Symptoms:** An external probe receives `503` from a retained
sidecar's plain platform `/health/ready` endpoint after the deployment had
become ready; Railway repeatedly replaces the service; or a sidecar emits one
of the content-free `sidecar_fatal_process_error`,
`sidecar_shutdown_failed`, or `sidecar_shutdown_timed_out` events.

**Impact:** P1. Google or AI work behind the affected trust boundary is
unavailable or delayed. A readiness failure never authorizes direct provider
access, a relaxed certificate policy, or routing into `europe`/`global`.

**Prerequisites:** Identify the exact `cell-us` service and signed release.
Use the platform health port only. The provider/admission listener remains a
separate mTLS port, and no incident probe may weaken or bypass its peer
identity checks.

**Diagnostics:** Compare `/health/live` and `/health/ready` from the external
monitor. Live `200` plus ready `503` means the process is alive but its dynamic
database, provider Redis, admission, or provider-control check is failing.
Use the service's content-free structured events and dependency dashboards to
identify the class; do not log connection strings, credentials, request
payloads, provider responses, or exception messages. Confirm the failure is
post-boot by retaining the earlier ready observation.

**Containment:** Stop only the affected Google or AI capability family and
preserve durable pending facts. If the failure could allow an unauthorized
effect, use the global stop in §11. Do not switch origins, reuse another
service's credentials, expose the protected port, or create a dormant-cell
fallback.

**Recovery:** Repair the failed dependency or promote the prior verified image
digest. Readiness is recomputed on every probe, so it must recover from the
real dependency; restarting solely to clear state is not proof. During drain,
readiness becomes `503` before protected ingress closes, one shutdown owner
drains resources within its budget, and a failed or timed-out drain exits
non-zero for platform replacement.

**Verification:** Prove `/health/live` remains dependency-free; `/health/ready`
returns `200` only with the dependency healthy; an injected post-boot loss
changes it to `503`; and recovery restores `200`. An unauthenticated request to
every protected mTLS route must still fail. Retain the external alert receipt,
replacement outcome, exact service/release/cell, and content-free process event
sequence.

**Escalation/Evidence:** Incident commander and communications/support owner
are the named roles at the top of this document. A retained sidecar without
external post-boot readiness and alert injection is a beta release blocker.

---

## 20. Cross-Tenant Isolation Suspicion

**Trigger/Symptoms:** A response, log, export, query result, background job, or
provider action may contain or act on data belonging to a different
Organization or Property than its authenticated scope. Suspicion is enough to
start this runbook; do not wait for confirmed disclosure.

**Impact:** P0 and a beta stop condition. Potential cross-tenant access is
treated as a security/privacy incident even when the exposed value appears
non-sensitive.

**Prerequisites:** Open a restricted incident record with the exact cell,
release SHA, route/job template, correlation identifiers, and discovery time.
Do not copy the suspected tenant data into chat, tickets, Sentry, or ordinary
logs.

**Diagnostics:** Activate §11 containment first. Preserve immutable release,
policy, authorization-decision, outbox receipt, and provider-operation
identities. Reproduce only with approved synthetic tenants. Determine whether
the boundary failure is interactive authorization, repository scoping,
queued-fact routing, cached tenant state, export scope, or provider execution.

**Containment:** Stop all external effects, stop affected public reads if
necessary, revoke implicated sessions/permits, and preserve evidence. Never
repair by changing tenant identifiers, deleting source rows, or moving work to
another Data Cell. Communications are coordinated only through the named
support role and legal/security advice.

**Recovery:** Fix the earliest violated tenant boundary, add a negative test at
every downstream boundary reached by the defect, rebuild only derived state,
and reconcile provider effects. Resume one capability at a time only after an
independent review of the scope and fix.

**Verification:** Cross-tenant negative matrices pass at HTTP/server-function,
repository, cache, queue/outbox, provider, export, object, recovery, and
operator-command boundaries. Confirm no dormant-cell fallback and no
unexplained external effect. Retain the stop time, affected release/cell,
scope decision, test evidence, notification decision, and signed restart
approval without tenant content.

**Escalation/Evidence:** Page the incident commander immediately. The
communications/support owner maintains the manager/provider timeline. No
engineer may self-close a suspected tenant breach solely from a code fix.

---

## 21. Lost Bucket Object

**Trigger/Symptoms:** A referenced Portal asset is missing, unreadable,
unexpectedly overwritten, or returned with the wrong integrity metadata; the
bucket or object lifecycle reports an unexpected deletion.

**Impact:** P1 when a published guest experience is impaired; P0 if the
symptom suggests cross-tenant access or broad destructive loss, in which case
also invoke §20/§11.

**Prerequisites:** Record only the object class, cell, release, safe key digest,
reference count, expected integrity digest/version, and first observed time.
Never copy signed URLs, credentials, tenant names, or image content into the
incident record.

**Diagnostics:** Confirm the database reference and lifecycle state, the
`cell-us` `sjc` bucket identity, access policy, provider event history, and
whether the object was a replaceable derivative or an irreplaceable approved
source. Check cleanup receipts and lifecycle rules before assuming provider
loss.

**Containment:** Disable new media issuance/finalization and serve the safe
presentation fallback. Do not make the bucket public, broaden credentials,
restore an entire database, or read from a bucket in a dormant cell to repair
one object.

**Recovery:** Rebuild a derivative from an authorized retained source when
policy permits. Restore an irreplaceable object only through the approved
provider recovery path and verify integrity before updating availability.
Where recovery is prohibited or impossible, retain the neutral fallback and
require the manager to supply a new approved asset after the capability gate
reopens.

**Verification:** The intended object/fallback renders without changing Portal
publication identity, access remains tenant/cell scoped, cleanup cannot remove
the recovered current version, and a synthetic missing object raises the
configured alert. Retain the object class, safe key digest, reference count,
recovery/fallback result, provider evidence identifier, and timing.

**Escalation/Evidence:** Incident commander owns containment and restore;
communications/support owner explains the visible fallback without claiming
that an object was recovered until integrity verification passes.

---

## 22. Privacy Request Incident

**Trigger/Symptoms:** A verified access, correction, withdrawal, erasure, or
offboarding request is overdue, mis-scoped, partially applied, restored from a
backup, or appears to have caused unintended loss. A legal/security request to
shorten an Organization recovery window also enters this runbook.

**Impact:** P0 for disclosure, resurrection, wrong-subject deletion, or an
expired-data retention breach; otherwise P1 until the governed request is
complete and evidenced.

**Prerequisites:** Verify identity and authority through the approved channel;
record request type, scope, legal/retention holds, deadline, export readiness,
and the exact policy versions. Keep request content and exported data out of
ordinary incident systems.

**Diagnostics:** Use context-owned inventories and content-free purge/export
receipts. Check active legal holds, recovery windows, backup-erasure ledger,
restore generation, pending jobs/outbox facts, provider content, and whether
the request affects identities still owned by another Organization. Never
infer a scope from email text or a partial identifier match.

**Containment:** Pause the affected request before any irreversible boundary
when identity, scope, or policy is uncertain. If expired or erased data became
servable, stop the affected capability and follow §11. Do not delete backup
evidence, bypass an independent approval, or broaden the request to unrelated
Organizations/Properties.

**Recovery:** Resume through the idempotent context-owned workflow after the
scope is corrected. Re-run bounded purge/export steps, reconcile every receipt,
fence restored work, and append backup-erasure evidence so a later restore
cannot resurrect erased material. Irreversible purging never rolls back; a
wrong deletion becomes a security/legal incident and uses only an approved
recovery decision.

**Verification:** Every owning context reports a terminal content-free
receipt; expired text/contact/provider content is unrecoverable from product,
log, telemetry, queue, and restored-state paths; retained holds/evidence match
policy; and exports contain only the verified scope. Keep the verified request,
scope inventory, receipt set, backup-ledger head, timing, and communication
record under restricted access.

**Escalation/Evidence:** Incident commander owns the technical stop/recovery;
communications/support owner coordinates the requester and legal/support
timeline. Legal/security approval, not engineering convenience, decides any
grace-window waiver or notification obligation.

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
| `retention.failure`                           | P1  | latest retention run failed for any subject                                                                                     | §8      |
| `reply.ambiguous-aging`                       | P2  | oldest ambiguous publication > 15min past reconcile_due                                                                         | §6      |
| `routing.region-attempts`                     | P2  | any quarantined wrong/unresolved/denied-region attempt                                                                          | §12     |
| `policy.denial-drift`                         | P2  | > 50 policy denials in the trailing hour (starting point — tune with real traffic; §11 for containment if drift confirms)       | §9      |
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
external web availability, readiness for each of the four retained sidecars,
Sentry error rate, and release/config drift. Every row names its owner,
severity, runbook, and retained evidence. The catalogue deliberately contains
no `europe` or `global` monitor because those cells are dormant and must not be
provisioned for beta. A green catalogue test proves coverage only; the external
configuration and alert-injection receipts remain required before customer
data.

**`security.scan` signal note (BQC-7.7):** the supply-chain/secret gates now
exist — as CI hard gates, not app-level alert injection. The signal path is:
any red gate (dependency audit, gitleaks, license, action-pins, grype,
CodeQL analysis failure) fails the GitHub check → branch protection blocks
merge and the check failure notifies on-call via the repository's GitHub
notification routing. There is deliberately no runtime `security.scan`
dispatcher at app level (a CI gate red state is pre-deploy evidence, not a
production signal) — the row above stays "not implemented at app level" by
design. Gate inventory + thresholds: `docs/operations/security-ci-policy.md`.
