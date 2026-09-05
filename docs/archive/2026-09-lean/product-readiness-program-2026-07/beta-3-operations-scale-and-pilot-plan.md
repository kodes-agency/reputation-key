# BETA-3 — Operations, Scale Evidence, and Pilot

**Status:** Proposed  
**Date:** 2026-07-14  
**Effort:** 10–15 engineering days, including PRE17C overlap; excludes observation windows  
**Depends on:** BETA-0; BETA-1 synthetic gate; BETA-2 enabled-surface gate  
**Unlocks:** One-property production shadow, controlled publish, small cohort, internal beta

## 1. Objective

Turn a correct application into an operable service. Prove deployment, recovery, telemetry, failure handling, target-scale behavior, property-region routing, and human response before expanding from synthetic data to real properties.

The target—5,000 properties and 500,000 reviews/month—is not high average throughput. It is an operational burst and data-shape problem:

- about 16,700 reviews/day or 0.2/second averaged over a month;
- first imports can produce many pages per property;
- Pub/Sub fan-out, provider retries, hotel-local timing, deployments, and reconciliation produce 10–100x bursts;
- a single operator may have thousands of properties, making list/root/dashboard queries the more immediate risk;
- external quotas and correctness of side effects matter more than raw CPU throughput.

## 2. Operating model and ownership

Before production synthetic rehearsal, name:

- primary engineering service owner and backup;
- beta product/property owner;
- privacy/security incident owner and backup;
- Google project/quota owner;
- database/Redis/storage/email/observability vendor owners;
- support hours, escalation path, and authority to disable import, publish, email, public writes, uploads, a property, a region, or the entire service.

Severity defaults:

| Severity | Examples                                                                                                                                                                      | Response                                                                              |
| -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| P0       | Cross-tenant access, unauthorized/duplicate Google reply, leaked credential/source content, unexplained committed-data loss, policy violation, cannot contain active incident | Stop affected beta path immediately; page owners; preserve evidence; incident command |
| P1       | Import/publish unavailable, severe backlog, restore objective at risk, widespread login failure, destructive migration failure                                                | Same working hour during staffed beta; stop expansion; follow runbook                 |
| P2       | Partial feature degradation with safe workaround, individual reconnect, noncritical performance/accessibility issue                                                           | Triage same working day; owner/date                                                   |
| P3       | Cosmetic/low-impact improvement                                                                                                                                               | Normal backlog                                                                        |

P0 invariants have no error budget. One confirmed instance stops rollout until root cause and corrective evidence are accepted.

## 3. Architectural decisions

1. Complete PRE17C ADRs for observability, read models/cache, scale/backpressure, and AI/audit readiness.
2. Approve **ADR 0038 — Beta service objectives and recovery** with the actual purchased vendor capabilities.
3. Record a **deployment topology decision**: separately deployable web and worker, serialized migration/release job, dedicated queue Redis, separate cache/rate-limit Redis, regional data-plane mapping, and private diagnostic surfaces.
4. Record a **release/rollback decision**: immutable source/artifact identity, backward-compatible schema window, capability cutover, and data migration recovery. “Redeploy previous code” is not a complete rollback plan.

## 4. Work packages

### B3.1 — Reproducible web/worker/release topology

Tasks:

1. Define two independently deployable Railway services:
   - **web:** SSR/routes/server functions, no general job processing;
   - **worker:** BullMQ/outbox/external workflows/maintenance, no public HTTP except private liveness/diagnostics if needed.
2. If relay/scheduler ownership cannot safely share the worker, add explicit singleton/leased roles without creating a microservice estate.
3. Pin exact Node LTS patch, pnpm, native build dependencies, build/start commands, environment schema, resources, and restart policy.
4. Prefer an immutable multi-stage non-root container with a pinned trusted base digest. If Railway source builds remain, prove equivalent reproducibility, runtime identity, SBOM, and web/worker artifact separation.
5. Run the one approved migration command as a serialized pre-deploy/release job. Non-zero exit prevents activation.
6. Keep new application code compatible with the prior schema during rolling activation. Use capability flags to cut over only after schema/backfill verification.
7. Start the built production artifact in CI, call liveness/readiness, and run a critical smoke journey before deployment eligibility.
8. Record release SHA/build/schema/config version; promote one artifact where platform support allows rather than rebuilding per environment.

Acceptance evidence:

- web can deploy/restart without stopping in-flight worker work and vice versa;
- a failed migration or readiness check prevents new activation;
- old and new versions overlap safely in a tested rolling scenario;
- rollback drill handles both pre- and post-cutover cases without reversing destructive schema.

### B3.2 — Regional environment and property routing

Initial plan:

- US data plane first for US pilot properties;
- EU data plane only after its privacy/transfer/vendor/backup/log/support gate;
- global control-plane metadata is limited, documented, and approved;
- no implicit fallback moves review/source content to another region.

Tasks:

1. Map each processing region to approved database, durable queue, cache, object storage, telemetry, email, Google/provider, backup, and future AI endpoints.
2. Provision routing configuration by stable route-policy version. Jobs carry property ID and version, then re-resolve; they never carry an arbitrary endpoint.
3. Make unsupported/missing/conflicting routes fail closed before content leaves the authorized boundary.
4. Include logs, traces, operator access, backups, DR, exports, and provider support access in the data-flow map—not only database location.
5. Add route diagnostics, per-region kill switch, configuration validation, and synthetic probe.
6. Test organization members operating properties in different regions without cross-region organization summaries or mixed property caches.
7. Plan region move as an explicit maintenance workflow with copy/verify/cutover/delete evidence; keep it unavailable in beta unless required.

Acceptance evidence:

- property route is deterministic, immutable after data without a migration, and visible to authorized operators;
- endpoint/config corruption cannot cause silent fallback;
- cross-region tests prove property-local reads/jobs/telemetry and global metadata minimization;
- EU property admission remains impossible until its accountable gate is approved.

### B3.3 — Database production operations and recovery

Tasks:

1. Confirm Neon region, compute, connection limits, pooled/direct behavior, PITR window, backup retention, restore granularity, network controls, and support commitments for the purchased plan.
2. Configure least-privilege runtime roles, migration role, pool budgets by web/worker/region, statement timeout, lock timeout, and transaction-duration limits.
3. Add dashboards/alerts for connection saturation, slow queries, locks, deadlocks, transaction age, storage/compute, replica/provider state, and migration status.
4. Establish regular maintenance/statistics/index review and production-like query-plan regression evidence.
5. Set initial RPO ≤15 minutes and RTO ≤4 hours only if vendor/application evidence supports them.
6. Perform a restore into an isolated project. Validate release startup, schema, tenant/property counts, key foreign keys, outbox/workflow state, encrypted token handling, lifecycle/expiry, and representative read-only journey.
7. Decide whether an independent encrypted logical backup is permitted and useful. Its lifecycle and region must not violate Google/privacy deletion rules.
8. Schedule quarterly restore exercises and after material persistence/topology changes.

Acceptance evidence:

- documented restore achieves measured RPO/RTO and passes integrity checks;
- runtime credentials cannot migrate/drop schema and are restricted to their data plane;
- database saturation produces actionable alert/degradation rather than retry amplification;
- backup restore cannot re-expose expired/purged source content without mandatory lifecycle reconciliation.

### B3.4 — Redis/BullMQ production operations

Tasks:

1. Provision durable queue Redis with private networking, TLS, ACLs, persistence/HA, `noeviction`, memory/headroom alarms, and tested restore/failover behavior.
2. Provision cache/rate-limit Redis separately with explicit eviction/failure policy.
3. Dashboard per queue: waiting/active/delayed/completed/failed/stalled, oldest age, duration percentile, retry rate, heartbeat, concurrency, memory/persistence, and dead-letter count.
4. Alert against user outcomes/age, not every job exception. Separate urgent review, publish, projection, import, and maintenance targets.
5. Run worker-kill, Redis latency/loss, poison job, backlog, deploy-with-active-job, graceful termination, redrive, and cancellation exercises.
6. Retain failed-work evidence long enough to investigate while enforcing source-content minimization/expiry.
7. Build audited operator commands for inspect, pause by queue/property/region, quarantine, redrive, and cancel.

Acceptance evidence:

- no accepted outbox intent disappears through Redis/worker failures;
- queue outage and recovery meet backlog/freshness objectives without duplicate effects;
- cache loss affects performance only, never authorization/correctness;
- runbook operator can identify and safely redrive a failure without raw Redis editing.

### B3.5 — Provider-neutral observability and privacy-safe telemetry

Tasks:

1. Instrument OpenTelemetry-compatible traces/metrics/log correlation for:
   - web request and server function;
   - authorization/capability decision result class;
   - database query/transaction class;
   - outbox relay and BullMQ enqueue/process/retry;
   - Pub/Sub receipt-to-review commit;
   - Google connect/import/sync/publish/reconcile;
   - email/upload only if enabled;
   - retention/purge and deployment version.
2. Carry request/event/trace ID across durable rows/jobs. Use internal organization/property IDs only in restricted logs/traces where needed.
3. Implement unit-tested telemetry allowlists/redaction. Prohibit raw review/reply text, reviewer names/photos, email, OAuth token, cookie, request body, URL query, provider payload, presigned URL, and arbitrary error message.
4. Keep metric labels bounded: service, environment, route template, queue/job type, dependency, region, result/error class, capability—not user/review/job/property identifiers.
5. Pin semantic-convention version and record sampling, retention, region, access control, deletion, and cost budgets.
6. Add release/config/schema versions to diagnostics and traces.

Acceptance evidence:

- seeded secrets/personal/source content fail redaction tests and never reach the test collector;
- one journey can be correlated browser/web/outbox/job/provider/projection without using raw content;
- telemetry cardinality/load remains bounded at target scale;
- operator access to telemetry is least-privilege and audited.

### B3.6 — Health, synthetics, dashboards, and alerting

Create three distinct surfaces:

- **liveness:** process/event loop alive; no remote checks;
- **readiness:** this replica can accept its intended traffic with only mandatory dependencies;
- **private diagnostics/metrics:** detailed dependency, queue, route, worker, build, and policy state.

Tasks:

1. Configure Railway activation healthcheck to readiness; do not mistake it for continuous monitoring.
2. Add independent external synthetics for authenticated critical shell/API and, where safe, a synthetic property/review workflow using generated data.
3. Add internal freshness checks for Pub/Sub accepted → committed, committed → inbox, projection lag, reply intent → terminal, retention overdue, subscription health, and reconciliation watermark.
4. Dashboard user-centered SLIs from the master plan and dependency diagnostics separately.
5. Alert with multi-window burn/age thresholds, severity, owning service/region/property-safe identifiers, and runbook link.
6. Test every page/alert route through controlled fault injection; delete unactionable/noisy alerts.
7. Add a daily beta health digest to the internal operator channel only after it can be generated without source content leakage.

Acceptance evidence:

- each P0/P1 failure scenario produces one actionable alert to the correct owner;
- readiness removes a bad web release from activation while liveness does not flap on optional dependency loss;
- synthetic and real-property SLIs are clearly separated;
- normal load produces no unexplained alert noise for the observation window.

### B3.7 — Capacity, query, and degradation evidence

Build a repeatable production-like dataset generator with synthetic content only:

- 5,000 properties across multiple organizations/regions;
- users with 1, 100, and 5,000 accessible properties;
- at least 500,000 current/source review records plus lifecycle/workflow/projection rows;
- skewed properties (many reviews), long/translated text, varying source times/statuses;
- queue backlog/import checkpoints and expired/deleting records.

Load scenarios:

1. Connect/import several large properties concurrently with bounded provider fake.
2. Deliver 10x, 50x, and 100x average notification bursts with duplicates/out-of-order messages.
3. Run inbox/detail/property selector/dashboard reads during imports, projection catch-up, and retention deletion.
4. Add Google/Redis/database latency, 429/5xx, email/storage latency if enabled.
5. Deploy/terminate workers during active long jobs and web during active sessions.
6. Refresh or rebuild approved read models while serving traffic.
7. Exercise multiple regions and organizations without cross-scope cache/query errors.

Tasks:

1. Define maximum page sizes, query counts, payloads, server response, job start/complete, backlog recovery, and resource budgets.
2. Use `EXPLAIN (ANALYZE, BUFFERS)` for critical queries and record plans/indexes against production-like cardinality.
3. Prove provider quota controls, per-property fairness, backpressure, and urgent-versus-import isolation.
4. Specify degradation:
   - cache down → uncached bounded core reads;
   - dashboard/read model stale → freshness warning, core review path continues;
   - Google down/quota → intents retained, imports throttled, status visible;
   - email/public optional down → core review path unaffected;
   - region unavailable → no cross-region failover; explicit unavailable state.
5. Estimate resource/cost envelopes by service/region and alerts for budget anomaly.

Acceptance evidence:

- master-plan latency/freshness objectives and documented resource budgets pass at target data and accepted bursts;
- no unbounded property/review collection or fleet scan sits on a request/urgent path;
- failure/degradation preserves canonical correctness and recovers backlog within accepted time;
- load report contains commands, revision, dataset, environment, raw results, query plans, bottlenecks, and capacity headroom.

### B3.8 — Security, privacy, and external-dependency operational proof

Tasks:

1. Complete the scoped ASVS evidence matrix and threat-model review after architecture stabilizes. Run static/dependency/secret scans and targeted authorization/public/upload tests.
2. Have an independent engineer review tenancy, Google reply, token/crypto, webhook, upload/SSRF, deletion, and deployment controls. Commission external penetration testing before external customer beta; consider it strongly for internal real-data beta if accessible.
3. Rotate beta credentials and encryption keys in a drill; prove session/token/provider revocation.
4. Exercise Google quota exhaustion/suspension, notification backlog/DLQ/replay, revoked OAuth, ambiguous publish, and disconnect.
5. Exercise personal-data/security incident flow: identify properties/data/processors, contain, preserve evidence, communicate, and evaluate required notification deadlines.
6. Review data map, subprocessors, retention/deletion evidence, operator access, regional transfer, beta agreement, and Google disposition immediately before each new data region/cohort.
7. Verify production has no real source content in development/test/Storybook/traces/screenshots/support exports.

Acceptance evidence:

- no unresolved P0/P1 security/policy finding; accepted lower-risk findings have owner/expiry/mitigation;
- key/token/session revocation meets documented objective;
- retention/purge and incident exercises account for downstream/backup/telemetry copies;
- real-property go/no-go has accountable privacy/security/Google sign-off.

### B3.9 — Runbooks, support tools, and exercises

Minimum runbooks:

- account compromise and session revoke;
- OAuth token/key compromise and re-encryption;
- Google API suspension, permission loss, or quota exhaustion;
- Pub/Sub backlog, DLQ, replay, and unknown location;
- import stuck/partial and reconciliation gap;
- ambiguous or duplicate reply investigation;
- Redis loss, backlog, poison job, and worker saturation;
- database saturation, failed migration, rollback, restore, and integrity check;
- Resend outage/bounce spike and suppression, if enabled;
- object exposure/upload/SSRF, if enabled;
- leaked secret, tenant-data incident, and privacy request;
- property suspend/disconnect/archive/purge;
- region outage without prohibited failover.

Each runbook contains trigger/symptoms, impact, prerequisites/access, safe diagnostics, containment/kill switch, recovery, verification, escalation/communication, evidence to retain, and post-incident tasks.

Required exercises before first real property:

1. deployment rollback;
2. isolated database restore;
3. revoked secret/token;
4. worker kill/redelivery and Redis interruption;
5. webhook duplicate/replay and DLQ;
6. property disconnect/purge dry run with synthetic data;
7. security/privacy tabletop.

Before controlled publish, add ambiguous-provider-outcome and duplicate-prevention drills.

### B3.10 — Staged pilot and go/no-go

#### Stage 0 — Local/CI synthetic

Entry: BETA-0 baseline.  
Operate: disposable data/dependencies and fault suites.  
Exit: deterministic build/migration/security/core workflow evidence.

#### Stage 1 — Production synthetic

Entry: BETA-1 synthetic and required BETA-2 path green.  
Operate: synthetic org/property/reviews; real production topology, queues, monitoring, backups; Google content and external email/publish off.  
Exit: deploy, rollback, restore, queue, retention/purge, alerts, support commands, and regional routing work.

#### Stage 2 — One owned US property, shadow/read-only

Entry requires:

- accepted ADR 0031 and verification evidence implement Google's received per-property permission plus conservative raw-cache, backup/log, and lifecycle controls;
- demonstrable authority for the property and approved Google project/scopes/quota;
- approved privacy/beta agreement/data map/operator roster/US route;
- PRE17A/B and BETA-1 connection/import/lifecycle/disconnect gates;
- on-duty engineering/property owners and immediate kill switches.

Operate: sync/read/triage only; publish off. Review health daily.  
Exit: freshness/reconciliation, permission changes, expiry/deletion, disconnect/reconnect, support, and no leakage/policy events accepted.

#### Stage 3 — Controlled human publication

Entry: reply saga/failure/reconciliation evidence and named managers; operator present.  
Operate: a small number of deliberate replies; inspect every workflow/Google result.  
Exit: correct success/failure/unknown handling, no duplicate/unauthorized action, property owner accepts UX.

#### Stage 4 — Three to five US properties

Entry: first property Stage 3 accepted; cohort properties/owners/routes allowlisted.  
Operate: daily go/no-go and SLO/error-budget review, support log, controlled capability set.  
Exit: at least 14 observed days without unresolved P0/P1 security, data-loss, duplicate-side-effect, or Google-policy event; runbook and product feedback incorporated.

#### Stage 5 — Broader internal beta

Entry: final acceptance matrix/go-no-go signed. EU properties remain blocked until their separate regional/privacy/data-plane gate.  
Operate: broader allowlist with the same capability controls and weekly review.  
Exit: four-week stability/product acceptance informs any external beta and only then reopens Phase 17/18 planning.

Automatic stop at every stage:

- confirmed/potential cross-tenant exposure;
- unauthorized or duplicate external action;
- unexplained committed-data loss or inability to restore;
- leaked token/secret/source content;
- Google/vendor/privacy policy violation;
- routing to an unapproved region/provider;
- kill switch or operator visibility unavailable during incident.

Stopping preserves canonical data/evidence, disables new work, drains or quarantines safely, and opens incident review. It does not delete logs/evidence or silently fail over regions.

## 5. Initial SLOs and release policy

| Outcome                                    | Objective                                                                        | Alert/release consequence                          |
| ------------------------------------------ | -------------------------------------------------------------------------------- | -------------------------------------------------- |
| Authenticated critical availability        | 99.5% rolling 28 days                                                            | Burn-rate alert; stop expansion when exhausted     |
| Healthy review freshness                   | 95% ≤15 min, 99% ≤60 min from Google availability/receipt as separately measured | Age alert; throttle imports before urgent path     |
| Accepted reply workflow                    | 99% correct terminal result ≤10 min                                              | P1 if widespread; any duplicate/unauthorized is P0 |
| Queue start                                | 99% within per-class target                                                      | Alert oldest age per queue                         |
| Transactional email acceptance, if enabled | 99% valid intents accepted ≤5 min                                                | Provider acceptance is not inbox delivery          |
| Backup recovery                            | RPO ≤15 min, RTO ≤4 h                                                            | Must be demonstrated, not configured only          |
| Authorized deletion                        | 99% internal target; 100% legal/vendor deadline                                  | Overdue lifecycle alert; expansion blocked         |

Use error budgets to prioritize reliability work. Do not set a 100% availability promise; do not budget correctness/security invariants.

## 6. Evidence package and ownership

The go/no-go packet links immutable or dated artifacts:

- source revision, SBOM, scans, approved exceptions;
- clean install/upgrade and production artifact smoke;
- destructive-test isolation proof;
- authorization/capability and cross-tenant report;
- preserved Google response, accepted ADR 0031, and implemented/tested policy mapping;
- migration/schema/query/load evidence;
- queue/webhook/import/publish failure reports;
- regional data-flow and route tests;
- data map/notices/agreements/subprocessor/retention approvals;
- accessibility/browser/performance reports;
- telemetry redaction, dashboards, alerts, synthetic checks;
- restore/rollback/key rotation/worker kill/replay/tabletop exercise notes;
- pilot property authorization, owner roster, support schedule, stage journal;
- exception register with severity, rationale, mitigation, owner, expiry, rollback.

The release chair must be someone empowered to say no. Engineering, product/property, and privacy/security owners sign independently; silence is not approval.

## 7. Sequence and estimates

| Order | Work package                               |             Estimate | Dependency                      |
| ----: | ------------------------------------------ | -------------------: | ------------------------------- |
|     1 | B3.1 deploy/release topology               |           1.5–2 days | BETA-0 build/migrations         |
|     2 | B3.2 regional environment/routing          |             1–2 days | BETA-1 processing profile       |
|     3 | B3.3 DB recovery and B3.4 queue operations |             2–3 days | Production resources            |
|     4 | B3.5 telemetry and B3.6 health/alerts      |             2–3 days | Stable runtime contracts        |
|     5 | B3.7 capacity/query/degradation            |             2–3 days | Synthetic generator/read models |
|     6 | B3.8 security/privacy proof                | 1–2 days engineering | Stable release candidate        |
|     7 | B3.9 runbooks/exercises and B3.10 go/no-go | 1–2 days engineering | All evidence; calendar drills   |

Provisioning, AI-provider approval, any narrow Google follow-up, legal/privacy review, penetration testing, and the 14-day/four-week observation windows are calendar dependencies outside engineering estimates. The general Google architecture clarification has been received.

## 8. Exit gate

BETA-3 and beta readiness close only when:

- separate, reproducible web/worker/release topology deploys, rolls back, and passes readiness;
- property-region routing covers every data/queue/telemetry/backup/provider path with no silent fallback;
- restore, worker-kill/redelivery, webhook replay, secret revoke, rollback, disconnect/purge, and incident drills pass;
- privacy-safe telemetry, SLOs, synthetics, dashboards, actionable alerts, and support commands operate in production;
- target-cardinality/burst/degradation tests meet documented budgets and show headroom;
- one owned US property completes shadow and controlled publication;
- three to five US properties operate for at least 14 stable observed days without unresolved P0/P1 events;
- the complete evidence packet and every time-bound exception receive explicit go/no-go approval.

This gate qualifies an internal beta, not an external production launch and not Phase 17/18. Google permission has been received for the submitted architecture; AI planning begins only on product instruction, and release still requires the real-review foundation, ADR 0031, regional/provider/privacy controls, and beta operational evidence.
