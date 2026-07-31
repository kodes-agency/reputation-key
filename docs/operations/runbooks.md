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

Registered gaps (owned elsewhere, do NOT improvise in an incident): metric-rollup
watermark reset (metric owner — use `ops:refresh metrics-*` for a bounded re-run),
ENCRYPTION_KEY rotation (platform owner — runbook §2 manual), PITR execution
(platform owner — `ops:restore-preflight` only).

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

---

## 8. Database Saturation / Failed Migration / Restore

**Trigger:** Connection pool exhausted, slow queries, migration failure, or restore needed.
**Impact:** P0 for migration failure or data loss. P1 for saturation.
**Diagnostics:** Check `pg_stat_activity` for connection count. Check Neon dashboard for compute/storage. Check migration logs.
**Containment:** Reduce worker concurrency. Pause non-critical jobs. If the predeploy migration failed: the deploy is already blocked (Railway `preDeployCommand` exited non-zero) — the previous containers keep serving; do NOT hand-roll partial schema state.
**Recovery:** Saturation → tune pool sizes, add indexes. Migration → forward recovery only: the trio (`scripts/migrate-deploy.ts`, advisory-locked, idempotent) leaves no half-applied state beyond its idempotent steps — fix the failing migration/sidecar SQL forward and redeploy; the rerun converges (see the script header + src/shared/db/CONTEXT.md "Deploy apply order"). Never roll the schema back mid-flight. Restore → start with `ops:restore-preflight` (verifies the isolated target, journal readability, and the backup-window checklist), then PITR to isolated project (platform-owned), verify, cutover (the only rollback path, reserved for data loss).
**Verification:** Connection count under budget. Migration journal consistent. Restore passes integrity checks.
**Escalation:** P0 — page Bozhidar Denev for migration/restore. Neon support if platform issue.

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
**Diagnostics:** Check property `lifecycle_state`. Check for active sync jobs, pending publications, inbox items.
**Containment:** Suspend → `ops:suspend-property --org <id> --property <id> --reason <text> --ticket <ref> --apply` (blocks new processing via the capability store; restore with `ops:restore-property`). Disconnect → `ops:disconnect-connection <connectionId> --org <id>` (revokes Google tokens, sets connection `disconnected`).
**Recovery:** Archive → data preserved, can restore to `active`. Purge → irreversible, confirm via typed property name; bounded purge/retention sweeps re-run via `ops:purge <reviews|retention>` (destructive — typed confirmation). Purge propagates to reviews, replies, inbox, metrics, notifications, cache, queue jobs.
**Verification:** Lifecycle state correct. No active jobs for the property. Purge evidence report generated.
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

**Trigger:** US region infrastructure unavailable (Neon, Redis, or Google API).
**Impact:** P1 — service degraded or unavailable for US properties.
**Containment:** Do NOT fail over to another region (policy: no silent cross-region data movement). Set readiness to 503. Show honest "service unavailable" state.
**Recovery:** Wait for provider recovery. Outbox accumulates events (no data loss). Resume normally when infrastructure recovers.
**Verification:** All dependencies healthy. Backlog drained. Freshness indicators return to normal.
**Escalation:** Bozhidar Denev. Provider support tickets (Neon, Redis provider, Google Cloud).

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
| `backup.pitr`      | P3  | Backup/PITR status + restore drill — BQC-7.8                                                                          | §8      |
| `security.scan`    | P2  | Supply-chain/secret-detection gate failure — BQC-7.7                                                                  | §9      |
