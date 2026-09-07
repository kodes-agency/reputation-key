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

Command syntax lives in [Operator commands](operator-commands.md). Alert
definitions and security controls live in
[Alerts and security posture](alerts-and-security-posture.md).

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
**Diagnostics:** Check queue depth via `HealthSnapshot.syncMetrics`. Check the `gbp_webhook` scope in `idempotency_receipts` for duplicate/missing messages.
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
**Recovery:** Saturation → tune pool sizes, add indexes. Migration → forward recovery only: `scripts/migrate-deploy.ts` is advisory-locked and idempotent, so fix the failing migration or registered deploy SQL forward and redeploy; the rerun converges (see the script header + src/shared/db/CONTEXT.md "Deploy apply order"). Never roll the schema back mid-flight. Restore → follow [backup-and-lifecycle.md](backup-and-lifecycle.md) §1 exactly: contain the deployment → Railway PITR to its generated sibling service → exact-target preflight through a Railway tunnel → migration parity → dry-run inventory → destructive retention/recovery fence → isolated signed-image read verification → fresh Redis and controlled connection cutover only after independent approval of that exact target/report/generation.
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
**Diagnostics:** Check the Property `lifecycle_state`, its Google connection state, active import/sync jobs, pending publications, and Inbox work through the ordinary read-only health and database surfaces. Before a general retention apply, run `pnpm ops purge retention --operator <id>` and retain its content-free per-rule backlog/cutoff report.
**Containment:** There is no standalone Property suspend/restore operator command. For an immediate processing stop, add the affected capability names to `BETA_CAPABILITIES_OFF` and restart web and worker; this is a global stop, not a scoped Property mutation. To fence one Google connection, run `pnpm ops disconnect-connection <connectionId> --org <id>`; it disconnects the local authority and provider work, while provider revocation still requires the approved Google surface described in §2. A stuck import request has no direct cancel command: fence its connection, preserve the request identifiers, and escalate rather than mutating lifecycle rows by hand.
**Recovery:** Archive preserves data and may return to `active` only through the application lifecycle authority. General retention purge is irreversible: review the dry-run report, then run `pnpm ops purge retention --operator <id> --reason <text> --apply --yes ops:purge`. Review expiry purge remains unavailable while SAFE-03 quarantine is active; escalation cannot bypass that fence. Property/member/connection/Organization removal fences matching import parents/items and invalidates provider references before authority disappears.
**Verification:** Confirm the intended lifecycle/connection state, no outstanding import or provider authority, and no newly claimed jobs for the fenced scope. Retention evidence must include `integration.google_import_v2.lifecycle`; do not substitute a local row edit or an unimplemented command for that evidence.
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
**Diagnostics:** Compare external web availability and worker job-runtime readiness with PostgreSQL, Cache Redis, Queue Redis, provider-status, release-SHA, and configuration-drift signals. Confirm that every denied `europe` or `global` routing attempt remains a refusal rather than a fallback.
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

**Remediate:** fix the underlying handler failure FIRST (a redrive into a broken handler just re-quarantines), then match each entry's job family to the event-job catalogue. For an enabled family, first run `ops:quarantine redrive <id> --operator <registered-operator>` for the dry-run report, then add `--reason <incident-reason> --apply`; redrive returns the job to its original queue. For a blocked or quarantined family, never redrive: first run `ops:quarantine discard <id> --operator <registered-operator>`, record the identifiers and disposition in the incident, then add `--reason <incident-reason> --apply`. Discard permanently removes the quarantined job without executing or re-enqueuing it. For `pending_failure`, the redrive apply path first reads the original job and proceeds only when BullMQ still reports it as `failed`; that proof idempotently confirms the staged copy. A recovered, active, waiting, completed, or missing original is refused and must not be force-redriven. Invitation-event and invitation-Activity payloads are sanitized again at the redrive boundary, so a concurrent privacy-verification scan cannot miss content moved between queues.

**Verification:** `queue.quarantine.depth` returns to 0, redriven jobs complete in their original queue, and discarded jobs were never executed or re-enqueued.

**Escalation:** Bozhidar Denev. Any quarantined entry that cannot be safely redriven or deliberately discarded is a data-loss event and needs written sign-off.

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
2. `outbox.unpublished` / `queue.oldest-age` — if the outbox is backed up, the gap may be delivery lag rather than a lost notification, and §7 is the right runbook.

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

> **Current repository status:** web and worker initialize the same scrubbed SDK
> through executable preloads, capture startup/process failures, and flush on
> their bounded shutdown paths. Google and AI provider controls now execute
> in-process, so they have no separate service monitoring surface. Source-map
> upload, Sentry-project retention inspection, external journey monitoring,
> alert routing, and the supported-device drill remain release evidence. Local
> bundle and scrubber tests are implementation evidence, not live
> Sentry-project delivery or alert-routing evidence.

**Trigger/Symptoms:** A deployment refuses startup with `SENTRY_DSN is required`
or `US ingestion host`; logs contain `Error monitoring initialization
failed`, `capture failed`, or `flush timed out`; or the Sentry project receives
no web or worker events for the deployed release.

**Impact:** Application work continues when the SDK or ingestion transport
fails, but automatic error diagnosis and incident alerting are degraded. A
missing or out-of-region DSN is different: the affected Railway web or worker
process refuses startup because monitoring is mandatory in production.

**Prerequisites:** Named incident owner; access to the cell's Railway shared
variables and the US-region Sentry project; candidate release SHA. Never paste
the DSN, event payload, review text, contact data, or credentials into a ticket
or chat transcript.

**Diagnostics:**

1. Confirm `web` and `worker` use the same cell-scoped `SENTRY_DSN` and
   `SENTRY_TRACES_SAMPLE_RATE`, and that the DSN host ends in
   `.ingest.us.sentry.io`. The regional guard rejects another ingestion region;
   there is intentionally no `SENTRY_ENABLED` switch.
2. Search content-safe boot logs by `releaseSha`, `processingCell`, and
   `service` for `Error monitoring initialized`. An SDK failure is logged as an
   error but does not expose the DSN or exception message.
3. Confirm the image commands preload
   `web-observability-preload.mjs`/`worker-observability-preload.js` before the
   application entries. A command or bundle override that bypasses either
   boundary is configuration drift.
4. In Sentry, filter by `release`, `environment`, `service`, and
   `processing_cell`. Events intentionally omit request bodies, headers,
   cookies, user/extra data, exception messages, breadcrumb content, local
   variables, and source context.

**Containment:** Do not disable monitoring. If a newly pinned SDK causes
resource or startup instability, roll back to the last signed image digest;
runtime SDK/transport exceptions already fail open. Treat any prohibited
content found in an event as a tenant-data incident and follow §9 immediately.

**Recovery:** Correct the shared Sentry DSN or transport/project state and
redeploy the exact candidate through the normal promotion path. Do not add a
second worker process-level uncaught-error handler: RepKey owns its drain/exit
and removes the matching Sentry defaults to avoid races and duplicates. Web
retains the SDK's fatal handlers because it has no equivalent
application-owned fatal process boundary.

**Verification:** Send one controlled synthetic exception from each process in
each affected cell through the staging/RC drill. Verify one event per failure,
the correct release/environment/service/cell tags, readable stack frames, and
absence of the seeded secret, review, feedback, contact, cookie, and token
markers. Terminate web and worker once and confirm bounded flush completes
inside the Railway drain window. Exact health and
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
pnpm ops triage-beta-feedback --operator <registered-operator>
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
PostgreSQL database. Full OBS-01 closure additionally requires the Sentry
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
   A dark/quarantined family with a handler, scheduler, queued item, or
   post-boot execution is a containment failure; do not redrive it. Review the
   entry, then dry-run `pnpm ops quarantine discard <id> --operator
<registered-operator>` before applying it with `--reason <incident-reason>
--apply`.
3. For missed objectives, stalled work, repair-required state, or dead letters,
   inspect the original queue and run `pnpm ops quarantine list --operator
<registered-operator>` before applying the row's exact repair command.

**Remediate:** repair configuration/handler/scheduler drift by promoting a
reviewed immutable release; never register an ad-hoc handler or repeat entry in
Redis. Remove forbidden dark/quarantined schedules through normal scheduler
reconciliation and discard their queued work without executing it. For an
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

## 19. Cross-Tenant Isolation Suspicion

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
repair by changing tenant identifiers or deleting source rows. Communications are coordinated only through the named
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

## 20. Lost Bucket Object

**Trigger/Symptoms:** A referenced Portal asset is missing, unreadable,
unexpectedly overwritten, or returned with the wrong integrity metadata; the
bucket or object lifecycle reports an unexpected deletion.

**Impact:** P1 when a published guest experience is impaired; P0 if the
symptom suggests cross-tenant access or broad destructive loss, in which case
also invoke §19/§11.

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

## 21. Privacy Request Incident

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
