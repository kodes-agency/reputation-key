# BQC-8 — Scale, Recovery, and Release Evidence

**Status:** `not_started`  
**Estimate:** 6–10 engineering days plus environment scheduling  
**Dependencies:** BQC-6 and BQC-7 accepted; BQC-1…5 production paths complete  
**Unlocks:** BQC-9 real-property pilot

## 1. Outcome

Execute—not describe—the target-scale, burst, failure, restore, regional, security, and release-candidate gates. Produce one immutable evidence bundle that proves the same commit, migrations, artifacts, policy versions, topology, and environment passed every required gate.

## 2. Findings owned

- SPEC-P1-04 — BQR-6 templates instead of proof.
- SPEC-P2-02 — incomplete release evidence.
- Final evidence for SPEC-P1-05 and SPEC-P1-06.
- Target-scale and recovery closure for every P0 runtime/data/policy finding.

## 3. Test environment and dataset

Provision a production-shaped staging cell with:

- the production web/worker containers and migration path;
- PostgreSQL/Redis/storage classes representative of intended beta production;
- the same observability/alerts/operator controls;
- isolated synthetic identities and provider adapters/sandboxes;
- 100 organizations, 5,000 properties, 500,000 reviews, representative inbox/reply/metric/activity/notification state;
- realistic skew: a small percentage of properties owns a large share of reviews, plus long/translated/missing data;
- US-heavy distribution with denied/unprovisioned Europe cases for routing proof.

The seed tool records deterministic seed/version/hash and validates counts/relationships. It must not only generate SQL; it must load, verify, and clean up the environment safely.

## 4. Slices

### BQC-8.1 — Convert scenario catalogues into executable harnesses

- Turn `scripts/perf/load-test.ts` from descriptions into runnable scenarios or replace it with a maintained tool.
- Make `write-scale-evidence` ingest measured outputs; it may not label unexecuted rows as evidence.
- Fail when thresholds, required samples, release identity, or monitoring data are absent.
- Store raw performance data without protected content and generate reviewed summaries.

### BQC-8.2 — Steady-state and burst capacity

Execute:

- normal monthly-rate review arrival with realistic daily/hourly skew;
- webhook/import burst and reconnect catch-up;
- dashboard/inbox interactive reads while jobs run;
- reply publication burst within human-use expectations;
- worker scale-up/down and backlog drain;
- cache cold start/eviction;
- connection pool and tenant-fairness pressure.

Measure throughput, p50/p95/p99 latency, error rate, queue oldest age/lag, DB CPU/locks/connections/query time, Redis memory/latency, cache hit rate, and worker utilization. Verify no property starves behind a hot tenant.

### BQC-8.3 — Source lifecycle at scale

- Advance an accelerated clock/data distribution through refresh-due and hard expiry.
- Verify cursor jobs cover all 500,000 reviews without full-table/unbounded behavior.
- Inject Google throttling/transient failures and prove backpressure, retries, alerts, and purge safety.
- Confirm no expired content is served and all seeded canaries disappear from every registered copy.
- Verify outbox/receipt/job/log/cache retention keeps tables/queues bounded.

### BQC-8.4 — Durable runtime fault matrix

Inject at controlled boundaries:

- process crash before/after state+outbox commit;
- crash before/after projection+receipt commit;
- duplicate/reordered events;
- malformed/unknown/poison jobs;
- stalled worker and expired lease;
- Redis restart/outage;
- PostgreSQL connection interruption/failover simulation;
- provider timeout/throttle/ambiguous reply outcome;
- quarantine and operator redrive.

Prove no lost facts, split commits, duplicate external replies, or silently completed unknown work. Reconciliation/repair must converge.

### BQC-8.5 — Region fault matrix

- Stop or deny the US queue/worker/provider adapter and prove no cross-region execution.
- Attempt wrong-cell/tampered jobs and confirm quarantine/alert.
- Attempt an unresolved/Europe property in the US-only beta and confirm deny.
- Verify global control/observability data remains content-free.

### BQC-8.6 — Backup, restore, rollback, and forward recovery

Measure:

- point-in-time restore and application reconciliation against RPO ≤15 minutes;
- restore to usable service against RTO ≤4 hours;
- source-policy enforcement before restored traffic;
- deployment rollback to the previous compatible artifact;
- forward recovery for an irreversible migration;
- Redis/job reconstruction or reconciliation according to declared durability;
- secrets/key rotation effect on existing encrypted tokens/sessions.

Record start/end timestamps, lost/recovered work, manual steps, owners, and deviations. A configured backup without a successful restore is failure.

### BQC-8.7 — Security and privacy release gates

Run all BQC-7 scans against final artifacts, repeat protected-canary scans across staging telemetry/evidence, verify least privilege and private diagnostics, and review data-flow/retention/provider/subprocessor documentation with accountable owners.

### BQC-8.8 — Immutable release bundle

Populate the master evidence structure. Add an automated validator that ensures:

- all required files exist and are non-template;
- every result refers to the same release/config/policy identities;
- every finding is accepted or has a permitted lower-severity disposition;
- no required step is soft/failed/pending;
- evidence links/artifacts are accessible to reviewers;
- approvals are from named roles and after the final evidence timestamp.

## 5. Performance budgets

Use the repository's documented SLOs where already approved and record exact numeric thresholds before executing. At minimum:

- interactive inbox/dashboard/reply paths have defined p95/p99 and error budgets;
- new reviews project within the beta freshness SLO;
- queue oldest age and backlog drain have explicit maximums;
- refresh completes with margin before hard expiry under throttle/failure;
- queries/jobs have bounded row/time/memory budgets;
- deploy, drain, restore, and rollback targets are explicit;
- RPO/RTO remain ≤15 minutes/≤4 hours.

Do not choose thresholds after viewing results. If an existing threshold is unrealistic, revise it through an approved decision before the run and explain user/policy impact.

## 6. Go/no-go review

Required reviewers:

- engineering/runtime;
- product/property owner;
- security/privacy;
- Google project/integration owner;
- operations/on-call owner.

No-go conditions include any master stop-line, unresolved P0/P1, missing evidence, failed restore, unbounded lifecycle backlog, wrong-region execution, hidden soft gate, or release-identity mismatch.

## 7. Evidence

This phase's output is the release evidence bundle itself, plus:

- signed staging environment inventory;
- deterministic dataset manifest;
- raw load/fault/recovery measurements;
- alert/operator timelines;
- finding closure report;
- exception register;
- signed go/no-go decision for BQC-9.

## 8. Exit matrix

| Criterion                                                       | Required result |
| --------------------------------------------------------------- | --------------- |
| 5,000-property/500,000-review dataset loaded and verified       | Pass            |
| Steady/burst/backlog/cold-cache scenarios meet budgets          | Pass            |
| Lifecycle refresh/expiry/retention meets policy at scale        | Pass            |
| Crash/duplicate/reorder/poison/stalled/redrive converges safely | Pass            |
| Region outage produces no fallback                              | Pass            |
| Restore observes RPO/RTO and source policy                      | Pass            |
| Security/privacy/artifact gates pass final candidate            | Pass            |
| All 25 findings have accepted evidence                          | Pass            |
| Release bundle validates and reviewers approve pilot entry      | Accepted        |

## 9. Out of scope

- Real Google review content; this phase uses synthetic/provider-sandbox data.
- BQC-9 observation period.
- AI workload sizing; Phase 17/18 will use the accepted runtime/capacity baseline.
