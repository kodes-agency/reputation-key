# BQC-9 — Controlled Pilot and AI-Readiness Handoff

**Status:** `not_started`  
**Estimate:** 3–5 engineering days plus at least 14 stable observed days  
**Dependencies:** BQC-0 through BQC-8 accepted for one immutable candidate  
**Unlocks:** internal beta acceptance and a clean Phase 17/18 planning baseline

## 1. Outcome

Operate the accepted release through production synthetic, one-property read-only shadow, controlled manual publication, and a 3–5-property US cohort. Capture property-owner and operational feedback without weakening source, policy, region, or manual-publication controls.

After acceptance, publish a Phase 17/18 handoff that records proven interfaces, budgets, governance, and open product/provider decisions. No AI feature is implemented in BQC-9.

## Ownership mode

- Production-synthetic and real-property operation of the immutable candidate: `RE_EXECUTES`/observes accepted behavior.
- Final beta acceptance and Phase 17/18 handoff: `PROMOTES` the accepted candidate and evidence.
- BQC-9 contains no product/runtime fix slices. Any material defect returns to its implementation owner, creates a new candidate, and restarts the affected acceptance and observation clock.

## 2. Entry conditions

- One validated BQC-8 release bundle and go decision.
- Zero unresolved P0/P1 findings.
- Named engineering, operations, security/privacy, Google-project, and property owners.
- Google project/API access and merchant authorization confirmed.
- Pilot agreement/privacy notice/support channel approved.
- US property processing target healthy; Europe/global processing denied unless separately accepted.
- Rollback/kill switches, alerts, on-call, and daily review schedule ready.

## 3. Pilot stages

### Stage P0 — Production synthetic

- Deploy the immutable candidate and migrations.
- Run synthetic org/property workflows, queues, lifecycle, alerts, operator commands, backup, and rollback smoke.
- Confirm deployed capability/policy/routing/source versions match the evidence manifest.
- Confirm no real Google connection or provider side effect is possible for synthetic identities.

**Exit:** 48 hours quiet normal operation plus successful injected alert/operator smoke, unless an approved shorter window is justified by an already equivalent BQC-8 environment.

### Stage P1 — One owned US property, read-only shadow

- Operator allowlists the organization/property and records region/source.
- Merchant authorizes Google connection.
- Sync reviews and project inbox/dashboard; publication remains denied.
- Observe webhook/sync freshness, content expiry schedule, queue age, policy decisions, region, disconnect/purge dry-run, and support workflow.
- Compare a bounded sample to Google manually without copying content into evidence.

**Exit:** data completeness/freshness accepted; no cross-property exposure; lifecycle/region/policy evidence healthy; property owner accepts review/inbox experience.

### Stage P2 — Controlled manual reply publication

- Enable manual publication for named managers/property only.
- Manager writes or reviews/edits the reply and performs a separate publish action.
- Exercise successful publish and one controlled failure/reconciliation scenario using safe test content where feasible.
- Auto-publish and AI draft/analysis remain denied.
- Operator is present and rollback ready.

**Exit:** no duplicate/ambiguous unresolved reply; statuses and failures visible; audit/content policy correct; manager accepts workflow.

### Stage P3 — Three to five allowlisted US properties

- Add one property at a time after explicit go review.
- Observe for at least 14 stable consecutive days after the final property joins.
- Review SLOs, source lifecycle, policy denials, region, queue/backlog, provider quota, support incidents, accessibility/usability feedback, and operational load daily initially, then at the approved cadence.
- Any stop-line pauses expansion and returns to the owning BQC phase.

**Exit:** stable observation, no unresolved P0/P1, property-owner acceptance, runbooks/support updated, and final multi-role approval.

## 4. Pilot metrics and evidence

Use content-free metrics/evidence:

- sync/webhook freshness and reconciliation counts;
- reviews received/projected/expired by count and stable outcome, not content;
- queue oldest age, retries, stalls, quarantine, redrive;
- inbox/reply workflow latency and terminal outcomes;
- publication ambiguity and reconciliation time;
- policy denials, suspension/revocation latency;
- source refresh/purge backlog and canary checks;
- region decision/failure/no-fallback events;
- web performance/errors/accessibility reports;
- support issue class, severity, owner, resolution;
- deploy/rollback/incident timeline.

Do not place review/reply text, reviewer identity, Google identifiers, tokens, emails, screenshots with raw content, or provider bodies in the release evidence.

## 5. Rollback and stop-lines

Immediately pause the affected scope for:

- wrong-tenant/property access;
- raw content after expiry or in unapproved storage/telemetry;
- lost state/event, split projection/receipt, silent job loss;
- duplicate or unresolved ambiguous external publication;
- disabled/dark capability execution;
- unresolved/wrong/cross-region processing;
- material freshness/backlog/restore/SLO breach;
- Google authorization/policy, privacy, or merchant-consent concern.

Rollback order:

1. deny new protected work through policy;
2. stop the relevant schedules/workers and quarantine without deleting;
3. preserve canonical state and evidence;
4. reconcile in-flight external outcomes;
5. restore/forward-recover according to runbook;
6. return to the owning BQC phase and issue a new candidate.

The 14-day observation clock restarts after any material candidate change or stop-line incident.

## 6. Final beta acceptance

Required sign-offs:

- engineering confirms finding closure and architecture/runtime health;
- operations confirms alerts, runbooks, recovery, support, and capacity;
- security/privacy confirms data flow, retention, access, scans, and incident posture;
- Google-project owner confirms API/OAuth/merchant/manual-publication posture;
- product/property owners accept the enabled workflow and dark scope.

The accepted manifest records all signers, timestamps, remaining P2/P3 items with owners/expiry, and the exact deployed release/policy identities.

## 7. Phase 17/18 handoff

Create a new AI planning input, not an implementation branch, containing:

- accepted `ExecutionPolicy`, `ReviewSourceLifecycle`, context command/projection, `JobRuntime`, `ProcessingRouter`, and `OperationsSnapshot` interfaces;
- measured review volume, token-safe review-length distribution, queue/capacity budgets, and property-region topology;
- executable merchant opt-in/revocation, redaction, retention, provider-review, usage/audit, quota, and manual-publish requirements;
- Google-approved per-property-only analysis boundary and explicit prohibition on organization summaries;
- no-training/minimum-retention/provider-region requirements;
- property-local sentiment, priority, categorization, reply drafting, themes, trends, and summaries as the only candidate product scope;
- provider bake-off decisions still open, including Azure/OpenAI/Bedrock options;
- new Phase 17/18 gate criteria based on observed beta data, not old estimates.

AI remains dark until the user explicitly starts Phase 17/18 planning/implementation and the provider/governance decisions are accepted.

## 8. Exit matrix

| Criterion                                                       | Required result |
| --------------------------------------------------------------- | --------------- |
| Production synthetic stage accepted                             | Pass            |
| One-property read-only shadow accepted                          | Pass            |
| Controlled manual publication accepted                          | Pass            |
| 3–5 US properties complete ≥14 stable days                      | Pass            |
| No unresolved P0/P1; lower findings owned/expiring              | Pass            |
| Capability matrix matches deployed beta posture                 | Pass            |
| Multi-role beta manifest signed                                 | Accepted        |
| AI handoff reflects proven interfaces and per-property boundary | Published       |

## 9. Out of scope

- External/public beta.
- European real-property pilot before its cell/privacy gate.
- AI analysis, drafting, trends, quota billing, provider integration, or dashboard implementation.
- Promotion of Team, Portal, Guest, Goal, Badge, or Leaderboard.
