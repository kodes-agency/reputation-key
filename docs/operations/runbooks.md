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
**Diagnostics:** Check `audit_logs` for suspicious actions by the user ID. Check `session` table for active sessions. List the invitations the account sent: `SELECT id, role, status, "expiresAt" FROM invitation WHERE "organizationId" = $1 AND "inviterId" = $2`, with the Organization ID and the user ID (keep the invited addresses out of the incident record). A `pending` or `expired` row is still open. An `accepted` row is a member the account has already added, which cancelling invitations does not undo.
**Containment:** Immediately invalidate all sessions for the user (`DELETE FROM session WHERE "userId" = $1`). Suspend the user's organization: add its Organization ID (not its slug, which matches nothing) to `BETA_SUSPENDED_ORGS` on web and worker. The suspension refuses every invitation of that Organization while it lasts (accepting one, registering on one and the worker's registration recovery all ask `identity.invite`), but it cancels none: an invitation the compromised account sent stays open. Nobody can cancel it in the app meanwhile: Cancel in Settings, Members is gated like any other AccountAdmin action and is refused with `org_suspended`, and the operator console cancels only for an Organization that has no AccountAdmin (ADR 0065). Left open, it can be accepted the moment the suspension is lifted, as an AccountAdmin if it was sent as one.
**Recovery:** Require password reset. Re-verify email. Re-issue sessions only after identity confirmation. Before the Organization leaves `BETA_SUSPENDED_ORGS`, cancel every open invitation the compromised account sent: `UPDATE invitation SET status = 'canceled' WHERE "organizationId" = $1 AND "inviterId" = $2 AND status IN ('pending', 'expired') RETURNING id, role`, with the Organization ID and the compromised user ID. Those are the rows the app's own Cancel accepts, and a cancelled invitation can be neither accepted, registered on nor resent. Never lift first and cancel in the app afterwards: the invitation can be accepted from the moment the suspension is lifted. The statement writes no `identity.invitation.canceled` fact, so Recent Activity does not show these cancellations; the ids it returns go into the incident record. A registration already begun on one of them is settled by the worker's registration recovery when it next comes due (it retries every five minutes, under the suspension too): it deletes the half-created account, which never held a membership, and counts it as `compensated` in its `Invited registration recovery completed` line. An invitation that was legitimate is sent again by an AccountAdmin after the lift.
**Verification:** Confirm no active sessions remain. Before the suspension is lifted, confirm the compromised account has no open invitation left: `SELECT count(*) FROM invitation WHERE "organizationId" = $1 AND "inviterId" = $2 AND status IN ('pending', 'expired')` returns 0. Audit log shows no further activity from the compromised account.
**Escalation:** Page Bozhidar Denev immediately. Document incident timeline.
**Evidence:** Retain the incident timeline, content-free session revocation count, the ids of the cancelled invitations (never the invited addresses), affected release/cell, identity-verification outcome, and signed recovery decision. Do not retain session material.

---

## 2. OAuth Token / Encryption Key Compromise

**Trigger:** Google OAuth token leak suspected, encryption key exposure detected.
**Impact:** P0 — unauthorized Google API access possible.
**Prerequisites:** Stop affected provider capabilities; name both operating roles; record only the connection pseudonym, cell, release, credential/key generation, and discovery time. Never copy token/key bytes.
**Diagnostics:** Check `google_connections` for the affected connection. Identify `encryption_key_id` version.
**Containment:** Kill Google capabilities and pause provider work first (§11). There is no operator command that disconnects a connection: `pnpm ops disconnect-connection` only reports and refuses `--apply`, because operator commands run without the Google provider runtime. To disconnect, an AccountAdmin of that Organization disconnects Google in the app (Settings, Integrations): that cancels the connection's imports, attempts the governed Google revoke and redacts the stored credentials. The disconnect is gated like any other manager action, so the app refuses that disconnect while the Organization is in `BETA_SUSPENDED_ORGS`, and while `BETA_CAPABILITIES_OFF` is `all` or names `integration.use`; the targeted Google stop of §11 leaves it working. To stop one Organization's Google work without an AccountAdmin, add its Organization ID to `BETA_SUSPENDED_ORGS` on web and worker (§1). When you need both, have the AccountAdmin disconnect before you suspend the Organization. If it is already suspended, or the full stop is on, the stored credentials stay until the disconnect can run: keep the targeted Google stop on, lift the suspension or the full stop, have the AccountAdmin disconnect, then put it back. A disconnected row is not revocation evidence, because the revoke may not have been sent or may have ended ambiguous: revoke the OAuth grant in the approved Google operator surface as well and attach its evidence. If the encryption key is compromised, begin key rotation — new tokens encrypted with the new key and old tokens re-encrypted (runbook-manual, platform owner).
**Recovery:** User must re-authenticate via Google OAuth. New tokens encrypted with new key version.
**Verification:** Confirm old tokens are revoked at Google through provider-authoritative evidence; a local disconnected row alone is insufficient. Confirm no API calls succeed with old tokens.
**Escalation:** Page Bozhidar Denev. Notify Google if API abuse detected.
**Evidence:** Retain capability-stop time, credential/key generation, provider revocation evidence identifier, reauthorization/rotation head, reconciliation outcome, and restart approval without provider content.

---

## 3. Google API Suspension / Quota Exhaustion

**Trigger:** Google returns 429 (quota) or 403 (suspended) consistently.
**Impact:** P1 — review sync and reply publish unavailable.
**Freshness alert scope:** `source.freshness-deadline` counts a live Review as refresh-due only while the refresh sweep can offer it (its Property is live, bound to Google through the Review's own connection, on a usable connection). The Reviews of an archived, suspended, deleted or disconnected Property, or of a connection awaiting reauthorisation, are not counted: no refresh is coming for them, so the alert would page on day 28 for content nobody can renew. They still count in `reviews.totalActive` and, once past day 30, in `reviews.expiredCount`; their text stays stored and withheld from reads (`docs/BETA.md` §2, UNENFORCED deletion). Reconnecting Google or restoring the Property brings them back into the refresh sweep.
**Diagnostics:** Check `classifySyncError` output. Check Google Cloud Console for quota status.
**Containment:** Pause sync jobs for the affected connection. Set connection status to `degraded`.
**Recovery:** Wait for quota reset (usually daily). If suspended, resolve the policy issue with Google Cloud support. Resume sync after clearance.

**RepKey's own limits (before Google's):** every Google route is admitted through a quota policy (`GOOGLE_QUOTA_POLICIES`, `src/shared/google-provider-control/quota-coordinator.ts`), and a denied call is `quota_exhausted`, not a Google 429. Review reads (`reviews.list`, `reviews.get`: the sync scans, the head checks, the push fetches and the publish worker's read before a claim) share `google-reviews-v1`: 30 calls a minute per credential, project and endpoint, 4 in flight. Reply writes (`reviews.reply`) have their own lane, `google-reviews-write-v1` (2026-10-21): the same 30 a minute and 4 in flight, so a scan can never use the minute a reply needs (the 2026-08-23 incident in `e2e-flake-register.md`). One publish spends one call on each lane. A burst of 25 approvals on one connection therefore needs 25 calls on the read lane, inside its 30, and 25 on the write lane.
**Check on Google from the Inbox (2026-10-21).** A manager's "Check on Google", and the automatic check when they come back from "Open on Google", read one review (`reviews.get`) on the read lane above, so they can meet `quota_exhausted` like a sync can (the manager is told "Couldn't check Google right now. Try again in a minute."). RepKey limits them before Google does: one call per review per 60 seconds and 30 per Organization per minute (`GOOGLE_CHECK_REVIEW_LIMIT`, `GOOGLE_CHECK_ORGANIZATION_LIMIT` in `check-inbox-review-on-google.ts`), counted in Redis under `ratelimit:public:inbox:google-check:review:<org>:<review>` and `ratelimit:public:inbox:google-check:organization:<org>`. A call over either limit answers `rate_limited` without reading Google; with Redis down in production the limiter fails closed and the answer is `unavailable`. Each call writes one info line on the web server, `stage: inbox_check_review_on_google`, with `outcome` (`reply_found`, `no_reply`, `unavailable`, `not_checkable`, `rate_limited`), `reason` where Review gave one (`property_not_bound`, `capability_off`, `content_expired`, `no_provider`, `retry_later`, `retry_never`, `reply_unreadable`, `head_unreadable`, `not_a_google_review`, `review_missing`) and nothing else: no ids (the observability schema bans them as log keys; tie a line to a call by the request's own correlation and time) and never review or reply text. A run of `unavailable` with `retry_never` or `not_checkable` with `property_not_bound` or `capability_off` is the Property's Google connection or a stop (§11, §25), not this feature. A stop on `property.connect_gbp` blocks these checks like every other Google read.
**Verification:** Confirm sync resumes. Check `last_successful_sync_at` advances.
**Escalation:** Bozhidar Denev. Google Cloud support ticket if suspended.

---

## 4. Pub/Sub Backlog / DLQ / Replay

**Trigger:** Notification backlog growing, messages in dead-letter queue.
**Impact:** P1 — delayed review visibility.
**Diagnostics:** Check queue depth via `HealthSnapshot.syncMetrics`. Check the `gbp_webhook` scope in `idempotency_receipts` for duplicate/missing messages.
**Containment:** Increase worker concurrency temporarily. Pause non-urgent jobs to free capacity.
**Recovery:** Process backlog. Redrive dead-lettered messages via `ops:quarantine redrive <id> --reason <text> --apply` (list first with `ops:quarantine list`). Reconcile any gaps via bounded reconciliation (`ops:refresh reviews`).
**Verification:** Queue depth returns to normal. For each affected Property, the latest `review_google_reputation_snapshot_facts.evaluated_at` moves forward once its next snapshot completes, and `review_sync_state.next_incremental_at` holds a due time for its next discovery look (a due time long in the past means the sweep is behind; see the `sync.sweep-lag` alert in §13).
**Escalation:** Bozhidar Denev if backlog exceeds 1 hour.

### Push health alerts (`sync.push-missed`, `sync.push-silent`)

**Alerts:** `sync.push-missed` (P2) — with `GBP_PUBSUB_TOPIC` set, polling found a new review in the last 24 hours and no Google push for it was accepted within 60 minutes. `sync.push-silent` (P2) — polling found new reviews in the last 24 hours and Pub/Sub accepted no push at all in that time.

**What they mean:** polling still finds every review within about six hours (§13), so nothing is lost; the fast path is degraded. The first-sighting ledger (`review_first_sightings`, ADR 0055 note 2026-10-21 (b)) records, for each review RepKey first saw as live work, how it was first seen (`push`, `push_reconcile`, `snapshot`) and when Pub/Sub accepted the push for it. A review is _missed_ when no push was accepted by 60 minutes after it was first seen, _late_ when the push was accepted after polling saw it (any delay), and _pending_ for its first hour. A push that arrives after the hour makes the review late as well, and it stays counted as missed. Known blind spot: a push whose reference was lost is handed to a full reconcile and cannot be paired with a review polling saw first, so that review reads as missed although the push was accepted (rare; needs a Redis reference failure). A push accepted more than 24 hours after a review was first seen is treated as an edit and is not paired. History imports and relinked old reviews are never in the ledger. `GET /api/health/metrics` shows the counts under `syncPush.push` (`sync.push_missed_24h`, `sync.push_late_24h`, `sync.push_new_by_push_24h`, `sync.push_new_by_poll_24h`, `sync.push_accepted_24h`, and the `sync.push_locations_*` / `sync.push_accounts_dark` health counts for the last 7 days: a location is suspect after one missed push, a Google account is dark after two across its locations).

**Diagnostics:** (1) `sync.push_accepted_24h` is 0 while `sync.push_new_by_poll_24h` is above 0 (`sync.push-silent`): Google is not publishing, or Pub/Sub cannot reach us. Check the subscription in the console: delivery errors, `oldest_unacked_message_age`, and that the subscription has not expired (`docs/operations/google-pubsub-setup.md` §8). (2) Pushes are accepted but one location or account missed some (`sync.push_accounts_dark` above 0): the account's notification setting may point elsewhere (the daily `reconcile-gbp-notification-subscriptions` run re-asserts it), or Google dropped the publish. (3) `idempotency_receipts` rows in scope `gbp_webhook` carry an `outcome`: `ignored_property_not_found` and `ignored_binding_mismatch` mean the push arrived for a location the app does not hold or no longer matches. (4) `GBP_PUBSUB_NOTIFICATION_TYPES` must include `NEW_REVIEW`, and the topic must still grant `mybusiness-api-pubsub@system.gserviceaccount.com` the publisher role. A late (not missed) push usually means a queue backlog: check `queue.oldest-age`.

**Containment:** none needed for correctness. If the push path stays down, the six-hour reconciliation keeps finding reviews; to find them sooner, set `REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED=false` on the worker (§13).

**Recovery:** fix the cause above. `sync.push-missed` clears when no polled review of the last 24 hours is missed (24 hours after the last miss); `sync.push-silent` clears at the first accepted push.

**Escalation:** Bozhidar Denev.

---

## 5. Import Stuck / Partial

**Trigger:** Import job running too long, stuck at a checkpoint, or reporting failure.
**Impact:** P2 — delayed first-time setup for a property.
**Diagnostics:** Read the import's rows: the saga root in `gbp_import_sagas`, its batches of at most 100 in `gbp_import_requests` (`status` and the per-status counts), and one row per location in `gbp_import_request_items` (`status`, `outcome_code`, `claim_lease_expires_at`). Check `review_sync_state` checkpoint. Check worker logs for errors.
**Containment:** No operator command cancels an import (§10). The AccountAdmin who started the import (`initiated_by` on its `gbp_import_sagas` row) can cancel it in the app, which cancels the whole saga; that cancel is gated like any other manager action (`integration.manage`, capability `property.import_gbp_v2`). Nobody else can see, cancel or retry it, another AccountAdmin of the same Organization included: the app answers anyone else as if the import did not exist. When that user cannot act, contain it as §10 describes (an AccountAdmin disconnecting Google cancels that connection's imports), preserve the request identifiers, and never edit the rows by hand. Property remains in `active` lifecycle state.
**Recovery:** Nothing is restarted by hand, and an item keeps its checkpoint (durable — resumes, doesn't restart). An item left `processing` by a worker that died is found by the `google-import-claim-reaper` job once its 60-second claim lease has elapsed: the claim is released for the next attempt, or the item ends as `temporarily_unavailable` when its attempts are spent, which the AccountAdmin who started the import, and nobody else, can retry in the app. An item still `pending` or `processing` 24 hours after the import started (its effect deadline) is ended by the daily import lifecycle sweep, and so is a spent item found after that deadline: it ends `internal_error`, shown as "Import could not be completed", with its provider identifiers scrubbed. It cannot be retried, so the AccountAdmin imports the location again. Check Google API connectivity first.
**Verification:** Import progresses past the stuck checkpoint. Review count increases.
**Escalation:** Bozhidar Denev if import fails after retry.

---

## 6. Ambiguous or Duplicate Reply Investigation

**Trigger:** Possible duplicate reply published to Google, or publish outcome unknown.
**Impact:** P0 if duplicate confirmed — duplicate externally visible effect.
**Prerequisites:** Stop automatic retry for the affected operation, name both operating roles, and record only the reply/publication identifiers, cell, release, source epoch, and correlation id. Never paste Review/reply text into incident evidence.
**Diagnostics:** Check reply `publication_state` and `reconcile_due_at`. Reconciliation is not an operator action. The worker's `reconcile-ambiguous-publications` job runs every five minutes and re-reads Google for each reply that is due: an `ambiguous` reply is due on a ladder from 15 minutes to 72 hours after the attempt started, and once its `reconcile_due_at` is `NULL` the automatic checks have ended. For one reply now, a manager uses **Check Google again** on the reply in the Inbox; it also works after the automatic checks have ended. Neither sends a reply. Both need the Organization's Google capabilities: each read is admitted under `property.connect_gbp`, and Check Google again is a reply command first, so it needs `property.publish_reply` as well. While `BETA_CAPABILITIES_OFF` is `all` or names `property.connect_gbp`, while the Organization is in `BETA_SUSPENDED_ORGS`, or while the database-held Google control for `property.connect_gbp` is denied (§25), nothing re-reads Google: the job still runs, each due check passes without a read, and 72 hours after the attempt the automatic checks end with the reply still `ambiguous`. The targeted stop §11 gives as its example names both capabilities, so it stops reconciliation as well as sending. To stop sending and keep reconciliation, stop `property.publish_reply` alone: the job keeps reading, and Check Google again is refused until it is back. The publish worker also reads Google before it claims a fresh publication (2026-10-21, ADR 0046), and that read is admitted under `property.connect_gbp` as well: a `property.connect_gbp` stop therefore blocks publishing too. A reply the worker meets during such a stop ends as `publish_failed` with the notice that nothing was posted, because the read is refused as an authorization (not retried), and its author uses Try publishing again once the stop is lifted. Otherwise the reply stays `ambiguous` until the capabilities are back for that Organization; a manager then uses Check Google again. `pnpm ops reconcile-publication` only lists and refuses `--apply`, because operator commands run without the Google provider runtime: `ops:reconcile-publication <replyId> --org <id>` echoes its arguments without reading the reply, and `ops:reconcile-publication --all-ambiguous --operator <id> --batch-size <n>` lists one bounded keyset page of the rows that are due, across tenants, each as `not_evaluated`. A full page reports `coverage: "partial"` and returns `nextResumeToken`; pass it back with `--resume <token>` until that frozen `dueThrough` keyset segment reports `coverage: "complete"`. Check `event_consumer_receipts` for duplicate processing.

`coverage` describes listing, not healing. Each report's counts cover only `current_page`; `startedAfter` and `dueThrough` define the exact frozen keyset segment listed by that invocation. Keep the ordered page reports when claiming end-to-end coverage of the listing. Every listed row is `unresolvedInPage`: the command reads no provider truth, and a fresh listing without `--resume` shows the rows that are still due. Run a fresh listing after completing a continuation chain to include work that became due after its frozen `dueThrough` boundary.
**Reply moderation read-back lines (since 2026-10-21).** Google moderates owner replies and sends `reviewReplyState` (`PENDING`, `REJECTED`, `APPROVED`, unspecified) and, for `REJECTED`, `policyViolation`. RepKey parses and logs them and decides nothing on them yet (Review CONTEXT, Model), so a reply Google is still reviewing or has rejected is still read as live. To see what Google sends, filter the worker's logs (Railway Log Explorer, `@level:info`) for `reply_publication_readback`: one line per read-back of a publication attempt, from `source: publish_readback` (the publish job's read after an uncertain write) or `source: reconcile_sweep`, carrying `publicationCycle`, `attemptNumber`, `moderationState` (`pending`, `approved`, `rejected`, `unspecified`, `absent`), `commentPresent`, `commentEmpty`, `updateTimePresent`, `updateTimeEmpty` (`...Present` means Google sent a non-empty value; `...Empty` means it sent an empty string, which is different from sending nothing), `textMatchedAttempt` and, only for `rejected`, `policyViolation`. `moderationState: absent` means Google sent no `reviewReplyState`: no reply, or a reply without it. Count lines, with no reply or review, come from `reviews_reply_moderation` (`operation: reviews.list` or `reviews.get`: `replies`, `pending`, `approved`, `rejected`, `unspecified`, `stateAbsent`). `reviews_reply_moderation_unknown` (warn) counts a state or code RepKey does not know (`unknownState`, `unknownPolicyViolation`) and a `policyViolation` Google sent on a reply that is not `REJECTED` (`policyViolationWithoutRejected`; the code is ignored and never logged, but Google documents it as `REJECTED` only, so a non-zero count means that claim is wrong); treat a non-zero `unknownState` as news and record the value from Google's documentation, never from a payload pasted into a ticket. To design the behaviour, collect, per state: (1) `PENDING` with and without `commentPresent` and `updateTimePresent`, and whether `textMatchedAttempt` is true; (2) `REJECTED`, its `policyViolation`, and whether the comment survives; (3) an edit of an approved reply that goes `PENDING` or `REJECTED`: does Google keep showing the earlier text (`textMatchedAttempt: false` with `approved` before and `pending` after)? (4) whether `moderationState` is ever `absent` for a reply that has a comment, which would mean Google does not send the field to RepKey's credential. Never paste reply text into the ticket. Logs may not carry the reply id (the observability schema bans it), so tie a line to a reply by the worker's job and time: the publish job's own lines for the same job, or the `reconcile-ambiguous-publications` run, sit beside it.

**Containment:** If duplicate found, do NOT delete from Google (may confuse the reviewer). Document the duplicate. If `outcome_unknown`, prevent retry until reconciliation completes.
**Recovery:** The job's read, or the manager's, determines actual state → `published`, `retryable`, or `manual_review`. If duplicate, file incident report.
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
**Recovery:** Rebuild/restore only the failed Redis resource, preserve the distinct `REDIS_URL`/`QUEUE_REDIS_URL` mapping, then let the relay drain the backlog. Recurring job schedulers are Queue Redis state too: a running worker's scheduler watchdog re-installs any that went missing within a minute (log line `Job schedulers missing from Queue Redis were restored`, with the scheduler ids) and re-records its boot observations; a worker restart re-installs them all. The watchdog acts only for the scheduler plan its boot recorded in Queue Redis (`repkey:job-schedulers:v1:plan:background`), claiming the record back when it was lost with the schedulers: `Job scheduler watchdog superseded` means a newer boot reconciled a different plan and this — outgoing — worker restores nothing. At boot the worker upserts only schedulers whose stored definition differs from the plan, so a reboot no longer cancels the hour's promoted run; `Background job scheduler set reconciled` lists them as `upsertedSchedulerIds`. Dispatch jobs that were waiting or retrying when Queue Redis was lost are republished automatically: the worker runs lost-dispatch recovery at boot and whenever the scheduler watchdog restores missing schedulers (log line `Dispatch jobs missing from Queue Redis were republished`, with checked/republished/failures; `Lost dispatch recovery found nothing missing` otherwise). It covers facts published within the last 2 h, whose job Redis no longer holds, under the fact's own job id; older facts belong to published-event redelivery. To force it, redeploy the worker. Poison job → fix handler code, redrive from DLQ.
**Verification:** Queue depth normal. No repeated failures. Outbox `published_at` advances, but that alone does not prove queued facts were recovered: `notification.missing-for-inbox-item` and `notification.in-app-delivery-lag` must clear within minutes too. On `/api/health/metrics`, `jobs.missingObservations` AND `jobs.schedulerMissing` are both 0, and the worker heartbeat is fresh again. The two gauges only prove presence together: the report checks the live BullMQ scheduler set per job family, but only once that family's boot observation exists — after a Redis wipe the observations are gone too, so every family reads `missingObservations` and `schedulerMissing` reads 0 whether or not a scheduler exists. The health-check job is itself a scheduler, so a stale heartbeat after Redis returns means the schedulers are still missing; redeploy the worker.
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
**Containment:** Reduce worker concurrency. Pause non-critical jobs. If the predeploy migration failed: the deploy is already blocked (Railway `preDeployCommand` exited non-zero) — the previous containers keep serving; do NOT hand-roll partial schema state. If the migrations were applied and a later predeploy step or the health check then failed, the web container that keeps serving is now older than the database and cannot be deployed again: §28, half-deployed release.
**Recovery:** Saturation → tune pool sizes, add indexes. Migration → forward recovery only: `scripts/migrate-deploy.ts` is advisory-locked and idempotent, so fix the failing migration or registered deploy SQL forward and redeploy; the rerun converges (see the script header + src/shared/db/CONTEXT.md "Deploy apply order"). Never roll the schema back mid-flight. A predeploy that fails with `canceling statement due to lock timeout` and the line `[migrate-deploy] Lock wait:` is not a failed migration either: a schema statement of either track waited 5 seconds for a lock another session held and gave up, so that application statements on that table are not held in the queue behind it. The line names the track. In the journal track nothing was applied, because the journal is one transaction. In the Better Auth track, which runs first and commits statement by statement, what it added before the wait stays and the journal was not started; it adds only what is missing. In both cases redeploy, and if it happens again find the session holding the lock (`pg_stat_activity`, `pg_blocking_pids`) first. A predeploy that fails with `This image is older than the database` is not a failed migration: the database has applied migrations that image does not carry, no rerun converges, and the repair is a newer release (§28). Restore → follow [backup-and-lifecycle.md](backup-and-lifecycle.md) §1 exactly: contain the deployment → Railway PITR to its generated sibling service → exact-target preflight through a Railway tunnel → migration parity → dry-run inventory → destructive retention/recovery fence → isolated signed-image read verification → fresh Redis and controlled connection cutover only after independent approval of that exact target/report/generation. A database rebuilt from empty comes back with every Google content and AI capability dark until web's next deploy applies the declared posture (§25).
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
**Containment:** There is no standalone Property suspend/restore operator command. For an immediate processing stop, add the affected capability names to `BETA_CAPABILITIES_OFF` and restart web and worker; this is a global stop, not a scoped Property mutation. There is no operator command that fences one Google connection: `pnpm ops disconnect-connection` only reports and refuses `--apply`. An AccountAdmin of the Organization can disconnect Google in the app (Settings, Integrations), which cancels that connection's imports, disconnects the local authority and stops its provider work. The app refuses that disconnect while the Organization is in `BETA_SUSPENDED_ORGS`, and while `BETA_CAPABILITIES_OFF` is `all` or names `integration.use`, so have the AccountAdmin disconnect before you suspend the Organization (§2 says what to do when it is already suspended). To stop one Organization without them, add its Organization ID to `BETA_SUSPENDED_ORGS` on web and worker (§1); otherwise stop the Google capabilities for everyone as above. Provider revocation still requires the approved Google surface described in §2. A stuck import request has no direct cancel command: have the connection disconnected or the Organization suspended, preserve the request identifiers, and escalate rather than mutating lifecycle rows by hand.
**Recovery:** Archive preserves data and may return to `active` only through the application lifecycle authority. General retention purge is irreversible: review the dry-run report, then run `pnpm ops purge retention --operator <id> --reason <text> --apply --yes ops:purge`. Review expiry purge remains unavailable while SAFE-03 quarantine is active; escalation cannot bypass that fence. Property/member/connection/Organization removal fences matching import parents/items and invalidates provider references before authority disappears.
**Verification:** Confirm the intended lifecycle/connection state, no outstanding import or provider authority, and no newly claimed jobs for the fenced scope. Retention evidence for the import lifecycle is the `retention_runs` row the daily retention sweep writes under subject `integration.google_import_v2.lifecycle`. The dry-run report of `pnpm ops purge retention` no longer counts that backlog: it names the subject under `separatelyInspectedSubjects` and nothing more, and no operator command inspects it. Do not substitute a local row edit or an unimplemented command for that evidence.
**Escalation:** Purge requires operator confirmation + evidence report. Review raw-content erasure additionally requires the reviewed REV-01 cutover; until then it blocks release. Bozhidar Denev signs off.

---

## 11. Beta Stop (Global Kill Switch)

**Trigger:** Any P0 stop condition from ADR 0038 (tenant isolation breach, data loss, duplicate effect, token leak, policy violation).
**Impact:** P0 — all external effects must stop immediately.
**Containment:** Full stop → set `BETA_CAPABILITIES_OFF=all` and restart web + worker. Targeted stop → set a comma list, e.g. `BETA_CAPABILITIES_OFF=property.connect_gbp,property.publish_reply` stops Google sync/import/publish (interactive gates deny; the sync/import/publish job handlers re-check capability before side effects and skip cleanly — enqueued jobs are preserved, not deleted). Stopping `property.publish_reply` alone keeps the worker's jobs queued; stopping `property.connect_gbp` alone no longer keeps publishing running, because the worker reads the review from Google before it claims a reply (§6). Worker startup logs the effective capability manifest (kill switch, disabled list, blocked set).
**Recovery:** Investigate root cause. Fix, and deploy the fix forward: an earlier image is never the repair (§28). Re-enable capabilities one at a time with monitoring (remove list entries, restart). A stop made in the database-held controls (Google content capability rows, AI capability heads) is kept by every later deploy — the declared posture only lifts untouched seed defaults — so re-open it deliberately (§25). Lifting a stop of Review Analysis is itself the resume: reviews that were queued or arrived during it wait in the backlog and go to the AI provider on their own once the worker runs under the lifted stop, and `ai.review-analysis-stalled` fires while they wait (§22).
**Verification:** No new external effects after kill switch. Canonical data preserved.
**Escalation:** Bozhidar Denev decides on restart. All P0 conditions require written sign-off before re-enabling.

---

## 12. Region Outage (No Cross-Region Failover)

**Trigger:** US region infrastructure unavailable (Railway Postgres, Redis, or Google API).
**Impact:** P1 — service degraded or unavailable for US properties.
**Prerequisites:** Name both operating roles; record the exact `cell-us` project/environment, affected services/dependencies, release/config heads, first failed external probe, and provider incident identifiers.
**Diagnostics:** Compare external web availability and worker job-runtime readiness with PostgreSQL, Cache Redis, Queue Redis, provider-status, release-SHA, and configuration-drift signals. Confirm that every denied `europe` or `global` routing attempt remains a refusal rather than a fallback.
**Containment:** Do NOT fail over to another region (policy: no silent cross-region data movement). Readiness has no switch to set: `/api/health/ready` is computed from four probes (PostgreSQL, both Redis, the migration journal, the policy configuration) and answers 503 by itself while one of them fails. Show honest "service unavailable" state.
**Recovery:** Wait for provider recovery. Outbox accumulates events (no data loss). Resume normally when infrastructure recovers.
**Verification:** All dependencies healthy. Backlog drained. Freshness indicators return to normal.
**Escalation:** Bozhidar Denev. Provider support tickets (Railway, Redis provider, Google Cloud).
**Evidence:** Retain outage/probe timeline, provider cases, `europe`/`global` fallback-refusal result, readiness recovery, queue/outbox reconciliation, freshness recovery, and restart decision without tenant content.

---

## 13. Discovery Sweep Lag (New Reviews Not Arriving)

**Alert:** `sync.sweep-lag` (P1) — the oldest past-due `review_sync_state.next_incremental_at` is more than 60 minutes overdue (four consecutive 15-minute sweeps failed to reach it).

**What it means:** a property that was scheduled for an incremental sync has not been polled. Every value written to `next_incremental_at` is already in the future by the poll interval, so overdue age is pure sweep lag for a Property the sweep still selects (active, not deleted, bound to Google, connection usable; `sync.failed-nonzero` counts the same set). A Property archived, suspended or disconnected keeps the poll time and coded failure it had and the sweep never rewrites them, so the gauges leave it out. When it qualifies again (restored, resumed, re-bound, or its Google connection reconnected) it is counted at once, but its lag is measured from the later of its poll time and that day (`properties.updated_at`, `google_connections.credential_authorized_at`), so a restore does not page: it becomes overdue only if the sweep has not reached it 60 minutes after it qualified. `sync.failed-nonzero` has no such grace, as for any failure whose retry is due: a Property restored with a coded failure still on it shows there until the next sweep rewrites it (at most one 15-minute sweep). The alert is not measuring "properties are waiting", it is measuring "the sweep stopped working". A sweep run may now enqueue nothing for a Property: when push is configured and the Property's last completed reconciliation (the latest `evaluated_at` of a `listing_complete` row in `review_google_reputation_snapshot_facts` for its current source epoch; a head fact never counts) is under six hours old, the look only writes a later `next_incremental_at` and leaves `last_success_at` and the failure columns alone (ADR 0055, note of 2026-10-21). A skipped Property still counts against the 2,000-per-run budget below, because it was read from the due set. With Google Pub/Sub push dark (`sync.gbp_push_enabled = 0`) the sweep is the ONLY path a new review has into the app: nobody gets notified, the inbox goes quiet, and there is no error anywhere.

**First three things to check:**

1. Is the sweep even firing? `ops:queue status background` and look for the `discover-new-reviews` repeatable job; check `worker.heartbeat.age_ms` / `worker.heartbeat.stale` on `/api/health/metrics`. A dead worker explains everything.
2. Is it firing and failing? Search worker logs for the `discover-new-reviews` job name and its `errorClass` field. An enqueue failure defers the offending property and re-throws for a queue retry, so a single poison property shows up as a repeating failure with a stuck cursor.
3. Is it firing, succeeding, and skipping? The "Discover new reviews sweep finished" log line counts `candidatesSeen`, `enqueued`, `skipped` (with `skippedHot`, `skippedWarm`, `skippedCold`) and why each full look ran (`fullSkipDisabled`, `fullFailureRetry`, `fullNoReconciliation`, `fullDue`). `enqueued` 0 with `skipped` above 0 is a healthy sweep. A Property with a coded failure or no completed reconciliation is never skipped.
4. Is it firing, succeeding, and starving? Compare `sync.due_for_incremental` against the batch budget (200 per batch × 10 batches = 2000 properties per run). If the due count exceeds that, the sweep is healthy but under-provisioned and the oldest property never gets reached.

**Reading the dark head checks (`REVIEW_HEAD_CHECKS=dark`, the default):** a look the skip rule leaves empty is followed by one read of Google's newest page (ADR 0055, note 2026-10-21 (c)). It stores nothing; it records what a persisting check would store. Two places to read it:

- The worker log line `Review head check finished` (`event: review_head_check`), content-free and with no Property id: `outcome` (`compared`, `order_violation`, `skipped_outstanding_failure`, `rate_limited`, `provider_unavailable`, `provider_rejected`, `authorization_changed`, `malformed_response`, `no_provider`, `error`), `listed`, `new`, `changed`, `replyChanged`, `leaseRefresh`, `wouldPersist`, `totalDifference` (Google's total minus the stored live count), `averageDifference`, `hasMore`, `orderViolation`, `durationMs`. The sweep line adds `headChecksEnqueued` and `headChecksFailed`.
- One `review_sync_runs` row per check with `mode = 'head_dark'` (30 days; a persisting check writes `mode = 'head'`, see below). `result` is JSON, so a comparison is a query, for example the share of checks that would have stored something and the order-violation rate:

```sql
SELECT count(*) AS checks,
       count(*) FILTER (WHERE (result::jsonb)->>'outcome' = 'order_violation') AS order_violations,
       count(*) FILTER (WHERE ((result::jsonb)->>'wouldPersist')::int > 0) AS would_persist,
       sum(((result::jsonb)->>'new')::int) AS new_reviews,
       sum(((result::jsonb)->>'replyChanged')::int) AS reply_changes,
       count(*) FILTER (WHERE ((result::jsonb)->>'totalDifference')::int <> 0) AS total_differs
  FROM review_sync_runs
 WHERE mode = 'head_dark' AND started_at > now() - interval '7 days';
```

`error_class` carries the outcome of every check that did not compare (`failed_count` is 1 for a provider failure). A high order-violation rate means Google ignores `orderBy` for some locations: the check cannot be trusted there and persisting must not be enabled. A page with any review that has no `updateTime` also counts as an order violation (the order of that review cannot be checked), so a Property that violates on every check may hold one such review and not an ignored `orderBy`; look at that Property before reading the rate as a Google fault. Kill switch: `REVIEW_HEAD_CHECKS=off` on the worker and restart; a head job already queued then ends as `disabled` without calling Google. A head check shares the reviews quota lane, so a rate-limited one only logs and ends; it never re-enqueues itself.

**Switching the head checks from dark to persist (`REVIEW_HEAD_CHECKS=persist`, ADR 0055, note 2026-10-21 (d)):** persist stores what the dark rows say it would: the reviews that differ and Google's own count and average. It is built and OFF. Switch it on only when all of these hold:

1. A week of `head_dark` rows has been read (the query above). The order-violation rate is near zero; `would_persist` is the share of checks that would have stored something and `new_reviews` and `reply_changes` are plausible against the Inbox; `total_differs` is explained (a count Google shows over what RepKey holds is normal while a deletion or a review beyond page 1 is waiting for the next full run).
2. Migration 0067 is applied and web and the worker run the commit that carries the filtered readers (`listing_complete`). Check `\d review_google_reputation_snapshot_facts` shows `listing_complete` and `numbers_observed_at`.
3. Set `REVIEW_HEAD_CHECKS=persist` on the worker and restart it. Nothing else changes; `REVIEW_RECONCILE_WITHIN_HOURS` stays at 6.

**What to watch the first day:**

- Head run rows now have `mode = 'head'`. Each is the dark comparison plus what was stored:

```sql
SELECT count(*) AS checks,
       count(*) FILTER (WHERE (result::jsonb)->>'persisted' = 'stored') AS stored_checks,
       count(*) FILTER (WHERE (result::jsonb)->>'persisted' = 'skipped_snapshot_active') AS skipped_active_run,
       count(*) FILTER (WHERE (result::jsonb)->>'persisted' = 'skipped_no_listing') AS skipped_no_listing,
       count(*) FILTER (WHERE (result::jsonb)->>'persisted' = 'unavailable') AS unavailable,
       sum(created_count) AS new_reviews_stored,
       sum(updated_count) AS other_stored,
       sum(((result::jsonb)->>'failed')::int) AS write_failures,
       count(*) FILTER (WHERE ((result::jsonb)->>'factWritten')::boolean) AS facts_written
  FROM review_sync_runs
 WHERE mode = 'head' AND started_at > now() - interval '1 day';
```

`write_failures` above zero is a retry waiting for the next look, not a latch; look at the worker log for `review_head_check_persist_failed`. `skipped_no_listing` should be rare (a new or relinked Property before its first full run).

- The worker log line `Review head check finished` now also carries `persisted`, `storedNew`, `storedOther`, `storeFailed` and `factWritten`.
- Facts: head facts are `listing_complete = false` rows in `review_google_reputation_snapshot_facts`, written on a change of Google's total or average or after six quiet hours, so about four a day on a quiet Property. A Property's newest fact should never be older than about six hours:

```sql
SELECT listing_complete, count(*), max(evaluated_at)
  FROM review_google_reputation_snapshot_facts
 WHERE evaluated_at > now() - interval '1 day' GROUP BY 1;
```

- Inbox closes: replies written on Google now close Inbox items within the look interval (15 to 60 minutes) instead of the next reconciliation. `review.reply.observed` events in `outbox_events` for the day rise accordingly; `inbox.on-reply-observed` receipts follow them.
- Alerts: `sync.reconciliation-age` must NOT clear because of a head fact (it reads completed listings only); if it clears with no completed run, a process is reading unfiltered facts, so set `dark` at once. `sync.push-missed` should fall, because a review a head check finds is first seen via `head` and only an unpaired `snapshot` first sighting reads as missed.

**Rolling back:** set `REVIEW_HEAD_CHECKS=dark` on the worker and restart. Head facts already written stay and are ignored by the readers that mean a completed listing; reviews already stored are ordinary reviews. Do not roll the code back past migration 0067 without first deleting the `listing_complete = false` rows.

**Remediate:** dead worker → §7. Poison property → read `review_sync_state.error_class` / `last_terminal_error_at` for the property at the cursor and clear or fix it, then `ops:refresh reviews` for one bounded catch-up run. Starving sweep → raise `REVIEW_DISCOVERY_INTERVAL_MINUTES` so fewer properties come due per tick, or raise the batch budget; the alert clears once the oldest overdue property is polled. Raising the interval does not change how often a busy Property is actually read in full below six hours: that is the skip rule. To put every look back to a full snapshot (for example if a missed push needs finding sooner), set `REVIEW_DISCOVERY_SKIP_RECENTLY_RECONCILED=false` on the worker and restart it. Quota/throttle from Google → §3.

**Verification:** `sync.oldest_due_age_ms` falls back under 60 minutes and keeps falling; `sync.due_for_incremental` drains.

**Escalation:** Bozhidar Denev.

### Failed syncs and their retry timing (`sync.failed-nonzero`)

**Alert:** `sync.failed-nonzero` (P2): at least one Property has a coded failure in `review_sync_state.error_class` whose retry is due.

**Timing.** A coded snapshot failure is retried by the discovery sweep with a wait that grows while the failure repeats (ADR 0055, note 2026-10-21 (e)): 15 minutes after the first failure, 1 hour after the second, 4 hours after the third, and 6 hours from the fourth on. A completed run clears the failure and the next one starts at 15 minutes again. A location over the review or page cap (`review_cap_exceeded`, `page_cap_exceeded`) waits 24 hours. A location Google rejects (`provider_rejected`, below) waits on this same ladder. A lost cursor (`cursor_lost`, every deploy that restarts google-provider-redis) and a quiet `listing_changed` record no failure and restart at once. So a Property can sit in this alert for up to six hours between attempts without the sweep being stuck: the alert counts a failure whose retry date has passed, and the sweep picks it up on its next run after that date. `review_sync_state.error_retry_at` and `next_incremental_at` hold the same instant for a failed Property, and `last_terminal_error_at` holds when it last failed, so `error_retry_at - last_terminal_error_at` is the wait it was given. A push notice does not shorten that wait: the poll is never moved ahead of `error_retry_at`.

**Reading it.** The worker log line `Review snapshot failed; the next retry is backed off` (`event: review_snapshot_failure_deferred`) carries `failureCode` and `retryAfterMs`, with no Property id. A Property that failed three attempts of one job in a minute is one failure, not three: a failure that lands before the previous retry date keeps the previous wait.

**A step that finds its run failed (`run_already_failed`).** A snapshot step carries the id of its run. The step that continues a run and fails it records the failure and dates the backoff above, logs `review_snapshot_failure_deferred`, reports the failure to Sentry itself, once, and throws the ordinary `ReviewProviderSnapshotFailure`. The report is explicit because the store ended the run before the throw: BullMQ's retry of the step can only find the run `failed` and ends quietly, so the job completes, and the worker, which captures a failure only when it is terminal, would never see it. The event lands in the existing `ReviewProviderSnapshotFailure` Sentry issue with its `failure_code` tag (Sentry groups by stack and that issue is grouped under `runSnapshotStep`, so the job builds and throws the error in that function; a test pins it). Each retry of the step, and any redrive of its dead letter, finds the run `failed`, does nothing and ends as a returned outcome `{ status: 'skipped', code: 'run_already_failed' }` with one worker warning, `review_sync_skipped_run_already_failed` (`failureCode` is the run's code; no Property or run id, because the log schema bans them). The same end awaits any other step that finds its run failed (a job the queue retries after its worker died, a continuation queued before the run ended). No retry is spent, nothing is dead-lettered, no quarantine entry is made and the job-runtime repair latch is not set, so one transient failure raises one Sentry event and no `queue.quarantine-nonempty` or `worker.job-runtime-unready`. `sync.failed-nonzero` still fires from `review_sync_state` when the failure persists past `error_retry_at`. A dead letter that a release before this behaviour left redrives quietly too (§14), and a successful redrive answers its latch (§17); discarding it and acknowledging the repair is only for a release without this behaviour (§30, 2026-10-24). `review_sync_state` is untouched by a replay, so it neither moves `error_retry_at` nor climbs the ladder, with one exception: when the step that failed the run died before it dated the failure (the cursor store was down while it discarded the cursors, the worker restarted), the Property holds no failure at or after the run's end, and the replay records it once with the backoff the failing step would have dated and the same deferral warning, and still ends quietly (that failure is not reported to Sentry; `sync.failed-nonzero` is its signal). A failure already recorded, or one a later success has cleared, is never recorded again. A run lost as `cursor_lost` or `listing_changed` is the other exception: its replay still queues the fresh run, because the step that lost it may have died before queueing one. The first step of a run has no run id: its retry starts a new run, which can fail on its own, and three failed attempts end in a dead letter and a Sentry event (`ReviewProviderSnapshotFailure`), captured by the worker. The exceptions are the parked failures (a location over the cap, a location Google rejects, below): they throw nothing, for a first step as for a continuation step. Before this behaviour (until the release that carries it) each retry of a continuation step threw the old failure again, which pushed the backoff out and left a dead letter no redrive could clear (§30, 2026-10-24).

**Retry sooner.** Fix the cause first. The sweep takes a failed Property at its retry date. To retry earlier, set `next_incremental_at` and `error_retry_at` of that `review_sync_state` row to now in an operator session; leave `error_class` in place, because a completed run clears it and the alert reads it. `ops:refresh reviews` does not do this: it reruns the hourly content refresh below, which moves only Properties with reviews about to expire and never one still inside its backoff.

### A location Google rejects (`provider_rejected`)

**What it is.** Google answered HTTP 400 or 404 on `reviews.list` (or on the single-review read of a confirmation) for one Location, while the Google connection is healthy and the Organization's other locations sync. Asking again gets the same answer, so it is the Location's own state on Google: removed, suspended, unverified, or no longer readable through the connected account. The beta saw it on 2026-10-26 for 4 of 20 locations on one connection. Before this behaviour the status was recorded nowhere and each of the four failed as an uncoded `provider_failure`, dead-lettering a first step on every round of the ladder (36 failed runs and 12 dead letters, with `queue.quarantine-nonempty`, `worker.job-runtime-unready` and `sync.failed-nonzero` raised together).

**What the system does.** The snapshot run ends as `provider_rejected` (`review_provider_snapshot_runs.failure_code`) and discards its cursors. The worker writes one warning, `review_snapshot_provider_rejected`, with `providerStatus` (Google's HTTP status, 400 or 404; null if the error carried none), `dispatch` (`answered`) and `runId`. Look the status up in the worker log: 404 means Google no longer has the Location through this connection, 400 means it refuses the request for it. The job then parks the Property like a location over the cap: it records `error_class = provider_rejected`, the failure time and the retry date, logs `review_snapshot_failure_deferred`, and ends normally. It throws nothing, so there is no BullMQ retry, no dead letter, no quarantine entry, no Sentry event and no repair latch (`worker.job-runtime-unready` stays clear), and `markSyncSucceeded` is not called. The wait is the ordinary ladder (15 minutes, 1 hour, 4 hours, 6 hours cap), not a day, so a Location fixed on Google is read again within hours and a completed run clears the failure.

**What you see.** Only `sync.failed-nonzero`, with `alert_codes` `provider_rejected:N` (N Properties), and only as an edge, not a standing signal. The retry date is written into the future when the failure is recorded, and the alert counts a Property only from that date until the next look fails again and dates a new one: about one 15-minute sweep per rung of the ladder, once per 6 hours at the cap. So it raises and clears on every rung while the Location stays unreachable, and a quiet alert does not mean the Location is readable. The durable view of what is rejected right now is the query under "What to do". 401 and 403 are not this: they are `authorization_changed` / `authorization_denied` (reconnect Google), 429 and 5xx are retried on the same run, and a code-less failure is still `provider_failure` with its loud error line.

**What to do.** Find the Properties: `select property_id, error_class, last_terminal_error_at, error_retry_at from review_sync_state where error_class = 'provider_rejected'` (read-only session). Then check each Location in Google Business Profile: it is still there, verified, not suspended, and still managed by the account the Organization connected (a Location the account no longer manages is the likeliest 404). If the owner removed the Location on purpose, archive or disconnect the Property in RepKey. If it was fixed on Google, nothing else is needed: the next look reads it and clears the failure. To read it sooner, set `next_incremental_at` and `error_retry_at` of that `review_sync_state` row to now and leave `error_class` in place (see "Retry sooner" above). If every location of one connection is rejected, or the status is 400 for locations that look healthy on Google, treat it as a RepKey request defect instead (the status in the warning and the number of Properties tell the two apart) and take it to the engineers; do not wait on Google.

**Dead letters from before this behaviour.** Redrive them (`pnpm ops quarantine redrive <id> ... --apply`, §14) once a release with this behaviour is live: the first step starts a new run, Google answers the same, and the job parks and completes, which clears the dead letter and answers `worker.job-runtime-unready` (§17). Do not discard them without a release that carries it: the next round of the ladder only makes new ones.

### A Google connection that needs reconnecting (`connection_unusable`)

**What it is.** The Organization's Google connection is `reauth_required` (Google refused its refresh grant for good: `invalid_grant`, status reason `provider_revoked`, which moves it there and raises `integration.google_account.reauthorization_required`), disconnected, short of its `business.manage` scope or its credential use state is not `active`. Every Property on it can no longer read Google. The AccountAdmins got the in-app "reconnect Google" notice; that notice is the signal, and the syncs stay out of the way.

**What the syncs do.** The discovery sweep does not select a Property whose connection is unusable (§13 above), so it starts nothing. A GBP push for one of them still queues its targeted job (a connection can break between the push and the run), and a snapshot run already in flight meets the same wall on its next step. Both end as a returned outcome `{ status: 'skipped', code: 'connection_unusable' }` with one worker warning, `review_sync_skipped_connection_unusable` (`mode` is `targeted` or `snapshot`; no Property or connection id, because the log schema bans them). No retry is spent, nothing is dead-lettered, Sentry gets no event, `worker.job-runtime-unready` does not latch, and `review_sync_state` is untouched (no `error_class`, no retry date), so `sync.failed-nonzero` stays quiet. A run ended mid-way is `review_provider_snapshot_runs.failure_code = 'connection_unusable'` and is never resumed. Before this behaviour (until the release that carries it) the same pushes failed as `authorization_denied`, three attempts, a dead letter, `JAVASCRIPT-TANSTACKSTART-REACT-19` and a `worker.job-runtime-unready` latch on `sync-property-reviews`; clear a leftover one by §14 and `pnpm ops jobs acknowledge-repair sync-property-reviews` (§17).

**Reading it.** The warning count is roughly the pushes plus the runs that arrived while the connection was down; a steady trickle for days means the notice has not been answered, so ask the Organization's AccountAdmin to reconnect. `authorization_denied` is still the loud one: it means the connection IS usable and the authority refused (the authorization vector moved, the content posture denied the call, a kill switch or suspension), so read §3 and the `google_review_sync_authorization_vector_changed` warning instead.

**Recovery.** An AccountAdmin reconnects Google from Settings with the Google account that manages those locations. The same connection row returns to `active` under a new credential generation: the Properties keep their connection and location binding, so nothing is imported again. Each Property is polled on its own due date (`next_incremental_at`, untouched while it waited) and its first fresh run lists everything Google has, which finds what the pushes announced meanwhile. To poll sooner, set `next_incremental_at` of the Property's `review_sync_state` row to now. The reconnect must be made with the same Google account the connection was made with: a different account is refused (`account_already_connected`, "does not match the requested connection") and the connection stays `reauth_required`.

### The hourly content refresh (`refresh-expiring-reviews`)

It enqueues no sync. For each Property with a review whose content expires within five days it checks the last completed reconciliation (`review_google_reputation_snapshot_facts.evaluated_at` of a fact with `listing_complete = true`, current source epoch; a head fact from `REVIEW_HEAD_CHECKS=persist` is not one). Older than 24 hours, or none: the Property's `next_incremental_at` is moved up to now, and the normal discovery sweep runs it with its spread, the skip rule and the failure backoff (so expect the sync within one 15-minute sweep plus the start spread, not at once). A reconciliation inside the day: nothing, because that listing already refreshed every review Google lists. A Property with a failure whose retry date is ahead is not moved. The completion log line `Refresh expiring reviews completed` carries `refreshDueCount`, `pulledForward`, `skippedRecent` and `skippedBackoff`; on the `review_refresh_runs` row `enqueued_count` is the number pulled forward and `enqueue_failed_count` the number of failed updates. A content clock that still reaches 30 days on a Property that was reconciled inside the day means Google no longer lists that review, which is the correct outcome.

### Reconciliation age (`sync.reconciliation-age`)

**Alert:** `sync.reconciliation-age` (P2) — a Property the sweep still polls has no completed reconciliation (a completed provider snapshot run, recorded as a `listing_complete` `review_google_reputation_snapshot_facts` row for its current source epoch; a head fact from `REVIEW_HEAD_CHECKS=persist` does not count) inside the last 8 hours.

**What it means:** the six-hour reconciliation is the safety net that finds a review whose push never came (ADR 0055 decision 5), and the only path while push is dark. The sweep guarantees one about every six hours; the alert fires two hours later, so a slow sweep does not page. A Property with no completed reconciliation yet is counted from the day it became syncable (`properties.updated_at`, `google_connections.credential_authorized_at`, as for `sync.sweep-lag`), and a Property restored with an old reconciliation is counted from the day it qualified again. A Property parked with a coded failure (`review_sync_state.error_class`, for example `review_cap_exceeded` for a location over the cap) is left out: it has its own alert, `sync.failed-nonzero`. The alert does not depend on push. It is held while the `health.sync` or `health.syncPush` section is degraded.

**First things to check:** `GET /api/health/metrics` → `syncPush.reconciliation.overdueCount` and `oldestAgeMs` (`sync.reconciliation_overdue`, `sync.oldest_reconciliation_age_ms`). If `sync.oldest_due_age_ms` is also high the sweep itself is behind: follow the checks above. If the sweep is healthy, read the overdue Properties' runs: a run that keeps failing before it completes (see the sync failure codes on `review_sync_state`), or a location that never finishes its listing, never writes a fact.

**Remediate:** as for the sweep above (dead worker → §7; poison Property → clear or fix its error and `ops:refresh reviews`; Google quota → §3).

**Verification:** `sync.reconciliation_overdue` returns to 0 once each Property completes a run.

**Escalation:** Bozhidar Denev.

---

## 14. Quarantine Non-Empty (Dropped Work)

**Alert:** `queue.quarantine-nonempty` (P1) — a job has been sitting in the `quarantine` queue for more than 15 minutes. `queue.quarantine-growth` (P2, §4) is the same condition aged past the 24-hour operator redrive SLA.

**What it means:** the quarantine is a dead-letter queue with **no consumer** — nothing drains it, and the daily `quarantine-ttl-sweep` DELETES entries after `QUARANTINE_TTL_DAYS` (default 30d). A job that lands there is lost work that no retry will ever pick up. If it was a review sync, a notification fan-out, or a reply publication, that unit of work simply never happened and nobody was told. Fifteen minutes is three health-check evaluation cadences: long enough that an operator actively redriving right now does not trip it, short enough that the loss is still recoverable.

Only on-demand work lands here. A schedule firing is never dead-lettered: every schedule is enumeration-only, so its next firing repeats the whole pass and nothing is lost, and there is no unit of work to redrive. A firing that fails past its retry budget is logged (`job failed` at error level, then `terminal schedule firing failure — not dead-lettered, the next firing repeats the pass` as a warning), captured in error monitoring, kept in BullMQ's retained failed set, and shown as `repair_required` on its family's job-runtime row until a later success, for as long as the family is active with a schedule; the row's `lastScheduleFailureAt` and `failedCount` keep the record after that (§17). A manual run of a scheduled family (`pnpm ops refresh`, `pnpm ops purge`) is on-demand work and lands here like any other.

**First three things to check:**

1. `ops:quarantine list` — what is in there (the oldest 100 entries, oldest first, so the entry the age alerts page about is always listed; redrive and discard look their target up by id, so any entry is reachable, listed or not), how many distinct job names, and is each entry `confirmed_failed`? One entry is a poison payload; a growing pile of one job name is a systemic handler failure. `pending_failure` means the worker staged evidence before rejecting but did not observe BullMQ's completed failed transition; redrive requires fresh proof that the original remains failed, so a recovered/completed original cannot be duplicated.
2. The quarantine reason. `ops:quarantine list` prints it under each entry: the error name and its first message line, followed by `(policy: policy_unavailable)` when the attempt that exhausted the job was refused by the delayed-execution gate because it could not read the policy. That one is a policy outage, not a handler bug: restore the policy read before any redrive. It never appears for a schedule firing: a firing whose retries were all spent on an unreadable policy is not dead-lettered, so look for `delayed execution denied — retry (policy_unavailable)` in the worker's `job failed` log and for `repair_required` on the family's row (§17) instead. Anything else is a handler that threw past its retry budget. No region or routing reason exists, and no alert watches for one.
3. `queue.quarantine.oldest_age_ms` versus `QUARANTINE_TTL_DAYS`. This tells you how much time is left before the TTL sweep deletes the evidence along with the work. The gauge, the listing, and the TTL sweep all read the quarantine oldest-first, so a burst of fresh dead letters cannot hide an aged one.

**Remediate:** fix the underlying handler failure FIRST (a redrive into a broken handler just re-quarantines), then match each entry's job family to the event-job catalogue. For an enabled family, first run `ops:quarantine redrive <id> --operator <registered-operator>` for the dry-run report, then add `--reason <incident-reason> --apply`; redrive returns the job to its original queue. For a blocked or quarantined family, never redrive: first run `ops:quarantine discard <id> --operator <registered-operator>`, record the identifiers and disposition in the incident, then add `--reason <incident-reason> --apply --yes ops:quarantine`. Discard permanently removes the quarantined job without executing or re-enqueuing it, which is why it alone needs the typed confirmation. An entry of an enabled family that a redrive cannot repair is discarded the same way once the incident record says why; the family's `repair_required` is then acknowledged (§17). A review sync step that continues a run that already failed is not one of them: with the release that carries `run_already_failed` (§13) live, its redrive ends as a skipped outcome and succeeds, including for a dead letter an earlier release left, so redrive it. Only on a release without it does the redrive fail again, and such an entry is discarded. For `pending_failure`, the redrive apply path first reads the original job and proceeds only when BullMQ still reports it as `failed`; that proof idempotently confirms the staged copy. A recovered, active, waiting, completed, or missing original is refused and must not be force-redriven. Invitation-event and invitation-Activity payloads are sanitized again at the redrive boundary, so a concurrent privacy-verification scan cannot miss content moved between queues.

**Verification:** `queue.quarantine.depth` returns to 0, redriven jobs complete in their original queue, and discarded jobs were never executed or re-enqueued. A discard, like the TTL sweep's expiry, does not clear the family's `repair_required` (§17): when the cause is fixed and the family's later runs completed, acknowledge the failure with `pnpm ops jobs acknowledge-repair <jobName> --operator <registered-operator>` (dry run first, then `--reason <incident-reason> --apply`), which refuses while any of the family's dead letters remains or no success has followed the failure.

**Escalation:** Bozhidar Denev. Any quarantined entry that cannot be safely redriven or deliberately discarded is a data-loss event and needs written sign-off.

---

## 15. Notification Delivery Stalled

**Alerts:** `notification.in-app-delivery-lag` (P1), `notification.immediate-email-acceptance-lag` (P2), `notification.missing-for-inbox-item` (P1), `notification.email-stalled` (P2), and the email-outcome alerts `notification.email-permanent-failures`, `notification.email-bounce-rate`, `notification.email-complaints`, `notification.email-retry-exhausted`, and `notification.email-provider-feedback-missing` (all P2).

**What `notification.in-app-delivery-lag` means:** an active beta Notification source fact has remained incomplete for more than 60 seconds from its durable source clock. Route facts whose consumer announces nothing (an import's historical arrivals, a cycle opening Feed does not announce, the provider's close of a history item's first cycle, a bulk reopen's per-item facts) are not counted; `silent-route-fact.ts` restates those consumers' rules in SQL, so a change to either belongs in both. `notification.delivery.source_receipt_pending` is source work the durable consumer has not acknowledged; `notification.delivery.materialization_pending` is Redis-accepted work without its atomic PostgreSQL notification/materialization receipt. The alert uses the oldest outstanding source age as a breach signal. It does not by itself prove the deployed p99 latency distribution.

**First three things to check:**

1. Read both pending counts and their saturation gauges. A saturated count is a lower bound, shown with `+` in the alert detail; do not treat it as an exact backlog size. The alert's tags name what is pending: `alert_codes` counts the pending source facts by route event type (`inbox.handling_cycle.closed:5`), `alert_count` is both stages together, and `alert_reasons` says when a stage hit its scan cap (`source_scan_saturated`, `materialization_scan_saturated`) or the materialization stage is pending too (`materialization_pending`). A capped breakdown covers only the oldest facts the scan held. Event type names are a closed set; the tags carry no row content.
2. Compare `notification.delivery.oldest_materialization_source_age_ms` with `notification.delivery.oldest_materialization_enqueue_age_ms`. A large source age with a small enqueue age points to outbox/dispatch delay; both growing points to the insert-notification worker, PostgreSQL settlement, or Queue Redis.
3. For missing source receipts, inspect outbox dispatcher/`domain-events` health. For missing materializations, inspect the insert-notification job state and quarantine before changing any receipt.

**Remediate:** restore the failing stage first. Missing base receipts replay through the durable outbox consumer; deterministic per-recipient job identities converge repeated enqueue. That replay is bounded: a fact whose published-event redelivery is exhausted (three rounds) is replayed by nothing automatic, and `reconcile-missing-notifications` never sees it because its consumer queued nothing, so once the cause is fixed use a bounded report-first replay of the affected source facts. Redis-accepted work normally repairs through BullMQ retry/redrive, and PostgreSQL settlement makes a replay duplicate-safe. A delivery still unsettled five minutes after its enqueue receipt — its insert job exhausted, or Queue Redis lost it — is repaired by `reconcile-missing-notifications` every ten minutes for 24 hours: it hands the source fact back to its route's consumer, which re-derives the job under the fact's own event id and delivery marker, and queues only the deliveries the original fan-out queued (they have an enqueue receipt) that still miss their materialization receipt, each as `notification-repair-<receipt key>`. The sweep's summary log counts replayed, denied and failed facts; a failed replay stays a candidate and retries next firing. A repair job that spends its own attempts is dead-lettered like any other: the next firing releases it from BullMQ's failed set and queues it again with a fresh budget, so once its cause is fixed the delivery settles without a redrive. Its quarantine copy can then be discarded; redriving it instead is harmless, because settlement records the late job as a duplicate. A delivery the consumer no longer produces stays unsettled until it leaves the 24-hour window: its recipient no longer qualifies, which the delivery-time audience check would have refused anyway, or the consumer now derives it under another identity — a Google connection whose anchor Property changed, say. The repair never queues that new identity, because its recipient may already have been told under the old one. Never delete a materialization receipt or invent a notification row to silence the gauge.

**Verification:** both pending counts return to 0, both saturation flags are false, and all oldest source/enqueue clocks and ages return to null. Retain a separate deployed latency record for the p99 ≤60-second target.

**What `notification.immediate-email-acceptance-lag` means:** immediate email that was eligible to send exceeded five minutes from its durable source fact to provider acceptance, or the bounded evidence cannot evaluate that target safely. The signal combines completed source-to-acceptance p99 with the oldest still-awaiting source age. A retained `not_before` quiet-hours or policy hold is intentionally excluded from both. This target is operational evidence, not a customer SLA.

The evidence counts only rows whose scope may send email right now: the scoped `notification.send_email` decision (Organization allowlist, suspension, kill switch) that also gates the email jobs. A capability-dark Organization's immediate rows stay `pending` by design — nothing ever attempts them — so they are excluded rather than reported late, whatever the global capability gauge reads. An allowed scope's row counts even when nothing was accepted or attempted: that is exactly an urgent job that was never enqueued or never ran. Rows link to their source by event id and Organization only, because an Organization-level source (a Google account needing reauthorization) raises a notice anchored to a Property. `notification.email.immediate_acceptance_source_unlinked > 0` and `notification.email.immediate_acceptance_saturated = 1` are independent evidence failures: the first has no trustworthy durable clock, while the second means the 1,000-row bounded scan cannot report a full-window p99. That bound counts only rows in scopes that may send, so a dark Organization's backlog can neither saturate it nor crowd sendable rows out of it.

**First three things to check:**

1. Read `notification.email.immediate_acceptance_p99_ms`, `notification.email.immediate_acceptance_oldest_source_age_ms`, and the accepted/awaiting sample counts. This distinguishes completed provider delay from work still awaiting acceptance.
2. Check `notification.email.immediate_acceptance_source_unlinked` and `notification.email.immediate_acceptance_saturated` before interpreting the latency value. Do not treat a missing p99 as healthy when either is non-zero.
3. For linked attempted rows, inspect the immediate-email worker and provider response classes. For unattempted rows, inspect job registration, Queue Redis, and the urgent-email gate decision — a scope the capability allows but the delayed-execution gate still denies leaves its row pending. For unlinked rows, inspect the notification's content-free event identifier and active durable route; do not infer a source timestamp from queue insertion.

**Remediate:** restore the earliest failing stage. Repair source linkage or durable routing before using the latency target; restore the immediate-email worker/provider path for attempted or waiting rows and let its existing idempotency/retry state converge. The hourly digest run's orphan sweep re-enqueues every due immediate row, Property- or Organization-scoped (the mandatory access and purge notices), so a row whose enqueue failed after commit (`Immediate notification email enqueue failed …`, which carries the row's `correlationId`) or whose job exhausted its attempts is retried on the next tick while its retry budget lasts; redrive a quarantined job only to retry sooner. A saturated scan requires draining the backlog or a separately reviewed increase supported by query/index evidence. Do not clear rows, rewrite source/acceptance clocks, or remove legitimate policy holds to make the alert quiet.

**Verification:** source-unlinked and saturation return to `0`; awaiting and attempted-awaiting drain; the oldest awaiting source age returns to null; and an unsaturated accepted sample reports p99 at or below 300,000 ms. Retain a deployed provider acceptance record and alert-injection result separately—the local snapshot is necessary evidence, not proof of the deployed target.

**What `notification.missing-for-inbox-item` means:** an inbox item past the grace edge still has no notification attached and its delivery is not decided — a review arrived, was projected into the inbox, and nobody has been told yet. Delivery is decided once the Feed consumer has run on the item's `inbox.inbox_item.created` fact (its receipt is `applied`) and every delivery it made has settled; an item whose recipients all muted it, or no longer qualify, is decided and never counted. A fact the dispatcher's delayed-execution gate refused carries an `obsolete` receipt the consumer never wrote, so its item keeps counting: that is how a route the gate stopped admitting shows up here. A non-zero count means the consumer has not taken the fact yet (outbox dispatch lag, repaired by dispatcher retries and published-event redelivery for a bounded number of rounds), the gate refused it, or a delivery Redis accepted has not settled (repaired by `reconcile-missing-notifications`). A single occurrence pages because the manager-facing journey is already incomplete. Reviews an import brought in as Google history (`historical_onboarding`) are never announced and never counted, so an import's past reviews having no notification is expected (ADR 0046).

**First three things to check:**

1. Worker logs for the notification handler around the affected window — look for the warn line from the after-commit emit (content-free: `correlationId`, counts, error class). That is where a lost notification leaves its only trace.
2. `outbox.unpublished` / `queue.oldest-age` — if the outbox is backed up, the gap may be delivery lag rather than a lost notification, and §7 is the right runbook.

**Remediate:** fix the throwing handler or stalled worker first. `notification.delivery.source_receipt_pending` and `materialization_pending` say which stage is behind. Facts the consumer has not taken replay through the dispatcher and published-event redelivery; deliveries that never settled are replayed by `reconcile-missing-notifications` through the same consumer, delivery bridge and settlement, so preferences and eligibility are checked again. If its summary log reports failed replays, fix their cause; they retry every firing. An item still counted once the cause is fixed has a fact nothing automatic will replay: its published-event redelivery is exhausted, or the gate refused it and the dispatcher recorded that as the consumer's receipt. Use a bounded report-first replay of the affected source facts, proving first that no materialization receipt exists. The active durable consumers are the primary prevention path; do not disable them or manufacture rows directly.

**Residue from before the 2026-09-22 notification route fix** (record each disposition with the ops-109 backfill decision):

- Quarantined `insert-notification` jobs from the previous missing-notification sweep carry a `delivery.eventId` that no `outbox_events` row has: that sweep minted one per inbox item. Every redrive fails settlement again with `outbox notification durable source attribution mismatch`, so discard them through §14's dry-run-then-apply `ops:quarantine discard`; never redrive them. Any real delivery of theirs still unsettled inside the 24-hour window is repaired by the new sweep.
- `portal.health.changed` facts the old Portal Health consumer rejected have exhausted published-event redelivery. Until 30-day outbox retention removes them, they keep `exhaustedBeforeRun` above zero in the `Published event redelivery sweep needs attention` log. The log does not name event types, so treat that count as new consumer exhaustion only if it grows, or if the outbox rows at the redelivery cap without a consumer receipt are of other event types. Replay them report-first only while the Health interval they announced is still open; the delivery-time check refuses the rest.
- Facts the gate refused under the old per-action scope carry dispatcher-written `obsolete` receipts and will not replay on their own. Replaying them is the pending backfill decision.

**What `notification.email-stalled` means:** queued notification emails are still unsent — `pending`, held for quiet hours (`delayed`), or a transient failure awaiting its scheduled retry — more than two hours past their due time (the later of `next_attempt_at` and `not_before`, else `created_at`, or `created_at` + 25 h for an unscheduled daily-digest row, which waits for its next 08:00 window — a row needs both its retry time and its hold to pass): two missed hourly digest ticks, past any legitimate cadence, batching, or retry backoff. A daily row therefore pages about 27 h after it was queued, well before its 48 h `stale` retirement. A row for a Property that is no longer active (archived, suspended, deleted) is held by every send path until the Property is restored, and is never counted. A quiet-hours hold on an immediate email schedules its own release job for the minute the window ends (`quiet-release-<emailId>-<ms>`, initiator `notification:quiet-hours-release`); the hourly sweep is only the fallback. A frozen digest waits out quiet hours without touching its members and retries under the same key after the window, but never past its retry horizon: a digest batch the provider may already hold is closed unsent 23 h after the first such attempt started, and that check runs before quiet hours are consulted (Remediate, below).

**Read `notification.email.delivery_enabled` FIRST.** It reads `1` when `notification.send_email` is open to every Organization: globally enabled, or `BETA_ALLOWLIST_ORGS=*` and not killed. That is production (closed-beta-v2 runs `*`), so there it reads `1` and any overdue row in `notification.email.pending_overdue` pages. It reads `0` only when some Organizations are admitted by name, or none; then rows queued while a scope was dark are EXPECTED backlog and this alert deliberately stays silent on them, so if you are reading it, one of two things is true: email is open to everyone and genuinely not going out, or `notification.email.attempted_stuck` is non-zero, meaning the delivery path reached those rows and left them unsent — a retry past its due time or a quiet-hours hold past its end. The second case fires even while the global flag reads `0` (judged on `notification.email.oldest_attempted_stuck_age_ms`), because a per-organization allowlist grant is not globally enumerable and would otherwise breakage-hide. It counts only rows whose scope may send right now — the scoped `notification.send_email` decision (allowlist, suspension, kill switch) on an active Property, or an Organization-scoped notice: a row held or retrying when its Organization left the allowlist, was suspended, or its Property was archived is never processed again, and is not a stall.

**First three things to check:**

1. `notification.email.delivery_enabled` and `notification.email.attempted_stuck` — these two tell you which of the two cases you are in, and therefore whether to look at policy or at the provider.
2. If rows were attempted: `last_error_class` / `provider_state` on the overdue rows and the email transport logs. A provider outage, a suppression list, or an expired credential all land here.
3. If nothing was attempted and email IS enabled: the digest and urgent job registrations. `ops:queue status default` / `background` for `notification-urgent-email` and the hourly digest job; a no-op registration log line (`registered no-op job handler (capability dark/blocked)`) means the gate closed at boot and a restart is needed after the policy change.

**Remediate:** capability/policy cause → enable `notification.send_email` for the intended scope and restart the worker so the handler registers for real. Provider cause → fix the credential/suppression and let the retry schedule drain transient failures; rows keep their idempotency key, so replay inside the provider's 24-hour key window cannot double-send, and an immediate row is retired as `stale` 23 h after its first provider attempt rather than retried past that window. A daily digest is held to the same horizon through its batch: a batch the provider may hold (an attempt that timed out, was answered 5xx, or whose worker was lost before it recorded the answer) is closed unsent 23 h after the first such attempt started, before quiet hours are consulted. The batch row (`notification_digest_batches`) ends `state = 'terminal'`, `outcome_class = 'invalidated'`, `terminal_reason = 'digest_retry_horizon_passed'`, its rows still unsent end `suppressed` with `suppression_reason = 'digest_retry_horizon_passed'`, and the worker logs `Digest batch invalidated` with that reason. This is deliberate (ADR 0046, amended 2026-10-13): past that point the provider may have forgotten the key, so a retry could deliver the same digest a second time, and losing one day's digest email is the accepted cost; the in-app notifications are untouched. **Do not re-queue those rows or reopen the batch.** After the worker or the scheduler has been stopped for about a day or more (a failed deploy, or the stop procedure of `docs/BETA.md` §7), expect the first digest sweep after the restart to close such batches instead of sending them. The first sweep after the deploy that introduced the horizon (2026-10-13) does the same for any such batch already open; for those the 23 h count from their latest attempt, the only one recorded before that deploy. A batch the provider refused on every attempt (a rate or quota limit) is not closed this way and keeps its five attempts. A permanently refused row is never selected again and does not drain — that is `notification.email-permanent-failures`, below. Never bulk-clear `pending` rows to silence the alert — that deletes the only record that a user was owed an email. When email is admitted for a scope that was dark, its backlog is not flushed: rows past their freshness bound (immediate 24 h, daily digest 48 h, mandatory notices 7 days, counted from when the row became due) are suppressed with reason `stale` by the sweep or the send path, and only fresh rows are sent.

**Verification:** `notification.email.pending_overdue` drains and `notification.email.oldest_pending_overdue_age_ms` falls under two hours; `notification.email.attempted_stuck` returns to 0. `pending_overdue` counts only scopes whose scoped `notification.send_email` decision allows sending, so a suspended or killed scope's rows never read as late.

**The digest sweep's cap.** The hourly digest sweep reads recipients whose work is due at any hour first (delayed or retrying rows), then those whose local 08:00 is now, up to 5,000. `Digest sweep read as many recipients as its cap allows` means some recipients may miss their hour; they are picked up on a later sweep while their rows are fresh.

**Reading a cancelled or suppressed row.** `suppression_reason` says why a queue row will not be sent: `work_settled` (a settling fact finished the work), `work_no_longer_waiting` (retired at send because the notice was settled, read or dismissed, or the owning context says the work is done), `purge_cancelled` (the final deletion warning taken back), `stale` (past its freshness bound), `digest_retry_horizon_passed` (a daily-digest row whose batch the provider may hold was closed 23 h after that attempt, above; never re-queue it), `recipient_ineligible` (standing lost), `organization_closing`. A `cancelled` or `suppressed` row may also carry `provider_message_id`, `provider_state = 'accepted'` and `accepted_at`: the cancel raced a send the provider had already accepted, and that mail DID go out. Its bounce or complaint still suppresses the address.

**What the email-outcome alerts mean:** the alerts above watch mail that has not gone out. These watch what became of the mail the delivery path did attempt (`notification.email.outcomes_24h`, trailing 24h; `notification.email.accepted_unresolved`, 7-day lookback). They count provider messages, not queue rows: a daily digest is one message however many notifications it carried, so one bounced or refused digest is one bounce or refusal. Without them a revoked key, a silent webhook, or a burned sending domain stopped email with no page.

- `notification.email-permanent-failures` — at least three messages and more than half of the window's attempts were refused permanently. A 401 or 403 refusal of our own sender also reaches Sentry on the first message, whatever the count, as an `EmailProviderRefusedSender` issue (runtime source `email-provider`): rotate or verify `RESEND_API_KEY`, or the sending domain's verification. Fewer refusals stay a gauge: every non-429 4xx is classified permanent, so one malformed recipient address in a quiet Organization is a 100% share on its own. A refused row is never retried, so each one is a lost email. A revoked or rotated `RESEND_API_KEY` (401), a lapsed sending-domain verification (403), and a provider transport failure classified permanent all land here. Read the `Urgent notification email rejected by provider` / `Daily digest rejected by provider` warn lines (classification and provider code only) and the Resend dashboard's API keys and domains. Fix the credential or domain first. Refused rows stay `failed`/`permanent` as the record of what was lost; resending any of them is a separate, reviewed decision, never a bulk queue edit.
- `notification.email-bounce-rate` — at least three bounces and more than 4% of accepted mail in the window, Resend's published ceiling. Each permanent bounce already suppresses its recipient's address (see _A refused address_ below); the risk is the provider throttling or suspending the sending domain. Check whether the bounces cluster on one Organization's addresses or started with a change to `EMAIL_FROM` alignment (SPF/DKIM/DMARC).
- `notification.email-complaints` — a recipient marked notification email as spam. The recipient's address is suppressed automatically; at beta volume one complaint already exceeds the provider's complaint-rate ceiling. Confirm the mail was one the recipient opted into (ADR 0046) and that optional mail carries its unsubscribe header.
- `notification.email-retry-exhausted` — transient failures spent the five-attempt retry budget: the urgent path leaves the row `failed`, the digest path suppresses it, and nothing will send either. The urgent path's exhausted BullMQ attempts also quarantine (§14); the digest path has no other signal. Look for the provider outage or rate limit behind the transient class, then restore it — new mail recovers, the given-up rows do not.
- `notification.email-provider-feedback-missing` — more than two accepted emails have no final provider outcome (delivered, bounced, complained, failed, suppressed) 6h after acceptance, or a single one has none while no provider event at all arrived in 24h (a silent webhook shows on the first message). The detail names the likely cause. Captured rows mean the worker runs the non-sending capture transport (the `NOTIFICATION EMAIL IS BEING CAPTURED` boot line: a placeholder or missing key) and the mail never reached a provider. No provider event at all in 24h means the webhook is silent: `RESEND_WEBHOOK_SECRET` unset on the web service (every delivery answers 503 `webhook_disabled`, and in production with `notification.send_email` enabled web logs `Notification email is misconfigured on web` once at boot), a wrong endpoint in the Resend dashboard, or signature failures (401 in the web log). An event type that is neither `email.*` nor a suppression-list event answers 200 `ignored_event_type` and is logged at info, so it never reads as a failure; a malformed `email.*` event still answers 400. Events that do arrive point at delayed delivery (the unresolved rows read `provider_state = 'delivery_delayed'`) or an event type the webhook does not send. Without provider feedback a bounced address is never suppressed and keeps being mailed (ADR 0046 r.6).

**Verification (email outcomes):** the causing gauge falls back under its threshold as the window moves past the incident — 24h for the outcome counts, 7 days for `notification.email.accepted_unresolved` — and new mail accepted after the fix resolves within 6h.

**A refused address.** A permanent bounce, a spam complaint, or the provider's own suppression puts the recipient's address on `notification_email_suppressions` (reason `recipient_bounced` on the rows it stops), for every Organization and with no expiry; the table holds only a keyed digest, so it cannot be searched by address. To lift one — the mailbox was fixed, or the person asks for mail again — remove the address from Resend's suppression list (dashboard, or `DELETE /suppressions/{id}`). Resend sends `suppression.removed`, and the webhook lifts ours; the Resend webhook must therefore subscribe to `suppression.added` and `suppression.removed` as well as the email events. Never delete rows from the table by hand: without the key no row can be matched to an address. The key is `NOTIFICATION_EMAIL_SUPPRESSION_KEY` once set, else `BETTER_AUTH_SECRET` (see §24).

**One-click unsubscribe unavailable.** The worker refuses to boot while `notification.send_email` is enabled and `NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS` cannot be parsed (a bare hex key without `vN:`, say); the message names the parse problem, never the value. Web answers every one-click POST with 503 `unsubscribe_disabled` in that state, and says so in the boot error above. A 500 from the unsubscribe or webhook route reaches Sentry (source `nitro`) with its stack; the log line carries only the error name and code.

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
4. In Sentry, filter by `release`, `environment`, `service` (`web`, `worker`,
   or `browser`), and `processing_cell`. Events intentionally omit request
   bodies, headers, cookies, user/extra data, exception messages, breadcrumb
   content, local variables, and source context. What tells one failure from
   another instead (src/shared/observability/error-facts.ts):
   - `error_code`: the code the error was thrown with (`internal_error`,
     `temporarily_unavailable`, `ECONNREFUSED`, a SQLSTATE); `cause_code`: the
     first code in its `cause` chain. An unexpected server-function failure
     keeps the original as the cause of its `InternalError`, so the event
     carries both stacks.
   - `failure_code`: the code a typed job failure carries, from the closed set
     it is raised from. `ReviewProviderSnapshotFailure` reads
     `failure_code=authorization_denied`, `provider_failure`, `malformed_page`
     and so on (`ReviewProviderSnapshotFailureCode`), the same value as
     `review_provider_snapshot_runs.failure_code`. A sync step that continues a
     run and fails it reports itself, once, because its retry ends quietly
     (§13); the issue and the tag are the same.
   - `db_code`, `db_constraint`, `db_table`, `db_column`: a Postgres refusal's
     SQLSTATE and schema names, never its values.
   - `error_kind`: `chunk_load` (a code file the tab asked for is gone, often
     an open tab after a deploy) or `network` (the request never completed).
   - Browser events only: `route` (the route template, such as
     `/_authenticated/properties/$propertyId/inbox/`, never the address) and
     the browser's name, major version, and operating system.
5. Unreadable stack frames (bundle files such as `_ssr/x-B1f6QYIB.mjs` line 43574) mean the source maps for that release are missing. The image build
   uploads them when the repository has the `SENTRY_AUTH_TOKEN` secret and
   the `SENTRY_ORG`/`SENTRY_PROJECT` variables: server bundles and the worker
   by debug id, browser chunks by release (no per-chunk snippet, which would
   have cost first paint 16.8 KB). Read the `docker image group (web)` job log
   for `sentry-cli` and `[sentry-vite-plugin] Error` lines; `skipping
source-map upload` means the token is unset. Events from releases built
   before the upload worked stay unreadable.

**Containment:** Do not disable monitoring, and do not deploy an earlier image:
recovery is forward-only (§28). Runtime SDK/transport exceptions already fail
open. If a newly pinned SDK causes resource or startup instability, stop what
the instability endangers with the stop controls (§11) and repair it with a
release that fixes or reverts the pin, deployed forward. Treat any prohibited
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

**Alerts in Sentry.** Every firing alert also reaches Sentry as an issue
titled `[alert] <name>`, tagged `alert=<name>`, `alert_severity=p1|p2` and
`runtime_source=alert-dispatcher`, one issue per alert name (the scrubber
rebuilds the fingerprint `['alert', <name>]` from the allow-listed tag). The
alert's detail text is replaced like any message, so what it was raised on
travels as tags (src/shared/observability/alert-facts.ts), each a machine name
or a count: `alert_jobs` (the governed job families: unready for
`worker.job-runtime-unready`, holding dead letters for the two quarantine
alerts), `alert_reasons` (their readiness reasons, such as `repair_required` and
`dead_letter_present`, or `report_unavailable`), `alert_codes` (failure codes
with a count each, `provider_failure:2,source_changed:1`, for
`sync.failed-nonzero`; the pending route event types for
`notification.in-app-delivery-lag`, §15) and `alert_count`. A list too long for a tag ends in
`,+N`; the detail text is in the log line.
Production has no `ALERT_WEBHOOK_URL`, so Sentry is the only push channel:
configure a Sentry alert rule on new issues, or on
`runtime_source:alert-dispatcher` and `runtime_source:email-provider` (an
`EmailProviderRefusedSender` issue, §15), and set `ALERT_WEBHOOK_URL` on web
and worker when an operator channel exists, so the alert detail and runbook
anchor reach it.

**Log levels.** Logs carry pino level labels (`"level":"error"`), not numbers,
so the Railway Log Explorer filters them: `@level:error` shows the
`← THROW … → 500` lines and `[alert] … firing`, `@level:warn` the warnings.

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
or pause the affected queue without deleting work. Deploying an earlier release
is not one of them: recovery is forward-only (§28), so a bad release is
contained with these controls and repaired by a fix deployed forward. A core
journey outage uses the incident commander and §11; it is not silently hidden
by a capability toggle.

The exact one-cell journey-monitoring and support contract lives in
`src/shared/observability/beta-support-operations.ts`. Google sync and ambiguous
reply aging already have application signals. The next-business-day review
target remains an expectation rather than an SLA. Invitation/onboarding, Google
connection/import, Inbox, Portal gateway, and native-feedback delivery still
require external synthetic configuration. Those external rows and the
alert-delivery drill remain **external evidence required**, not a claim that a
dashboard or alert route is deployed.

**The 72-hour triage backlog page is off for the closed beta (2026-10-19).** The
alert named `beta-feedback.triage-backlog`, at P2, paged when the oldest
delivered, unresolved local receipt was older than 72 hours, or when its
aggregate database observation was unavailable. Sentry titled its issue
"[alert] beta-feedback.triage-backlog" (JAVASCRIPT-TANSTACKSTART-REACT-15). It
fired because six reports that had been triaged and fixed in Sentry were never
recorded in the ledger. The owner treats that ledger deadline as ceremony for
the closed beta, as the SAFE-01 signer and drill ceremony was, so the alert is
no longer defined and nothing pages for an old receipt. Reports still arrive in
Sentry, where the owner triages them and has an alert rule for new feedback. The
ledger, `pnpm ops triage-beta-feedback`, and the content-free count and age read
(written to the health-check log as `betaFeedbackTriage`) all stay. Record a
transition when the reporter should hear the outcome: the bell notice of ADR
0059 is sent from the ledger transition, so a report never recorded there gets
none. Before general availability, restore the alert, its row in
`docs/operations/alerts-and-security-posture.md` and the `beta_feedback_triage`
journey in `beta-support-operations.ts`, following ADR 0059's note of
2026-10-19.

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
one active family has a missing handler or scheduler, had a schedule firing
denied by the delayed-execution gate, missed its last-success or queue-age
objective, stalled, needs repair, or has a dead letter; or a dark/quarantined
family has forbidden executable work. A gate-denied job completes in BullMQ
without retrying, but nothing ran: it is recorded as a denial (`lastDeniedAt`),
never as a success, so it cannot keep a dead family fresh. `jobs.gateDenials`
and each row's `deniedCount` count gate-denied jobs among the retained completed
jobs; they never page, because a denied on-demand job (a suspended
organization, a disabled capability) is routine. `repair_required` means a
terminal failure has not been answered, and each kind of run has its own
answer. On-demand work, a manual run of a scheduled family included, is
dead-lettered (§14): only a successful quarantine redrive of it, or an
operator acknowledging it once the cause is fixed (step 3), answers the
failure, never a later plain success or firing. A schedule firing is never
dead-lettered, so it has nothing to redrive: any later success of the family
answers it, the same rule `schedule_denied` follows, and the reason clears by
itself once the cause is gone. A failed firing counts only while the family is
active with a schedule, so a release that moves a family to `quarantined` or
sets its schedule to `none` no longer leaves it held by firings that failed
before (a quarantined family that kept its scheduler is
`quarantined_scheduler_registered`). Each row
says which latch holds: `lastOnDemandFailureAt` and `lastScheduleFailureAt` are
the latest failure of each kind, and `failedCount` counts the family's jobs
among the retained failed jobs, so a schedule that fails most of its firings
stays visible after one success answers the latest. `jobs.terminalFailures`
totals them and, like `jobs.gateDenials`, never pages. A head written before
failures were split by kind kept one time for both; the report reads it as a
firing for a scheduled family and as on-demand work otherwise. The report
retains the
observed cell, owner, processor, action, capability, queue policy, cadence,
timeout, concurrency, freshness objectives, runbook, and repair command for
each family. It contains no tenant or payload content.

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
--apply --yes ops:quarantine`.
   For `schedule_denied`, the worker's `delayed execution denied — terminal`
   error for that job names the policy `reason`. Every schedule row is
   tenant-cross or unscoped, so the denial is a catalogue or policy defect, not
   a kill switch.
3. For missed objectives, stalled work, repair-required state, or dead letters,
   inspect the original queue and run `pnpm ops quarantine list --operator
<registered-operator>` before applying the row's exact repair command.
   The row's failure times say which latch holds. On an active scheduled row
   (`posture` is `active`, `schedule` is not `none`), a `lastScheduleFailureAt`
   later than `lastSucceededAt` is a failed firing. It has no quarantine entry,
   so read the worker's `job failed` error and the error-monitoring event for
   that job name. If the reason
   outlives one cadence plus the family's retry budget (`retryAttempts` ×
   (`timeoutMs` + the `retryBackoff` delay), all on the row), the firings are
   still failing. Once the cause is fixed, any later success clears a failed
   firing, so a daily family need not wait a day where an enqueue command exists:
   `pnpm ops purge retention --operator <registered-operator> --reason
<incident-reason> --apply --yes ops:purge` reruns `retention-sweep` (§10), and
   `pnpm ops refresh reviews --operator <registered-operator> --reason
<incident-reason> --apply` reruns the hourly `refresh-expiring-reviews`. The
   other daily families, `quarantine-ttl-sweep` and
   `reconcile-gbp-notification-subscriptions`, have no rerun command
   (`pnpm ops gbp-subscribe` only reports and refuses `--apply`), so they wait
   for their next firing. Otherwise the latch is `lastOnDemandFailureAt`: a
   dead-lettered on-demand job, or a failed manual run of a scheduled family,
   listed by `pnpm ops quarantine list`. A successful redrive of it (§14)
   clears it; a later firing does not, and neither does discarding the dead
   letter or its expiry under `quarantine-ttl-sweep`. A redrive of a dead letter
   that continues a run that already failed (a snapshot sync's continuations do)
   succeeds with the release that carries `run_already_failed` (§13): the step
   ends as a skipped outcome, which answers the failure, and that release no
   longer leaves such a dead letter. An earlier release left one, and its redrive
   failed again, so nothing would ever repair the family and the alert would
   outlive the incident. For any dead letter a redrive cannot repair, once the
   cause is fixed and the family's later runs complete, acknowledge the failure
   instead. First discard the family's dead letters (§14), then run
   `pnpm ops jobs acknowledge-repair <jobName> --operator <registered-operator>`
   for the dry run, which prints the row's failure and repair times and its
   reasons, and add `--reason <incident-reason> --apply`. The command refuses, and says
   which, while the family still has a dead letter or a retained failed job
   newer than its latest success: those are failures that can still be seen,
   and it will not hide them. It also refuses while the failure it would answer
   is newer than the family's latest success, even once BullMQ has trimmed that
   job from its failed set: nothing shows the cause fixed, so wait for a later
   run to succeed. It sets `lastRepairAt` to the time of the newest on-demand
   failure it saw and changes no other field, so a failure after that time
   latches again; a failed firing is not its to answer (a later success does).
   Its printed record (operator, reason, correlation id, the head before and
   after) is the only audit trail: copy it into the incident record. Never
   edit Queue Redis by hand. A ready row with a growing `failedCount` is a
   schedule that fails between successes: read the same errors.

**Remediate:** repair configuration/handler/scheduler drift by promoting a
reviewed immutable release; never register an ad-hoc handler or repeat entry in
Redis. Remove forbidden dark/quarantined schedules through normal scheduler
reconciliation and discard their queued work without executing it. For an
active poison item, fix the handler cause first, review the quarantine report,
then execute the row's report-linked redrive command. A failed firing needs no
command: fix the cause and the family's next success clears `repair_required`.
A failed manual run of a scheduled family is on-demand work: redrive its dead
letter, or, when a redrive cannot succeed, discard it and acknowledge the
failure (step 3). A domain-specific
reconciliation or rebuild remains authoritative when its runbook says replaying
one queue item cannot reconstruct the projection.

**Verification:** `jobs.ready` is true; `jobs.failing`, missing handler/scheduler,
schedule-denied, forbidden-dark-work, missed-objective, queue-age, stalled,
repair-required, and dead-letter counts are all zero; every active scheduled row
has a recent `lastSucceededAt`; and a second health-check cadence remains green
after a worker restart. `jobs.terminalFailures` is informational: it falls only
as BullMQ trims its retained failed jobs, so watch that it stops growing.

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

**Containment:** Stop new uploads with `BETA_CAPABILITIES_OFF=portal.upload`
(the sweep and takedown keep working; §27) and serve the safe presentation
fallback. A page whose image cannot be read is served without it, and the
image route logs `portal_media_object_missing` or `portal_media_object_mismatch`
with the asset id. Do not make the bucket public, broaden credentials,
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

## 22. Review Analysis Coverage Stalled or Empty Enrollment

**Alerts:** `ai.review-analysis-stalled` (P2) and
`ai.review-analysis-empty-enrollment` (P2).

**Trigger/Symptoms:** An AI-enabled Property has fewer current-epoch rows in
`ai_property_aggregate_settlements` than
`review_ai_analysis_heads.head_sequence -
merchant_ai_enablement.analysis_start_sequence`, and the settlement count has
not advanced for more than 15 minutes; or a `queued`/`running` enrollment
captured `snapshot_revision_count = 0` while its fenced eligible-review set is
non-empty. The insights surface may remain “still settling” indefinitely.

**Impact:** P2 — governed Review Analysis derivatives and Property insights are
incomplete or a first-enablement backfill was silently skipped. Review source
content and manual review/reply workflows remain available.

**Diagnostics:** Work from identifiers and counts only. For the current
enablement source and Review Analysis epochs, compare the exact settlement
count with the review-head sequence minus the enablement start sequence; do not
use an aggregate-head watermark or `property_profile_version` as completeness.
Check the oldest unsettled identifier-only outbox event, the
`ai.analyze-review-event` consumer receipt, AI operation/reaper state, Queue
Redis health, and published-event redelivery attempts. The recovery passes
isolate a row that keeps failing instead of stopping: the worker's
`AI operation recovery reaper completed` line counts it as `candidatesFailed`
and `AI Review Analysis enrollment sweep completed` as `enrollmentsFailed`,
and each failure is logged at warn as `AI operation recovery candidate failed`
or `AI review analysis enrollment advance failed` with the operation or
enrollment, Organization and Property identifiers. Both lines are logged at warn
while the count is above zero, and an operation row too corrupt to parse is
counted in `candidatesFailed` and logged as
`AI operation recovery row unreadable` with its operation and Organization
identifiers; read that row by its identifier. A count above zero on consecutive
ticks names the row to look at. No alert reads these counts, so someone has to
look at the line. A row that keeps failing stays at the front of the reaper's
listing (ordered by Organization) and takes one of its 100 slots every tick:
`batchFull` true together with `candidatesFailed` shows the pass is being
crowded out, and the failing rows need clearing before the later Organizations
are reached. For an empty enrollment,
re-run the enrollment eligibility predicate at its stored fence and compare the
eligible count with its snapshot count; never copy review text into the
incident record.

First rule out a stop, because a stopped Property's reviews wait on purpose and
this alert fires for them after fifteen minutes. Review Analysis is stopped for
a Property while `BETA_CAPABILITIES_OFF` names `ai.analyze` or `all`, while its
Organization is in `BETA_SUSPENDED_ORGS` or off `BETA_ALLOWLIST_ORGS`, or while
an AI execution control (global, provider or the `review_analysis` capability)
is not `enabled`/`accepting` (§25). Reviews that were queued and reviews that
arrive during the stop both wait in `ai_review_analysis_backlog`. The worker's
`AI Review Analysis backlog drain completed` line counts them as `denied`
(platform policy) or `stopped` (AI execution controls) each time it asks, about
once a minute per review. Nothing is lost and nothing needs repair: lift the
stop and the drain analyses them within about a minute of the worker running
under the lifted stop, and the alert clears as the settlements arrive.

One case takes a few minutes longer after an AI execution control is restored.
A review the drain had already tried before the stop (its lane was full, or the
provider said to come back later) cannot resume its operation, because that
operation is bound to the control generations it was claimed under and every
kill, drain and restore moves one. At the restore the drain closes it as
`execution_suspended` and settles the review, and the enrollment sweep's reopen
pass queues the review again within a minute: the worker's
`AI Review Analysis enrollment sweep completed` line counts them as
`analysesReopened`. Each such review spends one of its three reopens (ADR 0058,
2026-10-13 item 7); `analysesLeftUnanalysed` above zero on that line after
repeated stops means some have none left.

**Reviews with no reopens left (2026-10-25).** A cause outside the reviews that
lasts longer than three reopens leaves them settled without an analysis for
good. On 2026-10-24 the OpenAI account ran out of credit for about 40 hours and
ten text reviews ended this way. Look in the worker log first: since this
release a provider 429 or 5xx is named. `quota_exhausted` with no budget
refusal means the provider account is out of credit (top it up in the
provider's billing settings). `provider_rate_limited` is a rate limit, and
`provider_unavailable` an outage. Every other provider status (a 400 or a 401
after a key or parameter change) still reads `operation_ambiguous`. Once the cause is fixed,
`pnpm ops ai-reopen-analyses <propertyId|all> --operator <id>` lists the
reviews, with the code and time of each one's last failure.
`--reason <text> --apply` gives each a fresh analysis sequence and a backfill
event, through the same path the sweep takes. It works one Property at a time
under its fence, 50 reviews per transaction, at most `--batch-size` reviews
(default 200, maximum 1,000) per run. It refuses while an AI execution stop is
in force, because a reopened review could only wait in the backlog. A Property
that fails is printed, the rest go on, and the command exits 1: run it again. A
second apply finds nothing. Copy the printed record (operator, reason,
correlation id, reviews) into the incident record. The reopened reviews are
analysed within a few minutes, and `analysesLeftUnanalysed` drops by as many.

**A number nobody holds (2026-10-22).** The other cause is not slow work at
all. Until 2026-10-22 the Review writer took a Property's next analysis sequence
before it knew whether the observation would be applied. A replayed observation
(a retried snapshot page) or one older than what is stored is not applied: no
Review took the number and no event named it, yet the head had moved, so
coverage owed a settlement that nothing could ever make. The alert fired for
good, the Property's insights stayed provisional and `generate-property-trend`
retried without end. The writer now records such a number in
`review_ai_analysis_released_sequences` in the same transaction, and every
reader of coverage (this alert, the aggregate read, the trend scheduler, the
trend report) subtracts the released numbers that fall between the start
sequence and the head and that no settlement already counts.

Tell a leak from slow work by what holds each unsettled number. For the current
source and Review Analysis epochs, take every sequence after
`merchant_ai_enablement.analysis_start_sequence` up to
`review_ai_analysis_heads.head_sequence` that has no row in
`ai_property_aggregate_settlements`. Slow work has a holder: a `reviews` row of
the current source epoch whose `analysis_sequence` is that number, or an
`outbox_events` row of the Property whose payload `analysisSequence` is that
number (the event waits for its consumer: follow the diagnostics above). A
number with neither holder, that is not in the released ledger either, is a leak.
Do not insert settlement rows for it.

`pnpm ops ai release-orphan-sequences <propertyId> --operator <id>` does that
classification for you. The dry run prints the Property's start and head, how
the range divides (`settled`, `held` by a Review, `announced` by an event,
`released` already, `orphaned`) and the orphan sequences. `--reason <text>
--apply` records the orphans as released with the reason `operator_repair`;
copy the printed record (operator, reason, correlation id, sequences) into the
incident record. It refuses while the head moved in the last 15 minutes, so work
that was given a number can announce it first, and says when to run it again;
it refuses a Property with no enabled Review Analysis authorization at its
current source epoch; a second run finds nothing. The alert clears at its next
five-minute evaluation, and the Property's trend schedule is attempted at the
next scheduler pass. An announced event whose outbox row was already pruned
(30 days after publication) reads as a leak too: if the dry run lists an old
number, check the consumer receipts before applying.

**Containment/Recovery:** Restore the failing ordinary path first. Let an
in-horizon analysis retry or the execution reaper terminal-settle through the
normal consumer. If the durable consumer receipt is missing, let the bounded
published-event redelivery path re-enqueue it; do not insert settlement rows or
advance heads manually. For an inconsistent empty enrollment, supersede and
recreate it through the governed merchant-AI enrollment path after correcting
the eligibility/watermark defect.

**Data written before the head counted every sequence (2026-10-14).** Two
read-only statements size what the code does not repair; run them after the
release that counts every settled sequence is deployed.

1. A head short of the ledger. A head that missed a stale sequence keeps
   `awaitingAnalysisCount` above zero, so every Property Trend schedule of that
   Property keeps retrying. The next settlement of the Property corrects it. A
   Property with no further review activity waits for one, and this statement
   finds it. Only a head that is the only head of its epoch is listed: a rolled
   profile generation counts its own settlements, and recounting it from the
   ledger would report it complete over an empty window.

   ```sql
   SELECT head.organization_id, head.property_id, head.review_analysis_epoch,
          head.settled_analysis_count AS head_counted, ledger.ledger_rows
   FROM ai_property_aggregate_heads AS head
   JOIN (
     SELECT organization_id, property_id, source_epoch, review_analysis_epoch,
            count(*) AS ledger_rows
     FROM ai_property_aggregate_settlements
     GROUP BY organization_id, property_id, source_epoch, review_analysis_epoch
   ) AS ledger
     ON ledger.organization_id = head.organization_id
    AND ledger.property_id = head.property_id
    AND ledger.source_epoch = head.source_epoch
    AND ledger.review_analysis_epoch = head.review_analysis_epoch
   WHERE head.settled_analysis_count <> ledger.ledger_rows
     AND NOT EXISTS (
       SELECT 1 FROM ai_property_aggregate_heads AS sibling
       WHERE sibling.organization_id = head.organization_id
         AND sibling.property_id = head.property_id
         AND sibling.source_epoch = head.source_epoch
         AND sibling.review_analysis_epoch = head.review_analysis_epoch
         AND sibling.property_profile_version <> head.property_profile_version);
   ```

   A listed head with `head_counted` above `ledger_rows` is a different defect
   (insights reads of that Property throw "coverage is invalid"): do not run the
   recount, escalate. When every listed head is short, recount them. It bumps no
   revision, so a Trend schedule already made stays valid, and it is safe while
   the worker runs, for a settlement racing it recounts the head itself:

   ```sql
   UPDATE ai_property_aggregate_heads AS head
   SET settled_analysis_count = ledger.ledger_rows, updated_at = now()
   FROM (
     SELECT organization_id, property_id, source_epoch, review_analysis_epoch,
            count(*) AS ledger_rows
     FROM ai_property_aggregate_settlements
     GROUP BY organization_id, property_id, source_epoch, review_analysis_epoch
   ) AS ledger
   WHERE ledger.organization_id = head.organization_id
     AND ledger.property_id = head.property_id
     AND ledger.source_epoch = head.source_epoch
     AND ledger.review_analysis_epoch = head.review_analysis_epoch
     AND head.settled_analysis_count < ledger.ledger_rows
     AND NOT EXISTS (
       SELECT 1 FROM ai_property_aggregate_heads AS sibling
       WHERE sibling.organization_id = head.organization_id
         AND sibling.property_id = head.property_id
         AND sibling.source_epoch = head.source_epoch
         AND sibling.review_analysis_epoch = head.review_analysis_epoch
         AND sibling.property_profile_version <> head.property_profile_version);
   ```

   Run the first statement again: it returns no rows.

2. A deleted review still in its days. A review whose newest settled sequence
   had no analysis (deleted at Google, its text removed, expired, abandoned)
   was not taken off its day before the withdrawal existed. This statement lists
   the contributions still standing for such a review. Nothing repairs them: the
   Trend reconcile guard heals within its 60-day window, and the Guest voice
   counts keep the review's rating and aspects as de-identified insight data
   under the 24-month retention of `docs/BETA.md` §2. The count sizes it for the
   decision whether a one-shot withdrawal is wanted.

   ```sql
   SELECT contribution.organization_id, contribution.property_id, contribution.review_id,
          contribution.analysis_sequence AS contributed_sequence,
          latest.analysis_sequence AS latest_settled_sequence
   FROM ai_property_aggregate_contributions AS contribution
   JOIN LATERAL (
     SELECT max(settlement.analysis_sequence) AS analysis_sequence
     FROM ai_property_aggregate_settlements AS settlement
     WHERE settlement.organization_id = contribution.organization_id
       AND settlement.property_id = contribution.property_id
       AND settlement.review_id = contribution.review_id
       AND settlement.source_epoch = contribution.source_epoch
       AND settlement.review_analysis_epoch = contribution.review_analysis_epoch
   ) AS latest ON true
   WHERE contribution.status = 'ready'
     AND latest.analysis_sequence > contribution.analysis_sequence
     AND contribution.property_profile_version = (
       SELECT max(head.property_profile_version)
       FROM ai_property_aggregate_heads AS head
       WHERE head.organization_id = contribution.organization_id
         AND head.property_id = contribution.property_id
         AND head.source_epoch = contribution.source_epoch
         AND head.review_analysis_epoch = contribution.review_analysis_epoch)
     AND NOT EXISTS (
       SELECT 1 FROM ai_property_aggregate_contributions AS newer
       WHERE newer.organization_id = contribution.organization_id
         AND newer.property_id = contribution.property_id
         AND newer.review_id = contribution.review_id
         AND newer.source_epoch = contribution.source_epoch
         AND newer.review_analysis_epoch = contribution.review_analysis_epoch
         AND newer.property_profile_version = contribution.property_profile_version
         AND newer.analysis_sequence > contribution.analysis_sequence);
   ```

Record the counts and the Organization and Property identifiers; never review
content.

**A consent recorded while an older worker ran (2026-10-17).** The release
that serves `merchant-ai-notice-2026-10-17.v1` moves web before the worker
(`pnpm ops deploy-ci-images`). A worker built before it admits only
`merchant-ai-notice-2026-09-15.v1`, so until it stops, about 30 seconds after
the new worker is healthy, it settles every review of a Property consented
under the new notice as not analysable (`policy_disabled`), the
first-enablement replay included. Nothing reopens that code, and the
coverage counts still add up, so neither alert fires. While that deploy runs,
nobody enables AI or finishes an import's AI step. Note when the command
finishes. Then list every Review Analysis consent recorded under the new notice
up to one minute after that moment whose epoch is still the head's, with how
many of the Property's reviews were settled at that epoch by then:

```sql
WITH cutoff AS (
  SELECT TIMESTAMPTZ '<when the deploy command finished>' + INTERVAL '1 minute' AS at
)
SELECT evidence.organization_id, evidence.property_id, evidence.occurred_at,
       head.review_analysis_epoch,
       (SELECT count(*)
        FROM ai_property_aggregate_settlements AS settlement
        WHERE settlement.organization_id = head.organization_id
          AND settlement.property_id = head.property_id
          AND settlement.source_epoch = head.authorized_source_epoch
          AND settlement.review_analysis_epoch = head.review_analysis_epoch
          AND settlement.settled_at < cutoff.at) AS settled_in_window
FROM merchant_ai_consent_evidence AS evidence
CROSS JOIN cutoff
JOIN merchant_ai_enablement AS head
  ON head.organization_id = evidence.organization_id
 AND head.property_id = evidence.property_id
 AND head.review_analysis_epoch = evidence.review_analysis_epoch
WHERE evidence.notice_version = 'merchant-ai-notice-2026-10-17.v1'
  AND evidence.state = 'enabled'
  AND 'review_analysis' = ANY(evidence.capabilities)
  AND evidence.occurred_at < cutoff.at
ORDER BY evidence.occurred_at;
```

No rows, or only rows with `settled_in_window` at zero, is the expected answer
and nothing is left to do. A row above zero is a Property whose history the old
worker settled: its AccountAdmin turns AI off for it and enables it again in its
AI settings, which advances every epoch, and the first-enablement replay
analyses the history on the new worker. Do not insert or rewrite settlements.
Record the identifiers, epochs and counts only.

**Verification:** For every enabled Property, the current-epoch settlement
count exactly equals `head_sequence - analysis_start_sequence`, the count
continues to advance when new review-analysis events arrive, and no actionable
zero-snapshot enrollment has an eligible-review count above zero. Confirm both
alerts clear on the next health-check evaluation.

**Escalation/Evidence:** Escalate to Bozhidar Denev if progress remains stopped
after ordinary retry/reaper execution or any enrollment invariant is violated.
Retain only release/cell, Organization/Property/enrollment/event identifiers,
epochs, sequences, counts, timestamps, coded outcomes, and the recovery
decision—never review or reviewer content.

---

## 23. Operations Snapshot Degraded (Alerts Blind)

**Alert:** `observability.snapshot-degraded` (P1) — at least one operations-snapshot section that an alert reads failed, outlasted its budget (5 seconds for a section, half that for one database signal), or was never reached, on two consecutive evaluations (the first is only held as pending, so one slow read — or a signal that times out on alternate runs — does not page). The detail names the degraded `health.<signal>` markers and every alert they blind.

**What it means:** a degraded signal reports a zero fallback, and zeros evaluate quiet. The alerts that read it are therefore UNKNOWN, not healthy, so they hold their last state instead of clearing: one that was already firing stays firing (no clear, no second page), and one that was quiet cannot fire until the signal reads again. This alert is the page for that blindness — without it, a database or Queue Redis incident would silence the very alerts meant to report it. Sections that fire their own alert on the fallback (`workers.heartbeat`, `jobs`, `guest.observationLoss`) and `queues`, which no alert reads, never raise it. Neither does `runtime`: `db.pool-exhaustion` reads only its in-process pool gauge, which survives a stalled migration read; the gauge goes null (and that alert quiet) only if an in-process runtime read itself throws, which `runtime` in `degraded` then shows.

**First three things to check:**

1. `degraded` on `/api/health/metrics`. `health.quarantine` alone points at Queue Redis (§7). The PostgreSQL-backed signals are read one after another — `health.outbox`, `health.reviews`, `health.sync`, `health.replyPublication`, `health.notificationEmail`, then `health.notificationGap` and `health.notificationDeliveryLag` together — each capped at half the section budget, so a single slow read degrades alone and a lone marker means that read itself failed or outlasted its cap (its scan has outgrown the budget, or its tables are locked). Markers on every signal from one point on mean the section budget ran out; step 2 tells the cause from the collateral.
2. Worker logs for `[operations-snapshot] health signals degraded` — each degraded signal with its outcome and the section time elapsed: `failed` (the read rejected; `Span health.check.<signal> failed` carries its content-free error name — for `health.notificationGap` and `health.notificationDeliveryLag`, `NotificationHealthReadTimeoutError` with code `statement_timeout` means PostgreSQL cancelled the read at its 2-second statement timeout, which reads like `timed_out`), `timed_out` (it outlasted its own cap), or `not_started` (the section budget was spent before its turn — collateral, not a cause). The earliest `failed` or `timed_out` signal is the cause. If the first marked signal started with little budget left, or every marker is `not_started`, the reads before it succeeded but slowly: the database as a whole is slow (§8, and step 3). `[health-check] alerts held` lists the held alert names.
3. `db.pool.waiting` / `db.pool-exhaustion`: a saturated pool starves each database signal in turn, and the pool gauge survives a stalled `runtime` read on purpose.

**Remediate:** restore the failing dependency first (§7 Redis, §8 database). For a scan that keeps outlasting the budget, bound or index that read; never widen the budget to hide it, and never clear the held alerts' state to quiet the page.

**Verification:** `degraded` carries no `health.*` marker, this alert clears on the next evaluation, and the held alerts evaluate on real readings again — a breach they were holding stays firing without a second page, a recovered one clears.

**Escalation:** Bozhidar Denev.

---

## 24. Notification Release Steps

**When:** deploying the notification audit fixes (#597, #599), the 2026-09-28
review (ADR 0046, amended 2026-09-28) and the follow-up decisions, or any later
change to notification routing, email or reminders.

**Migrations first.** They run in web's predeploy, before the new web container
serves and before the worker moves. The 2026-09-28 release adds `0035` (the Organization
fallback branch of `notifications_mandatory_scope_check`), `0036` (the unread
coalescing index narrowed to unsettled rows), `0037` (`replies.submitted_by`,
nullable, no backfill) and `0038` (`notification_digest_batches.provider_request`,
nullable). All are additive or narrowing; every row the old index admitted
satisfies the new one.

**Order: web first, then the worker.** `pnpm ops deploy-ci-images` rolls web,
then the worker, then provider Redis, each settling healthy at its digest before
the next moves. A service counts as already deployed only when its latest
Railway deployment runs that digest, not when its configured source names it:
Railway can store a new source and start no deployment (the 2026-10-21 outage),
and the command then redeploys from the source instead of printing `already
healthy`. Provider Redis moves only when something it is built from
changed (`Dockerfile.google-provider-redis`, `services/google-provider-redis/`):
it keeps nothing across a restart (ADR 0050), so each redeploy drops the page
cursors of the Google review syncs in flight and the OAuth state of any Google
connect in progress. It stays on its release when it is healthy, that release
is an ancestor of the target, those files are identical, and the image it runs
is the one CI built for its `RELEASE_SHA`; the command says `kept at <sha>`.
Anything it cannot prove moves it as before. It takes `--sha` and `--apply` and has no option for another
order, and it is the only supported deploy path (`docs/BETA.md` §7). So a release
whose new facts an older worker refuses has a window between the two, and the
command cannot roll the worker first to avoid it. In the 2026-09-28 release a
reauthorization notice carries a cause an older worker's schema refuses.
Refusing it is terminal for that dispatch, and the fact only returns through the
published-event redelivery sweep, so a reconnect notice raised while web is new
and the worker is old can be up to two hours late. An older worker strips
`removedBy` from `identity.member.removed` rather than refusing it, so a member
who leaves during the roll is told their access was removed.

**Provider webhook.** Create or confirm the Resend endpoint
`https://<BETTER_AUTH_URL host>/api/webhooks/resend/events`, subscribed to
`email.delivered`, `email.delivery_delayed`, `email.bounced`,
`email.complained`, `email.failed`, `email.suppressed`, `suppression.added`
and `suppression.removed`. Set its `whsec_` signing secret as
`RESEND_WEBHOOK_SECRET` on the web service (the worker does not need it),
re-enable the endpoint if Svix disabled it, and confirm that one delivered
event moves a queue row. Without the suppression events a provider-side
suppression never reaches the durable suppression store, and the address keeps
being attempted until the provider refuses it. Until the secret is set, web
logs `Notification email is misconfigured on web` at boot and
`notification.email-provider-feedback-missing` fires on the first unresolved
message (§15). Check the subscription after any webhook change.

**Suppression key.** Durable suppression entries are keyed with
`NOTIFICATION_EMAIL_SUPPRESSION_KEY` once it is set (`openssl rand -hex 32`),
on BOTH web (the webhook writes suppressions) and worker (sends check them).
Until then they are keyed with `BETTER_AUTH_SECRET`, so rotating that secret
after an account incident empties the list. Set the dedicated key BEFORE any
`BETTER_AUTH_SECRET` rotation: `BETTER_AUTH_SECRET` is then honoured as a
retired key, and each entry moves to the new key the first time its address is
looked up, so an entry never looked up again stays under the old secret until
it is rotated away. Rotating the dedicated key itself always empties our list;
the provider's own list is the backstop, so rotate deliberately and re-verify
a known suppressed address afterwards.

**Unsubscribe keyring.** Every key in `NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS`
needs its `vN:` prefix. With `notification.send_email` enabled the worker
refuses to boot on a keyring it cannot parse (§15).

**Alert channel.** Production has no `ALERT_WEBHOOK_URL`, so alerts reach an
operator only through Sentry (§16). Configure the Sentry alert rule, and set
`ALERT_WEBHOOK_URL` on web and worker when a channel exists.

**Reminder rows recorded before the overdue-on-arrival rule.** Pending reminder
rows that were already due when they were written are not cancelled
retroactively. Count them before and after a deploy:

```sql
SELECT count(*) FROM inbox_response_target_reminders
WHERE delivered_at IS NULL AND cancelled_at IS NULL AND scheduled_for <= created_at;
```

A non-zero count sends one `target passed` per row at the next release pass, and
no `halfway`. Left alone it drains; it never grows under the current rule.

**Reminders reading Google before they go out (2026-10-21).** The
`release-response-target-reminders` job (every five minutes, 120 second timeout)
reads a Google review once before it releases a reminder for it
(`docs/operations/inbox-response-targets.md`, "The Google check before a
reminder"). Its log line `Response Target reminder release completed` carries
counts only: `released`, `checked` (Google reads), `heldLocal` and
`heldAfterRead` (reminders withheld because a reply is already on Google),
`deferred` (left pending for the next tick), `unavailable` (reads that failed),
`skippedNoProvider` (no Google provider in this environment) and `failed`
(slots whose own work threw; they stay pending, and go out once 15 minutes late). Healthy: `heldLocal` or
`heldAfterRead` above zero when managers answer on Google, `unavailable` and
`deferred` near zero.

_Reminders arriving 15 to 20 minutes late._ That is the cap on a Google that
cannot be read. Read `unavailable` and `deferred` on the job log and look for the
cause: Google failing or rate limited (§3; the reads share the `google-reviews-v1`
quota with sync), the `property.connect_gbp` kill switch or a suspended
Organization (the read is refused and the reminder released after the wait), a
connection that needs reauthorizing (released at once), or a worker with no Google
provider (`skippedNoProvider`, released at once). A reminder is never lost: after
15 minutes from its scheduled time it goes out whatever Google says.

_A reminder that never arrives for an answered review_ is the intended result of a
hold. A held slot stays pending and the close the reply raised cancels it; if the
item is still open long after the reply, the close is stuck (§15, the
`inbox.on-reply-observed` consumer), not the reminder.

**The first health check after the 2026-09-28 deploy may page.**
`notification.email.delivery_enabled` now reads `1` under
`BETA_ALLOWLIST_ORGS=*`, so `notification.email-stalled` judges every overdue
row, including a backlog nothing ever touched. That page is intended: read the
overdue rows (§15) rather than silencing it.

**Verification after the deploy:** change a member's role and confirm both the
bell row and its email; archive a Property and confirm its reminders stop and
its waiting notices show "Done"; revoke access in Google and confirm the
reconnect notice and the Settings prompt, then reconnect and confirm the notice
settles; edit an answered review on Google and confirm the urgent "reopened"
notice; in the Railway Log Explorer, `@level:error` returns error lines.
After the 2026-10-21 reminder pre-check ships, answer a review on Google, wait for
the next sync and confirm the next reminder for it is held
(`heldLocal` or `heldAfterRead` on the job log) and the item closes.

**Escalation:** Bozhidar Denev.

---

## 25. Connect Google or AI Dark After a Database Reset

**Trigger/Symptoms:** After a database reset, restore or new cell, "Connect
Google" answers "Google could not be connected. Try again." (the token exchange
refuses with `capability_killed`), imports and reply publication refuse, or no
AI analysis, reply draft or trend is produced.
**Impact:** P1 — every tenant loses Google connection and AI at once.
**Diagnostics:** The seed leaves every Google content capability denied and every
AI capability `killed`/`draining`; web's deploy step lifts the ones declared in
`GOOGLE_CONTENT_CAPABILITIES_ALLOWED` / `AI_CAPABILITIES_ENABLED` (ADR 0032,
amended 2026-09-29). Read web's latest deploy log for the `[declared-posture]`
line, right after `[migrate-deploy] OK — deploy migration state reached`:

- `nothing declared` — the variables are unset on web.
- `[declared-posture] refused before migrating: …` (and a failed deploy) — an
  unknown capability name, or `AI_CAPABILITIES_ENABLED` without a 40-character
  `RELEASE_SHA`; the message names the fix, and nothing was migrated.
- `kept_operator_denied=[…]` / `kept_operator_killed=[…]` — an operator stopped
  that capability (a Google row counts as seed only with no or a `migration:`
  operator AND a `*_default_deny` reason); the declaration never overrides it.
- `skipped_plane_stopped=[…]` — the global or provider AI plane is not
  `enabled`/`accepting`, so no capability can be activated under it.
- `skipped_head_absent=[…]` — an AI control head the seed inserts is missing:
  a seed defect, not a stop.
- No line at all — no deploy has run since the reset, or the running image
  predates the declared posture.

**Recovery:** Set `GOOGLE_CONTENT_CAPABILITIES_ALLOWED=*` and
`AI_CAPABILITIES_ENABLED=*` (or the intended comma lists) on web, staged with
`--skip-deploys`, then redeploy web: the step is idempotent and only lifts
untouched seed defaults. A capability an operator stopped is re-opened only by
an operator. For AI, from inside Railway's network:
`pnpm ops ai-control restore capability <name> <profile> <release-sha> --operator <id> --reason <text> --ticket <ref> --apply --yes ops:ai-control`.
For Google, in one transaction — what `allowCapability` does: take
`pg_advisory_xact_lock(hashtextextended('google-content-emergency-generation', 0))`,
set the row `denied = false` with `denied_at`, `drained_at` and
`cleanup_drained_at` NULL, your operator id, a reason and `updated_at = now()`,
then move `emergency_kill_version` on EVERY row to one past the current maximum.
A row edited without the shared generation leaves the other capabilities
failing closed. A hand kill likewise records your operator id and a reason that
is not `*_default_deny`, or the next deploy reads it as the seed default.
**Verification:** The deploy log line reads `lifted=[…]` / `enabled=[…]` for every
declared capability (or `already_…` on a later deploy); Connect Google reaches
Google's consent screen and returns; a new review gets an analysis.
**Escalation:** Bozhidar Denev.

---

## 26. Portal Address Keyring (`PORTAL_ADDRESS_ENCRYPTION_KEYS`)

**What it is.** The optional keyring that seals each Portal code's public address
so a manager can download the code again (ADR 0064). Without it nothing breaks:
the address is shown once when a code is made, as before, and "Download again" is
not offered. Web and worker read the same value, so set it on both.

**Format.** `<version>:<64 lowercase hex>[,<version>:<64 lowercase hex>]`, at most
four entries, versions 1 to 9999, no repeated version. The first entry seals,
every entry opens. Generate one entry with `echo "1:$(openssl rand -hex 32)"`.
A malformed value stops web and worker at boot with the field named and the value
never printed; production also refuses a placeholder-shaped key (the same guard
as `ENCRYPTION_KEY`).

**Turning it on.** Set the variable on web and worker, staged with
`--skip-deploys`, then redeploy both. Codes made before that stay unsealed and
keep the shown-once behaviour until they are replaced; a new or replaced code is
sealed. Nothing needs a backfill, and there is no way to seal an existing code
because the address is not stored anywhere else.

**Rotating the key.** Put the new key first and keep the old one:
`2:<new>,1:<old>`. New and replaced codes seal with version 2; codes sealed with
version 1 keep opening. Retire version 1 only when no live code was sealed with it:

```sql
SELECT address_encryption_key_version AS key_version, count(*)
FROM portal_tokens
WHERE encrypted_raw_token IS NOT NULL
GROUP BY 1 ORDER BY 1;
```

A live code whose key was retired simply stops offering "Download again" (the
Share tab reads this from the keyring, so there is no failing button); replacing
the code makes a fresh sealed copy. A retired key never breaks public
resolution, which reads the hash only.

**Suspected compromise.** The keyring plus a database read exposes the live
addresses of every sealed Portal. Replace the codes for security (Share, Replace
code, at once), which stops the old address and clears its sealed copy in the
same statement, then rotate the key as above. Printed codes must be reprinted;
that is the cost of the compromise, not of the rotation.

**Losing the keyring.** Existing sealed codes can no longer be downloaded again,
and the page stops offering it for them. The codes themselves keep working.
Replace a code to get a new sealed copy under the current keyring.

**No rollback below this release.** Recovery is forward-only (§28): an image
from before the sealed-address release (ADR 0064) is older than the applied
migrations, so web's predeploy refuses it. The refusal also protects the codes.
Migration 0047 added the CHECK `portal_tokens_sealed_address_active_only` and
migrations only go forward, so such an image, which replaces, stops and deletes
codes without clearing the sealed copy, would have those statements refused by
the database for every sealed code: "Stop all codes" for a leaked code would fail
with a 500. To take "Download again" away without an older image, unset
`PORTAL_ADDRESS_ENCRYPTION_KEYS` on web and worker, staged with `--skip-deploys`,
and redeploy both: nothing seals a new code, sealed codes stop offering it (as
under "Losing the keyring"), and every code keeps working. Anything else wrong
with the feature is repaired by a fix deployed forward.

**Print codes and the print host (ADR 0069).** A short printed address,
`https://ap.up.railway.app/p/<print code>`, replaces the long address on new prints.
Migration 0070, the codec, the print host redirect and the minting are in. Every new
or replaced code stores its two print code hashes, and a "Download again" fills the
hashes of a code made before, whatever `PORTAL_PRINT_CODES_ENABLED` says; the switch
only decides whether a manager is shown the short address. The redirect does nothing
until `PORTAL_PRINT_ORIGIN` is set.

- **`PORTAL_PRINT_CODES_ENABLED`.** `true` or `false`, default `false`, any other
  spelling stops web and worker at boot with the field named. Off, the print kit, the QR
  downloads and "Copy NFC address" carry the long address exactly as before, and the
  Share tab's "Public address" and "Open page" are the long address in both states.
  On, they carry `HTTPS://AP.UP.RAILWAY.APP/p/<code>` (QR) and
  `https://ap.up.railway.app/p/<code>` (NFC). **Flip it once, after a phone test has
  passed the uppercase QR on current and old cameras (and an NTAG213 has opened on
  an iPhone and a Samsung):** a card printed afterwards carries the short address for
  life, and the name it carries is Railway's, not ours (ADR 0069, known lock-in). Set
  it on web with `--skip-deploys`, then redeploy web; the worker makes no code and prints
  nothing, so it does nothing with it.
  Flipping it back stops new prints from carrying the short address and nothing
  else: a printed short code keeps opening, and the redirect must stay. Before
  flipping it, check that the hashes are filling (the second query below) and that
  `PrintCodeDeriveMismatch` has not fired.
- **Progress of the hashes** (read-only, no secrets). Before the switch: how many
  live codes could get print codes (a code with no sealed copy cannot print at all),
  and afterwards how many still lack a hash:

  ```sql
  SELECT status, (encrypted_raw_token IS NOT NULL) AS sealed, count(*)
  FROM portal_tokens GROUP BY 1, 2 ORDER BY 1, 2;

  SELECT count(*) FILTER (WHERE qr_print_code_hash IS NULL OR nfc_print_code_hash IS NULL)
           AS without_print_codes,
         count(*) AS total
  FROM portal_tokens WHERE status = 'active';
  ```

  A live code gets its hashes the first time its address is revealed (a print, a QR
  download, "Copy NFC address" or "Download again"); there is no backfill command.
  A new or replaced code has them from the start.

- **The print host stays.** `ap.up.railway.app` is a second Railway domain on the web
  service and redirects `/p/<code>` to the app origin (`PORTAL_PRINT_ORIGIN`, set on
  web and worker). Never release, rename or detach a Railway-provided name once
  anything is printed with it: another Railway account could claim it and receive
  every scan. A print code stops opening, and a printed card with it, the moment the
  host goes away.
- **Setting `PORTAL_PRINT_ORIGIN`.** Non-secret: `https://ap.up.railway.app`, an
  origin only (no path, query or credentials), https in production, host at most 25
  characters (what keeps the print QR a version 3 symbol). A wrong value stops web
  and worker at boot with the field named. Attach the domain to the web service
  first, then set the variable on web and worker, staged with `--skip-deploys`, then
  redeploy both. `BETTER_AUTH_URL` stays the app origin.
- **What the print host answers.** `GET` and `HEAD` for `/p/<anything>` on
  `ap.up.railway.app` are a 302 to the same path and query on the `BETTER_AUTH_URL`
  origin (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`); every other
  path or method is a 404 with no body, so a manager who used that host as the app
  signs in on the app host instead. Every other host is untouched, and nothing logs a
  path or a code. Files Nitro serves from its public directory (`/assets`,
  `robots.txt`, `favicon.ico`) still answer there: public build files, the same ones
  the app host serves. The host is read from the `Host` the server received, and
  from `X-Forwarded-Host` where the proxy is trusted (`TRUSTED_PROXY_MODE`).
- **Checking it** (read-only, after the deploy): `curl -sI https://ap.up.railway.app/p/unknown-code`
  answers 302 with `location: <app origin>/p/unknown-code`, and
  `curl -s -o /dev/null -w '%{http_code}\n' https://ap.up.railway.app/` answers 404.
  Following the redirect shows the app's "unavailable" page.
  `pnpm check:security-headers` proves the same against the built artifact.
- **If the app moves to the print host.** Set `BETTER_AUTH_URL` to
  `https://ap.up.railway.app`. The redirect turns itself off when the print host
  equals the app host, whether `PORTAL_PRINT_ORIGIN` is unset or the same value, and
  print codes then resolve on `/p/$token` directly. If the app moves anywhere else,
  `ap.up.railway.app` stays attached and keeps redirecting to the new app origin.
- **Last resort.** Unsetting `PORTAL_PRINT_ORIGIN` and redeploying web makes
  `ap.up.railway.app` serve the whole app again: a scan of a printed code then opens
  the guest page, but its actions fail the exact `Origin` check. Fix a fault
  forward instead (ADR 0069).
- **A print kit needs the keyring, at every size.** The address comes through the
  audited reveal of the sealed code, so a code with no sealed copy cannot be printed
  (Share offers "Replace"). With no keyring set nothing can be printed.
- **The secret binds print codes.** They are derived from `PORTAL_TOKEN_HASH_SECRET`,
  so changing it stops every printed short code, as it already stops every long one.
- **Suspected compromise.** A security replacement stops the print codes with the
  long address at once (no grace). A planned replacement keeps the old print codes
  live through its grace.
- **In Sentry.** `PrintCodeDeriveMismatch` (a reveal found a stored hash that
  differs from the derived one, or could not derive at all, and fell back to the
  long address), `PrintCodeFillFailed` (a missing hash could not be stored) and
  `PrintCodeCollision` (a unique index refused a hash, at issue, replace or fill)
  each need a look. None carries a code or a hash; the log line carries only
  `portal.print_code.derive_mismatch`, `portal.print_code.fill_failed` or
  `portal.print_code.collision`. A collision at issue or replace reaches the manager
  as "The new code could not be saved. Try again."; the odds are about 2^-59.
- **Server logs show the shape, never the address.** The guest page read logs
  `addressShape` (`long` or `short`), and a print kit render logs `addressShape` and
  `symbolVersion` (3 for the short address on the print host). Use them to see the
  short address in use after the switch.

**Verification.** Make a code on a test Portal, reload, and confirm "Download
again" is offered; download it, then read the Portal's History and confirm a
"downloaded" entry with the person's name. `SELECT count(*) FROM
portal_address_downloads WHERE organization_id = '<org>'` rises by one per
download.

**Escalation:** Bozhidar Denev.

---

## 27. Taking Down a Portal Image

**Trigger/Symptoms:** An uploaded Portal image (a Property photograph, a logo or
a link tile picture) must not be shown: a rights complaint, an upload that should
never have been public, or content that breaches policy.

**Impact:** Until it is taken down the image is served to every guest of every
published Portal that names it.

**Prerequisites:** The asset id (a UUID; it is in the image URL
`/api/public/portal-media/<id>`). Never put the image, a signed URL or a person's
name in the incident record.

**Containment:** An Account Admin of the Organization takes the image down with the
`takeDownPortalMedia` server function (gated on `portal.write`, so it works with
uploads off). There is no button for it yet; when the manager controls ship, they
call the same function. If no Account Admin session is to hand, the operator path
is one statement, after which the hourly sweep removes the object:

```sql
UPDATE portal_media_assets
SET status = 'taken_down', taken_down_at = now()
WHERE id = '<asset id>' AND status = 'active';
```

From that moment the image route answers 404 for it. A browser or shared cache that
already holds the image keeps it for at most five minutes.

**Recovery:** None by design: the object is removed and the row stays, because
published snapshots name assets by id and must keep verifying; they show their
no-photo look. The manager uploads a replacement.

**Verification:** `GET /api/public/portal-media/<id>` returns 404;
`SELECT object_deleted_at FROM portal_media_assets WHERE id = '<asset id>'` is set
within the hour (the `portal-media-sweep` job); if it stays empty, read the
worker log for `portal_media_sweep_object_failed` and fix the bucket access.

**Escalation/Evidence:** Bozhidar Denev. Record the asset id, who took it down and
when (`taken_down_at`), and the time the object was confirmed removed. The table
keeps the time but not the person. When the function did it, the actor is in the
web log line `Portal media taken down` (`actorUserId`), and logs are kept for less
time than the row: copy it into the incident record at once. The SQL path leaves
no actor at all, so the operator who ran it must be named in the incident record.

---

## 28. Bad Release (Recovery Is Forward-Only)

**The rule.** Recovery is forward-only (owner decision 2026-10-12; ADR 0038,
amended; `docs/BETA.md` §7). A bad release is contained with the stop controls
and repaired by deploying a fix forward. An earlier image is never a containment
or recovery step, and once a migration has been applied since an image was built
that image is refused on purpose: web's predeploy runner
(`scripts/migrate-deploy.ts`) and the readiness probe (`/api/health/ready`) both
require the applied migration count to equal the journal the image carries.
Older code is not tested against a newer schema; §26 and ADR 0061, 0064 and 0066
each record a release below which an older image would refuse or corrupt real
work. Where no migration landed in between, the gate has nothing to compare and
does not fire; the rule is the same.

The gate is web's alone. Nothing checks a worker or provider Redis image against
the applied migrations: neither service runs the predeploy runner or the journal
check, so an older worker starts and runs against the newer schema (ADR 0066
records a month it would close on the wrong target, which cannot be corrected in
place). For those two services the rule is procedure, not mechanism.
`pnpm ops deploy-ci-images` is the only supported way to change the image a
service runs: it moves web first and stops when web is refused, so the worker
and Redis never follow a refused image. Railway's own Rollback, and its Redeploy
of an earlier deployment, are covered by the rule for every service: do not use
them.

**Trigger/Symptoms:** A release that reached production misbehaves. Or a deploy
fails in web's predeploy with `This image is older than the database`. Or a web
container answers 503 with `"migrations":false` on `/api/health/ready` and logs
`[health] this image is older than the database`.

**Impact:** Whatever the release breaks until the stop controls take effect;
after that, the stopped capabilities stay unavailable until the fix is deployed.
A refused deploy replaces no container: the previous web container keeps
running, and `deploy-ci-images` moves the worker and provider Redis only after
web settles healthy. It is still not free of effects (see Containment).

**Prerequisites:** Name both operating roles. Record the release SHA that
misbehaves, the SHA that ran before it, and the time and symptom. No tenant
content.

**Diagnostics:** In web's deploy log read the `[migrate-deploy] migration state`
line. `journalApplied` greater than `journalExpected` means the database has
applied migrations the image's journal does not hold, and the failure reads
`This image is older than the database: N migrations are applied and this
image's journal holds M`. An image built before this message existed prints
`Migration state incomplete … the rerun converges` for the same state; it does
not converge. `journalApplied` lower than `journalExpected`, or a failing
migration, is §8.

Two different images are refused this way, and the counts cannot tell them
apart:

- **An earlier release.** It was built before a migration that has since been
  applied.
- **A fix whose journal lost a migration.** It was built from current `main`,
  and a commit on the way there deleted a migration file and its
  `drizzle/meta/_journal.json` entry. A plain revert of a commit that added a
  migration does exactly that. CI does not catch it: CI migrates an empty
  database from the same checkout, so a shortened journal still matches.
  `git diff --diff-filter=D --name-only <last deployed sha> <refused sha> -- drizzle/`
  names the deleted file.

The readiness line is also logged by the outgoing container while a newer
release deploys, because the new release's migrations land before that container
is replaced. There it is expected and ends when the new release activates.

**Half-deployed release.** That state does not end when the new release's
predeploy applied its migrations and the release then did not activate: a failed
concurrent-index sidecar or declared-posture step (§25), or a failed health
check. The previous containers keep serving (§8), and the serving web container
is now older than the database for good. It keeps answering requests, answers
503 on `/api/health/ready` and logs the readiness line on every probe. It cannot
be deployed again, because `deploy-ci-images --sha <serving sha>` is refused like
any earlier release. And web is configured for the release that failed, so a
variable change on web starts a deployment of that release and reaches no
container unless that deployment activates.

**Containment:** The stop procedure of `docs/BETA.md` §7, carried out as §11:
set `BETA_CAPABILITIES_OFF` to `all`, or to the affected capabilities, on web and
worker and restart both; stop schedulers; preserve canonical data; drain or
quarantine queued work. For one Organization, add its ID to
`BETA_SUSPENDED_ORGS` on web and worker (§1). There is no operator stop for one
Google connection today: `pnpm ops disconnect-connection` refuses `--apply`. An
AccountAdmin of that Organization can disconnect Google in the app (Settings,
Integrations); otherwise stop the Google capabilities for everyone (§11).

In the half-deployed case nothing set on web takes effect, so contain with what
needs no web deployment, and expect web's own interactive gates to stay open
until a release activates:

- `BETA_CAPABILITIES_OFF` on the worker alone. The worker has no migration gate
  and still runs the serving release, so the change deploys and its job handlers
  skip the stopped capabilities.
- A queue pause: `pnpm ops queue pause <queue> --operator <id> --reason <text> --apply`.
- The database-held controls of §25, which take effect without a deployment:
  `pnpm ops ai-control kill …` for AI, and the Google content capability rows,
  written by hand under the shared generation as §25 describes.

Do not try an earlier image first. It is refused, and the attempt is not free.
The runner checks the journal after its schema tracks, so the earlier image's
Better Auth track and concurrent-index sidecar have already run against the
newer database. And `pnpm ops deploy-ci-images` sets web's `RELEASE_SHA` and
points the service at the image before the deployment is attempted, so a refused
attempt leaves web configured for an image it cannot run, and web's next
deployment is built from that configuration. If that has happened, deploy the
release that is serving again with
`pnpm ops deploy-ci-images --sha <serving sha> --apply` before changing anything
else on web. That works only while the serving release carries every applied
migration. In the half-deployed case it does not, and the only way out is the
Recovery below.

**Recovery:** Fix forward. The fix is a new commit on `main`; CI proves it and
`pnpm ops deploy-ci-images --sha <fix sha> --apply` deploys it. The fix must
keep every migration file and `_journal.json` entry the production database has
applied, or the gate refuses the fix itself and the incident is back where it
started:

- Never use a plain `git revert`, or GitHub's Revert button, on a commit that
  touched `drizzle/`. It deletes the migration, CI stays green (see
  Diagnostics), and web's predeploy refuses the result with
  `This image is older than the database`.
- To take the behaviour back, revert the code only and leave `drizzle/` and the
  schema model (`src/shared/db/schema/`, `src/shared/db/db-constructs.sql`) as
  they are: `git revert --no-commit <sha>`, then
  `git restore --source=HEAD --staged --worktree -- drizzle src/shared/db/schema src/shared/db/db-constructs.sql`,
  then commit. CI proves the remaining code against the kept schema.
- To undo the schema change itself, add a new migration. Rows are never deleted
  from `drizzle.__drizzle_migrations` to get an image past the gate.
- Before deploying any fix, check it lost nothing:
  `git diff --diff-filter=D --name-only <sha> <fix sha> -- drizzle/` prints
  nothing, where `<sha>` is the newest release whose migrations reached the
  database (the serving release, or the failed one in the half-deployed case).

In the half-deployed case, repair what stopped the release from activating and
deploy that release again or its fix; §25 covers a failed declared-posture step.
Any release that carries every applied migration and activates ends the state.
Re-enable stopped capabilities one at a time (§11). Point-in-time restore is for
data loss only and is not a release rollback (§8,
[backup-and-lifecycle.md](backup-and-lifecycle.md) §1).

**Verification:** Web's deploy log shows `[migrate-deploy] OK — deploy migration
state reached`, `/api/health/ready` returns 200, every service reports the fix's
`RELEASE_SHA`, and the symptom that opened the incident is gone on the journey
that showed it.

**Escalation:** Bozhidar Denev.

**Evidence:** Retain the misbehaving and fixing release SHAs, the stop time and
the controls used, the refused-deploy log line if an earlier image was tried,
and the restart decision.

---

## 29. False Guest Edits (A Revision Google Only Restated)

**Trigger/Symptoms:** Reviews that nobody edited carry a Material Review
Revision 2 or later; handled Inbox items were reopened ("Reopened - the review
was edited") and closed again; open items show a Response Target that was
overdue the moment it appeared and a `target_passed` reminder; a burst of
"review edited" or reopened notices reached managers. The worker or web log
shows `review.provider_restatement` warn lines (no ids; see "Finding the reviews
a restatement touched" below): since 2026-10-23 Review keeps the revision when
it sees a difference at an unmoved `updateTime`, and the line is how the next
Google format change becomes visible. The first occurrence was 2026-10-23, when
Google changed how it wraps translated review text: 62 closed-beta reviews got a
false Revision 2, 7 handled items were reopened and 55 open items counted as
missed.

**Impact:** P2 — Response Target figures (overdue counts, the on-time and late
buckets, the average) and reminders are wrong for the affected cycles, and
managers were told about edits that did not happen. Nothing is lost: reviews,
replies and the Inbox items themselves are intact.

**How to tell a false guest edit:** A guest edit moves Google's `updateTime`
(`review_source_observations.source_updated_at`). A false one is a
`material_change` observation whose `source_updated_at` equals the one of the
last applied observation before it, in the same source epoch. Read it from
identifiers and times only, never the text columns:

```sql
SELECT observation_sequence, comparison_result, material_revision,
       source_epoch, source_updated_at, observed_at
FROM review_source_observations
WHERE organization_id = $1 AND review_id = $2
ORDER BY observation_sequence;
```

Two rows with the same `source_updated_at` and `material_change` on the second
is a false edit. A real edit shows a later time. A review Google restated after
the rule went live shows `normalization_shadow_match` on the second row instead
and keeps its revision: nothing needs repairing. To find the Properties a
window of false revisions touched (ids and counts):

```sql
SELECT organization_id, property_id, count(*)
FROM material_review_revisions
WHERE revision > 1 AND created_at >= $1
GROUP BY organization_id, property_id;
```

**Finding the reviews a restatement touched.** The rule stores a restatement as
`normalization_shadow_match` (same mechanics: revision kept, digests adopted),
the value the envelope reread uses too, so there is no `provider_restatement`
value to select. Find them afterwards by a digest change at an unmoved
`updateTime`, per Property (the table holds millions of rows on the beta, so
never run it unscoped):

```sql
SELECT review_id, observation_sequence, observed_at
FROM (
  SELECT review_id, observation_sequence, observed_at, comparison_result,
         source_updated_at, normalized_digest,
         lag(source_updated_at) OVER w AS previous_updated_at,
         lag(normalized_digest) OVER w AS previous_digest
  FROM review_source_observations
  WHERE organization_id = $1 AND property_id = $2
    AND comparison_result <> 'out_of_order_ignored'
  WINDOW w AS (PARTITION BY review_id, source_epoch ORDER BY observation_sequence)
) observations
WHERE comparison_result = 'normalization_shadow_match'
  AND source_updated_at = previous_updated_at
  AND normalized_digest <> previous_digest
ORDER BY review_id, observation_sequence;
```

An envelope reread also matches; both are Google rewording, not a guest. Why
there is no separate stored value is in ADR 0055 ("Why no separate stored
value").

**Prerequisites:** Open an incident record. The release that carries migration
0069 (the exclusion ledger) and the restatement rule is deployed on web and
worker, so no new false revision is created while you repair the old ones (check
`RELEASE_SHA` on both). Name the person filling each operating role.

**Containment:** None is needed for the cause once the release above is live.
Notices already delivered cannot be recalled: `review.updated` and
`inbox.response_target_passed` for an open item stay actionable until the item
closes, and `inbox.reopened` was settled when the cycle closed again.

**Recovery:** The cycles and targets are immutable history (ADR 0055), so they
are not edited. Per Property, dry run first:

1. `pnpm ops inbox exclude-restated-revision-targets <propertyId> --operator <id>`
   prints the number of restated revisions Review reports, the candidate cycles
   (counts by item status `open`/`closed` and by target state
   `open`/`on_time`/`late`/`cancelled`), the pending reminder slots and the
   candidate item ids with their cycle numbers. Check it against what the
   Property should have: every candidate must be a `material_revision_changed`
   cycle that a restated revision opened. The list reads the observations'
   `updateTime`, which content erasure (a review deleted on Google, or 30 days
   without a refresh) blanks, so run it promptly and compare the restated count
   with the number the incident expects; a smaller count means some reviews
   dropped out and their targets still count.
2. `pnpm ops inbox exclude-restated-revision-targets <propertyId> --operator <id>
--reason <text> --ticket <ref> --apply` records one
   `inbox_response_target_exclusions` row per candidate and cancels the pending
   reminder slots of those cycles. It moves nothing else: items stay open or
   closed as they were, assignment and escalation are untouched, and a later real
   reply still closes an open item (its completion stays out of the figures).
3. A cycle the command refuses (exit 1) is named with the reason; nothing was
   written for it. Look at it by hand before running again.

The item's real wait is not measured for an excluded cycle, because the earlier
cycle's target was already cancelled and cannot be revived. That is accepted.

**Verification:** A second dry run prints `nothing to exclude`. The Organization
settings analytics and the fleet, Property and attention overdue figures no longer
count the cycles (`SELECT count(*) FROM inbox_response_target_exclusions WHERE
organization_id = $1` equals the applied count), the item shows "Not measured",
and `SELECT count(*) FROM inbox_response_target_reminders WHERE organization_id =
$1 AND delivered_at IS NULL AND cancelled_at IS NULL AND cycle_number IN (...)`
is 0 for the excluded cycles.

**Escalation:** Bozhidar Denev. If the revisions keep appearing after the release
is live, the restatement rule is not catching a new format: keep the
`review.provider_restatement` lines and escalate before running the command again.

**Evidence:** Retain the dry-run and apply records the command printed (operator,
reason, ticket, correlation id, counts), the affected Property ids, the release
SHAs, and the number of notices that reached managers. Do not retain review text.

## 30. Review Observation Backlog (Repeated Rows)

**Trigger/Symptoms:** `review_source_observations` is most of the database.
On the beta on 2026-10-23 it was 3,668 MB of 4,388 MB: 3,425,776 rows for 12,599
Reviews, a median of 277 per Review. Until 2026-10-24 every read of a review wrote
a full-text row, and each snapshot pass reads every review twice. The writer now
records a state, not a read (ADR 0055, note 2026-10-24), so the table should
stop growing once that release is live. The rows already written stay until this
runbook removes them.

**Impact:** P3. Nothing is wrong for users. The cost is storage and backup size,
slower scans of the table, migrations that cannot touch it (a CHECK on it holds
an ACCESS EXCLUSIVE lock for minutes), and hundreds of stored copies of every
review's text.

**Prerequisites:**

- The release with the writer change (PR #964) is deployed on web and worker.
- The release with `pnpm ops review-observations` is deployed.
- An incident or change record is open.
- The owner has approved the apply. It deletes rows, and the deleted rows come
  back only from a backup.

**Diagnostics:** Measure first, and keep the numbers for the evidence.

```sql
SELECT pg_size_pretty(pg_total_relation_size('review_source_observations')) AS total,
       pg_size_pretty(pg_database_size(current_database())) AS database;
SELECT count(*) FROM review_source_observations
WHERE created_at > now() - interval '1 day';
```

The second number should be about the day's new reviews and real changes, not
tens of thousands. If it is still tens of thousands, the writer change is not
live. Stop here.

**Containment:** None needed. The prune runs online, and the sync keeps
running. On the beta one batch covers every Review. It locks only the rows it
deletes, and the writers only update a Review's newest row, which it never
deletes. The one exception is a provider deletion (a snapshot's deletion phase
erasing a removed review) that reaches a locked row: it waits, may fail on its
10 s `lock_timeout`, and the next snapshot retries it.

What the beta run on 2026-10-24 measured (20:55 to 21:35 UTC):

- One DELETE of 3,497,717 rows took **40 minutes**, not the few minutes the scan
  suggested. PostgreSQL estimated one repeat and deleted them one primary-key
  probe at a time, in Review order. Each heap page was rewritten in full after
  every checkpoint: about 20 GB of WAL at 8 to 15 MB/s, and 21 forced
  checkpoints.
- `pg_wal` stayed at `max_wal_size` (1 GB), so disk did not grow.
- App commits waited up to about 0.5 s on the WAL lock in that window.
- Nothing was blocked.

Run it at a quiet hour.

**Recovery:**

1. Dry run (writes nothing):
   `pnpm ops review-observations prune --operator <id>`. It prints the Reviews,
   rows, repeats and kept rows. On the beta, expect about 3.40M repeats and about
   25k kept rows. Optionally try one Organization first with `--org <id>`.
2. Apply:
   `pnpm ops review-observations prune --operator <id> --reason <text> --yes ops:review-observations --apply`.
   It prints progress every 10 batches and a final record. If it stops, read
   `resumeAfter` and the error, fix the cause, and run it again. Batches already
   done stay done.
3. Give the space back (optional, owner's call). Plain VACUUM makes the space
   reusable but leaves the file at its size. `VACUUM FULL review_source_observations`
   rewrites the table and takes an ACCESS EXCLUSIVE lock for as long as it reads
   the old heap: about 2.5 GB on the beta, so expect tens of seconds. Every sync
   write and every pre-publish read in that window waits and then fails on its
   10 s `lock_timeout`. Stop the worker first if you can, run it, then start
   the worker. Run `VACUUM FULL review_source_observations` through `railway ssh`
   into web, outside a transaction, with `lock_timeout` of about 5 s and a retry,
   so the waiting request never queues every other query on the table behind it.
   Web does not write this table. Skipping this step is safe: the table stops
   growing either way.

   **`railway scale --service worker us-west2=0` does not stop the worker**
   (CLI 5.43, 2026-10-24). It answered `{"regions":{"us-west2":null}}` and
   redeployed the worker with one replica. The vacuum then ran with the worker
   live. It took 47 s and rewrote the table from 3,784 MB to 27 MB; the
   database went from 4,545 MB to 787 MB. One sync page write failed on the
   lock (`observation_failed`).

   That step job carries the id of the run it belongs to, and that run is now
   `failed`. Before the release that ends a replayed step quietly, every retry
   and every redrive re-read the failed run and failed the job at once, each
   attempt pushing the Property's backoff further (15 min, then 1 h), until the
   job was a dead letter no redrive could clear. Since that release (§13,
   `run_already_failed`) only the step that fails a run fails its job. So:
   - With the release live, the failed step is one Sentry event (the existing
     `ReviewProviderSnapshotFailure` issue, `failure_code=observation_failed`)
     and the Property's recorded backoff. Its retries end as
     `{ status: 'skipped', code: 'run_already_failed' }`: no throw, no new
     backoff, no dead letter, no quarantine entry and no repair latch, so
     there is nothing to clear by hand. `sync.failed-nonzero` fires from
     `review_sync_state` only if the failure persists past its retry date.
   - A dead letter left from before the release is redriven
     (`pnpm ops quarantine redrive <id> ... --apply`, §14). The step ends quietly,
     and a successful redrive answers `worker.job-runtime-unready` (§17).
   - Without the release, do not redrive it. Discard it and acknowledge the repair:
     `pnpm ops quarantine discard <id> ... --apply --yes ops:quarantine`, then
     `pnpm ops jobs acknowledge-repair sync-property-reviews ... --apply`.

   The next discovery starts a fresh run once the backoff passes, and
   `sync.failed-nonzero` clears when that run completes. A dead letter of this
   incident clears `queue.quarantine-nonempty` and `worker.job-runtime-unready`
   at the next health check after it is redriven (or, without the release,
   discarded and acknowledged). To really pause
   the worker, stop it from the Railway dashboard. Scaling back with
   `us-west2=1` adds the replica to the current deployment, without a new one.

**Verification:**

- A second dry run prints `no repeated observation to delete`.
- `SELECT count(*) FROM review_source_observations` equals the kept count.
- The lifecycle inspection reports no new `active_observation_*` findings.
- `pnpm ops inbox exclude-restated-revision-targets <propertyId>` still lists
  the same restated revisions as before the prune, for any Property where it ever
  found one.

**Escalation:** Bozhidar Denev. A dry run that reports far more kept rows than
Reviews plus real changes means rows differ in a way the rule does not expect.
Do not apply; look at one such Review's rows (ids, comparisons and times only).

**Evidence:** Keep the dry-run and apply records the command printed (operator,
reason, correlation id, counts), the size queries before and after, and the
`retention_runs` row for `review_source_observations.repeats`. Do not keep review
text.
