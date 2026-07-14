# POST-BETA-4 — Recognition, Activity, and Notifications

**Status:** Proposed  
**Depends on:** POST-BETA-1 people/attribution; POST-BETA-3 metric registry/goals; beta durable outbox/jobs/email foundations  
**Contexts:** Badge, leaderboard, activity, notification, staff, team, portal, metric, goal, identity  
**Effort:** 11–17 engineering days

## 1. Goal

Add positive, explainable, correctable recognition without turning Reputation Key into an opaque employee-scoring system. Complete the supporting user activity, restricted security audit, and notification policies so recognition and operational events reach the right person through the right channel without leaking review, guest, or worker data.

The existing `leaderboard` context remains a technical context, but the default product should be framed as a bounded **recognition board**, not an all-time rank-everyone competition. Individual ranking is optional, off by default, and may be omitted entirely if property/team improvement views meet the customer need.

## 2. Product posture

### 2.1 Recognition-only boundary

- No badge, rank, goal, or metric makes or recommends pay, scheduling, promotion, discipline, termination, hiring, or task allocation decisions.
- No negative badge, “worst performer,” bottom-performer alert, or scarcity mechanic.
- No AI sentiment/priority/category/emotion field enters the metric or recognition graph.
- No Google review content/rating/count, named staff mention, review-link click, review-request scan, or public-review conversion enters badges or rankings—even if Google later permits some review analytics. Review-solicitation gamification is a separate policy prohibition.
- Staff can inspect the definition, metric version, period, eligible facts, missing/excluded facts, rank cohort, and correction path.
- Missing/partial/insufficient data never means poor performance.
- Recognition is property-local. No public, cross-organization, or cross-property employee board.

### 2.2 Workforce feature activation

Before enabling goals/badges/leaderboards for a property, record:

- intended coaching/recognition purpose;
- enabled features and metric catalog version;
- property/team/portal audience and visibility;
- enabled jurisdictions and staff notice/consultation status;
- retention, correction contact/SLA, and customer administrator;
- explicit acknowledgement that the feature will not drive employment decisions;
- policy/version, activation actor/time, review/expiry date.

For Europe, complete the DPIA decision and required consultation/local review before activation. For US properties, maintain the state/jurisdiction deployment matrix and customer notice responsibility. Recheck California/Colorado 2027 automated-decision gates if product use ever approaches consequential employment decisions.

## 3. Scope

### In

- Curated positive badge catalog and explicit organization/property activation.
- Immutable award fact plus correctable visible status and award-time snapshots/evidence.
- Per-metric, time-bounded property recognition board with sample/cohort/opportunity rules.
- Manager named view; staff private/anonymized view if explicitly accepted.
- Durable, idempotent, partitioned badge/board projection and reconciliation.
- Separate domain event, product activity item, and security audit record models.
- Notification category/channel/property preferences, recipient timezone/quiet hours, delivery lifecycle, suppression, and privacy-safe templates.
- Staff transparency/correction UX, lifecycle, accessibility, fairness review, scale, and rollout gates.

### Out

- Arbitrary customer-created badge/ranking formulas.
- All-time or global leaderboards.
- Composite/normalized overall score.
- Public individual employee profiles/ranks.
- Pay, scheduling, HRIS, promotion, discipline, or other employment-decision integrations.
- Marketing email/campaign management.
- Push/SMS unless separately planned.
- AI-generated recognition.

## 4. Current-state findings to resolve

### Badge

| Finding                                                                      | Consequence                                                                                     |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| “First Review” is awarded from `portal.rating`                               | Name misrepresents a private rating as a Google review.                                         |
| Definitions are global and organization enablement is effectively default-on | Workforce monitoring/recognition appears without deliberate activation.                         |
| Award FK cascades on definition delete                                       | Historical recognition/evidence can be erased.                                                  |
| Display joins the mutable definition                                         | Past award name/icon/criteria can change retroactively.                                         |
| Awards are “never revoked”                                                   | Bad attribution, abuse, definition defect, or privacy correction has no truthful visible state. |
| Live evaluation is in-memory `Promise.allSettled`                            | A committed eligible fact can fail to award permanently.                                        |
| Global reconciliation enumerates large combinations                          | Work is unbounded and may miss organizations with enabled definitions but zero awards.          |

### Leaderboard

| Finding                                                                                               | Consequence                                                                  |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Context correctly removed composite score, but schema/docs retain `overall`/normalized score concepts | UI can reintroduce a dimensionally meaningless percentage.                   |
| Displayed percentage is a fraction of current property maximum                                        | A target's “score” changes when a peer changes and rewards volume.           |
| Event handler refreshes portal but can miss affected group                                            | Live board and group board diverge until reconciliation.                     |
| Hourly reconciliation can perform roughly 320,000 refresh combinations at 5,000 properties            | Fleet-wide work is wasteful and backlog-prone.                               |
| Snapshot timestamp updates outside the entry replacement transaction                                  | Readers can observe new timestamp with old entries.                          |
| Staff visibility/cohort/fairness semantics are undefined                                              | A portal leaderboard can become an individual employee ranking accidentally. |
| Route invokes both view queries and may query empty property                                          | Avoidable latency/errors and duplicate data work.                            |

### Activity/notification

| Finding                                                                                        | Consequence                                                                   |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| User activity is called an immutable audit log while a separate `audit_logs` table also exists | Neither audience, coverage, integrity, nor retention contract is clear.       |
| Activity snapshots actor identity/payload fields                                               | Personal/sensitive data can outlive its purpose or leak through a broad feed. |
| Notification docs describe one unread resource item while schema uniqueness includes event ID  | Dedupe/coalescing behavior is inconsistent.                                   |
| Missing preference enables in-app and email                                                    | New recognition/workflow email can be sent without deliberate default policy. |
| Digests follow property timezone                                                               | Multi-property users can receive duplicate or inconvenient delivery.          |
| Email provider idempotency is shorter than product retry horizon                               | A later retry can duplicate unless RepKey owns durable idempotency.           |

## 5. Badge domain contract

### 5.1 Definition and enablement

`badge_definitions`

- stable key and immutable version;
- name, plain-language purpose, icon token, audience/visibility defaults;
- approved metric definition version and exact threshold/window/sample/opportunity rule;
- allowed scopes and recipients;
- worker/privacy/fairness review and policy version;
- lifecycle `draft|approved|retired`.

`badge_activations`

- organization/property, definition version, status;
- workforce activation/policy reference;
- audience/visibility, effective dates, actor, review/expiry date.

Organizations choose from an approved catalog. They cannot provide executable formulas in v1. “First Review” is removed/renamed; a private guest rating is not a review and is not a recommended recognition criterion.

### 5.2 Award and visible state

Keep two truths:

- `BadgeAwarded` is an immutable historical fact that the then-current evaluator issued an award.
- `BadgeAwardStatus` is the current truthful presentation: `active|invalidated|superseded|hidden`.

An award snapshots definition name/icon/purpose, rule and metric version, recipient/scope, period/timezone, source watermark, sample/opportunity/completeness, evidence summary, award time, and evaluator version. It never depends on a mutable definition join for historical display.

Invalidation records reason, actor/source correction, timestamp, replacement if any, activity/notification policy, and appeal/correction reference. Physical deletion occurs only through an approved privacy/lifecycle workflow and leaves appropriately pseudonymized restricted evidence where justified.

### 5.3 Visibility

- Default: recipient and authorized managers.
- Organization-wide/team announcement and public display are separate opt-ins.
- A recipient can hide their recognition from wider staff views where product/legal review requires it.
- Invalidation copy is factual and neutral, not punitive. Do not email “badge lost” by default.

## 6. Recognition board contract

### 6.1 Ranking semantics

- One property, one approved metric version, one comparable scope/role cohort, one bounded period.
- Initial periods: weekly/monthly/quarterly as justified; no `all_time`.
- Show direct unit/rate/target attainment, rank/tie, sample/opportunity, completeness, freshness, calculation version, and period/timezone.
- No composite or property-max normalized percentage.
- Missing/partial/reconciling/ineligible/low-sample targets are unranked with an explanation.
- Ties share rank; do not add arbitrary hidden tie-breakers.
- Candidate starting floors: at least five eligible peers and ten relevant observations per target. These are conservative planning defaults, not statistical/legal guarantees; validate for each metric and property shape.
- Raw volume is not fair where opportunity differs. A registry definition must declare an approved denominator/target or be ineligible.

### 6.2 Subjects and visibility

- Portal-group recognition board is the preferred initial subject because it recognizes an area/department rather than a person.
- Portal board is enabled only where portals are comparable and not individual worker proxies, or after the individual ranking gate.
- No administrative team join at query time; historical portal-group attribution comes from metric readings.
- Manager view may show named eligible subjects.
- Recommended staff view: own subject/position and pseudonymous peers, with top recognition but no public bottom list.
- A full named staff board, if desired, requires a distinct capability and workforce review; it is not the default.

### 6.3 Projection model

`leaderboard_snapshots`

- property, metric definition version, subject type, period/cohort, policy version;
- status, quality/freshness, source watermark, computed time, generation/version.

`leaderboard_entries`

- snapshot, subject, direct value/numerator/denominator/sample/opportunity, rank/tie, eligibility/exclusion reason;
- presentation reference resolved according to audience, not denormalized sensitive staff data in a public cache.

Write snapshot and complete entry replacement in one transaction/version. Readers fetch one committed generation. A metric/attribution correction invalidates only affected property/metric/period partitions and queues a bounded rebuild.

Live refresh consumes rollup/goal changes and enqueues unique affected partitions. Reconciliation scans checkpointed dirty/watermark partitions, not every combination fleet-wide. On-demand reads never synchronously recompute the entire board.

## 7. Activity, audit, and domain event contract

### 7.1 Three distinct models

| Model                 | Owner/purpose                                                     | Audience                        | Mutable presentation/lifecycle                                           |
| --------------------- | ----------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| Domain event          | Source context; durable internal fact for workflows               | Trusted consumers/operators     | Immutable fact with schema version and consumer retention                |
| Activity item         | Activity context; explain resource collaboration/history          | Authorized product users        | Presentation may be redacted/tombstoned; privacy-aware shorter retention |
| Security audit record | Security/audit module; investigate access/policy/external effects | Restricted operators/compliance | Append-oriented, tamper-evident controls, separate retention/legal hold  |

The activity context must stop claiming to be the complete immutable audit log.

### 7.2 Event registry

Every source event declares:

- business/security purpose and owner;
- data classification, allowed payload fields, prohibited fields;
- activity audience/rendering and resource authorization;
- audit coverage/result/correlation requirements;
- retention, deletion/anonymization, subject-request, and legal-hold action;
- regional route and schema version.

Never copy review text, guest text/media, email body, tokens, cookies, presigned URLs, raw network identifiers, or secrets into generic activity/audit/log payloads. Store resource IDs and minimal reason/status; fetch authorized current detail at view time when appropriate.

### 7.3 Coverage

Activity may cover user-meaningful collaboration: membership/responsibility changes, goal lifecycle, active badge award, portal publication, reply status, and integration health. Security audit additionally covers authentication/authorization decisions, role/grant changes, sensitive staff-data access/export, capability/policy activation, Google connect/disconnect/external publish, guest moderation, upload validation, privacy requests, and destructive lifecycle actions.

Audit integrity should include append-only privileges, restricted service roles, time synchronization, immutable/remote retention where required, hash/sequence/tamper detection, access audit, and restore/query runbooks. This does not mean “retain everything forever.”

## 8. Notification contract

### 8.1 Category × channel × property policy

Categories:

- mandatory account/security/legal;
- urgent operational failures requiring action;
- workflow/collaboration;
- digest/summary;
- recognition.

Channels initially: in-app and email. Preferences are explicit and versioned by category/channel, with optional property filters, user timezone, quiet hours, and digest cadence. Missing rows resolve through a code/versioned default policy rather than “both on.”

Recommended defaults:

| Category                         | In-app                                            | Email                                                                  |
| -------------------------------- | ------------------------------------------------- | ---------------------------------------------------------------------- |
| Mandatory account/security/legal | On, non-disableable only when genuinely mandatory | On as required                                                         |
| Urgent operational               | On for responsible users                          | On for explicitly responsible users; allow bounded quiet-hour override |
| Workflow/collaboration           | On                                                | Off unless user opts in                                                |
| Digest                           | Off                                               | Off; user opts in                                                      |
| Recognition                      | On privately                                      | Off; user opts in                                                      |

No marketing content in operational mail. Every non-mandatory email links directly to preferences. Email/in-app content uses property/resource/status metadata and authenticated links; omit review text, guest text, media, sensitive score details, and other employees' data.

### 8.2 Recipient and coalescing semantics

- Notification context owns recipient policy and template/version; producers emit resource events, not user lists.
- Resolve authorization/property responsibility at creation and again at read/delivery where sensitive. Revoke/hide undelivered or unread sensitive items when access is removed.
- Define coalescing explicitly: at most one unread item per `(user, type, resource)` may bump count/latest time while preserving a delivery/event relation table. Do not rely on a uniqueness key containing event ID to implement resource coalescing.
- A user assigned to multiple properties receives one digest in their chosen timezone containing authorized property sections, not one digest per property timezone.
- Quiet hours use user IANA timezone with organization fallback; DST behavior is tested.

### 8.3 Delivery lifecycle

- Persist durable send intent and application idempotency key beyond Resend's 24-hour dedupe window.
- State: `pending → accepted → delivered|delayed|bounced|complained|failed|suppressed|cancelled` with retry policy by class.
- Persist provider message ID and minimal template/version metadata.
- Verify webhooks against raw body, deduplicate provider event IDs, handle out-of-order events, and keep local bounce/complaint suppression.
- Separate transactional and any future marketing domains/configuration; configure SPF/DKIM/DMARC and monitor reputation.
- Kill switch can stop email while retaining in-app/durable intents and status.

## 9. Work packages

### PB4.0 — Permitted-use policy and activation gate

1. Accept ADR 0043, 0045, and 0046.
2. Decide whether any individual board ships; prefer portal-group recognition first.
3. Create the workforce activation aggregate/capability and administrator flow.
4. Prepare customer worker-notice/consultation guidance, DPIA decision template, jurisdiction matrix, and correction/contact process with counsel.
5. Add architectural tests prohibiting AI/review-solicitation/Google-restricted source classes from recognition.

**Exit:** Recognition cannot activate without an approved policy/metric catalog and recorded property activation.

### PB4.1 — Badge catalog, award, and migration

1. Audit every seed definition against metric eligibility and product wording.
2. Remove/rename “First Review”; do not enable a private-rating replacement by default.
3. Add versioned definitions, activations, award snapshots, visible status, evidence, and invalidation/supersession.
4. Change destructive FK cascades and migrate historical awards with explicit snapshot-quality markers.
5. Implement staff/manager badge history, detail/explanation, visibility, and correction UX.

### PB4.2 — Durable badge evaluation and repair

1. Consume approved metric rollup/goal outcome events through durable idempotent jobs.
2. Key evaluation by property/definition version/subject/period/source watermark.
3. Commit award/status/outbox atomically; duplicates return existing outcome.
4. Partition/checkpoint reconciliation from active definitions/properties, including zero-award organizations.
5. Correction/retraction triggers deterministic reevaluation and exception report.
6. Add queue lag/failure/retry/dead-letter/last-success monitoring and runbook.

### PB4.3 — Recognition board projection and UI

1. Remove stale `overall`/normalized public contract and migrate schema/readers.
2. Add period/cohort/metric generation with quality/sample/opportunity metadata.
3. Atomically replace one partition generation.
4. Replace global hourly recomputation with affected-partition jobs plus checkpointed reconciliation.
5. Fix portal-group invalidation and empty/duplicate page queries.
6. Build manager named and accepted staff-private/anonymized views with semantic table/list, ties, explanations, correction, and insufficient-data states.
7. Add activation/review-expiry UI and audit.

### PB4.4 — Activity versus security audit split

1. Inventory producers/consumers and classify every current activity/audit event.
2. Rename/re-document activity as user-facing feed; define resource authorization at query time.
3. Build or deepen restricted audit writer/query/export with least privilege and tamper/access controls.
4. Migrate current `audit_logs`/activity data only where semantics are known; retain unknown legacy data under a documented legacy class until expiry.
5. Add redaction/tombstone/pseudonymization and retention jobs.
6. Add missing critical coverage and safe correlation from command → event → job → external effect.

### PB4.5 — Notification policy/preferences and coalescing

1. Resolve schema/docs mismatch and migrate notification/event/delivery relations.
2. Implement explicit default policy and preferences by category/channel/property, timezone, quiet hours, cadence.
3. Implement resource coalescing without losing event/delivery evidence.
4. Revalidate authorization for sensitive unread/delivery work after access changes.
5. Build accessible settings, mandatory explanations, one-click email route, and preview/test-send restricted to safe recipients.

### PB4.6 — Email delivery completion

1. Add application idempotency, provider message ID, terminal state, retry classification, suppression.
2. Verify/dedupe/order provider webhooks and reconcile accepted-but-unknown delivery.
3. Keep content privacy-safe; render/test text and HTML, long/localized content, dark mode, and no-secret logs.
4. Configure domain authentication, bounce/complaint alerting, global/property/recipient allowlist and kill switches.
5. Enable recognition email only by user opt-in after in-app observation.

### PB4.7 — Fairness, accessibility, scale, and rollout

1. Produce per-metric fairness sheet: purpose, comparable subjects, exposure/denominator, exclusions, sample/cohort floor, accommodation risks, correction and known limitations.
2. Test alternate workflows/accommodations do not automatically reduce eligibility; mark unavailable if equivalence cannot be established.
3. Add staff “How my data is used” and evidence/correction view.
4. Run WCAG 2.2 AA manual/automated checks, especially semantic ranking tables, chart alternatives, focus/status, contrast, reduced motion.
5. Load/replay/correction tests at 5,000 properties with burst and backlog; prove bounded partition processing.
6. Roll out private badges, then manager group board, then optional staff view. Observe at least one full bounded season before expansion.

## 10. Test matrix

### Badge

- definition/activation versioning, unknown/restricted metric, sample/quality, duplicate/out-of-order event;
- atomic award/outbox, correction/invalidation/supersession, definition retirement, privacy hide/delete;
- recipient/manager/other-staff/other-property authorization;
- zero-award reconciliation, crash/resume/cancel, target-scale backlog.

### Recognition board

- property/metric/period/cohort partition, low sample/cohort, unequal opportunity, partial/delayed/reconciling;
- ties/precision, no hidden tiebreaker, no normalized/composite/all-time output;
- portal/group move and metric correction; atomic reader generation under concurrent rebuild;
- staff anonymity and manager identity; cache/tenant/property separation;
- scalable dirty-partition reconciliation, no fleet-wide per-combination loop.

### Activity/audit

- event registry coverage, safe payload allowlist/redaction, authorization at view/export;
- activity tombstone versus audit evidence, subject deletion/pseudonymization, retention/legal hold;
- tamper/access monitoring, correlation, replay/idempotency, clock/order behavior;
- no review/guest/email body/token/cookie/presigned URL in stored payload or logs.

### Notifications/email

- explicit defaults, every preference dimension, access revoked after creation, coalescing race;
- user timezone/DST/quiet hours/multi-property digest;
- application/provider idempotency, retry after 24 hours, webhook signature/duplicate/out-of-order, bounce/complaint/suppression;
- template escaping, privacy-safe content, permission link, kill switch, allowlist;
- keyboard/screen-reader/zoom/mobile settings and notification center.

## 11. Gate criteria

- Workforce recognition is server-disabled until a property activation/policy record exists.
- AI, review-solicitation, and Google-restricted source classes cannot enter badges or rankings by any code path.
- Badge display is snapshotted, positive, explainable, correctable, and never erased by definition cascade.
- Recognition board is property-local, per metric, time-bounded, sample/cohort/opportunity aware, atomic, scalable, and has no composite/normalized/all-time score.
- Staff see only the accepted identity/anonymity model and can inspect/correct their own facts.
- Product activity and restricted security audit have distinct schema, audience, payload, integrity, retention, and deletion contracts.
- Notification defaults/preferences/coalescing/timezone are explicit; delivery is idempotent and suppression-aware.
- No unresolved P0/P1 fairness, privacy, authorization, accessibility, email, or scale issue remains after one full controlled recognition season.

## 12. Decisions required before PB4.0 exits

| Decision              | Recommended default                                                                                 |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Product form          | Start with portal-group recognition and private badges; individual leaderboard off.                 |
| Staff rank visibility | Own position plus anonymized peers, only after controlled manager-view trial.                       |
| Cohort/sample         | Start at ≥5 eligible peers and ≥10 observations, then validate per metric/property.                 |
| Periods               | Bounded weekly/monthly/quarterly; no all-time.                                                      |
| Badge visibility      | Recipient + authorized managers; wider announcements opt-in.                                        |
| Award correction      | Visible `invalidated/superseded` state with neutral reason and preserved evidence.                  |
| Recognition email     | Off by default; explicit user opt-in.                                                               |
| Team-lead workflow    | Basic lead/membership belongs to POST-BETA-1; any broader “leadership” product needs its own scope. |
