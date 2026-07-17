# BQC-7 — Production Operations, Security, and Observability

**Status:** `not_started`  
**Estimate:** 8–13 engineering days  
**Dependencies:** BQC-3 through BQC-6  
**Unlocks:** production synthetic deployment and BQC-8 fault/recovery evidence

## 1. Outcome

Define and deploy a repeatable production-like topology with separate web and worker responsibilities, safe migrations, private operational diagnostics, actionable alerts, exercised operator controls, and blocking supply-chain/security gates. Every observation is content-safe and bound to release/policy/region identity.

## 2. Findings owned

- STD-P1-04 — public/internal metrics design, with BQC-5.
- STD-P1-07 — Nitro server plugins are inert in the production build, so intended response-header and startup controls do not execute.
- SPEC-P1-05 — topology/observability incomplete.
- SPEC-P1-06 — security/release gates missing.
- Operational support for SPEC-P1-02 and SPEC-P1-04.
- Resolution of intended-but-unused operational/security modules from STD-P2-05.

## Ownership mode

- Containers/deployment, health/metrics, alerts, operator commands, security controls/scans, and backup configuration: `IMPLEMENTS`.
- Operator commands `INTEGRATE` the accepted BQC-2 `ExecutionPolicy` and BQC-3 runtime interfaces; BQC-7 does not duplicate either implementation.
- BQC-8 `RE_EXECUTES` these same controls under integrated load, fault, restore, and final-artifact conditions.
- An integrated BQC-8 failure returns to BQC-7 (or the relevant product owner) for correction; BQC-8 does not create a second operations implementation.

## 3. Production topology

Codify, at minimum:

- web process/container;
- worker process/container with registered queues;
- scheduler/relay ownership, whether separate or a singleton worker role;
- PostgreSQL and migration/predeploy job;
- queue Redis and cache Redis separation if failure domains/SLOs require it;
- private object storage where enabled;
- region/cell configuration;
- secrets/config delivery and rotation;
- readiness/liveness/startup/shutdown behavior;
- replica/scaling and singleton-schedule guarantees;
- artifact digest and rollback target.

Use the current deployment platform where it meets these requirements. Do not introduce orchestration technology merely for architectural aesthetics.

## 4. Slices

### BQC-7.1 — Production containers and deployment contract

- Add reproducible, least-privilege, multi-stage web/worker container builds.
- Pin runtime/tool versions and use a frozen lockfile.
- Run as non-root with read-only filesystem where practical and explicit writable paths.
- Add graceful shutdown and queue drain behavior.
- Define predeploy migration with advisory lock/single execution and forward-recovery policy.
- Configure web/worker commands, health paths, replicas, restart policy, and region.
- Generate SBOM and artifact digest.

### BQC-7.2 — Health semantics

| Endpoint            | Audience                           | Semantics                                                                    |
| ------------------- | ---------------------------------- | ---------------------------------------------------------------------------- |
| Liveness            | Platform                           | Process event loop is alive; no DB/Redis dependency                          |
| Readiness           | Platform/private                   | Required DB/Redis/config/migration/worker registration usable within timeout |
| Startup             | Platform                           | Boot/migration/config initialization complete                                |
| Metrics/diagnostics | Private authenticated network/role | Detailed queues, freshness, versions, policies, failures; no content/PII     |

Routes call `OperationsSnapshot`; they do not construct DB/Redis readers. Decide whether worker heartbeat is part of web readiness or a separate alert—avoid making all web traffic unavailable solely because a non-critical worker is degraded.

### BQC-7.3 — Observability schema

Record low-cardinality metrics and structured traces/logs for:

- request rate/error/latency by route class, not tenant IDs as labels;
- DB pool/query budget and migration version;
- queue depth, oldest age, lag, active, retry, stalled, quarantined, redrive;
- worker heartbeat and registered job/runtime version;
- Google sync freshness, webhook dedupe, provider quota/throttle/reconnect;
- source refresh-due/expiry/purge backlog and failures;
- reply publication state and ambiguity/reconciliation age;
- policy denials/suspensions and region-routing failures by stable reason;
- cache hit/miss/staleness/eviction;
- release, capability, source-policy, and routing-policy versions.

Never label/log organization, property, user, review, event, job IDs, review/reply/note text, reviewer/email, tokens, cookies, headers, provider bodies, or presigned URLs unless a narrowly approved content-free correlation field is used.

### BQC-7.4 — Alerts and SLOs

**Mode:** `IMPLEMENTS` alert definitions, routing, runbooks, and focused synthetic injection. BQC-8 re-executes them during integrated fault/scale scenarios.

Define owner, severity, threshold/window, runbook, and test for:

- web/worker availability and latency;
- queue oldest age and stalled/quarantine growth;
- Google/source freshness approaching policy deadline;
- purge/retention failure;
- publication ambiguity;
- wrong/unresolved region attempts;
- repeated policy/config denial indicating deployment drift;
- DB/Redis capacity/connection exhaustion;
- backup/PITR failure;
- security scan or secret detection failure.

Use multi-window/burn-rate alerts where traffic supports it. Avoid paging on raw counts without impact. Every alert must be injected at least once before BQC-8 acceptance.

### BQC-7.5 — Operator commands and runbooks

Wire or remove the unused operator-command module. Required authenticated/idempotent operations include:

- pause/resume capability/workload by approved scope;
- quarantine/redrive a job/event;
- repair/rebuild an inbox/metric projection;
- reconcile ambiguous Google reply publication;
- re-run bounded refresh/purge;
- suspend/restore property processing;
- inspect routing/policy decision;
- rotate/revoke connection credentials;
- start restore/rollback according to runbook.

Commands require reason/correlation, dry-run where applicable, bounded scope, confirmation for destructive actions, and content-free audit results.

Every command passes a named operator principal and target resource through BQC-2 `ExecutionPolicy`. Commands that enqueue or redrive work use the BQC-3 runtime contract instead of invoking handlers or infrastructure directly.

### BQC-7.6 — Security hardening

- Repair or replace the inert Nitro-plugin integration; do not treat a source file under `server/plugins` as an active control without built-artifact proof.
- Wire the intended security-header/CSP behavior through a production-supported integration point and verify the complete B0.7 response-header set against the booted production artifact.
- Enforce trusted proxy/origin, body/time limits, request IDs, secure cookies/session settings, and rate controls appropriate to enabled surfaces.
- Verify OAuth state/PKCE/redirect allowlists, encrypted token lifecycle, key rotation, and log redaction.
- Restrict health/metrics/admin endpoints by network and/or strong authorization.
- Separate production/staging/test secrets and identities; validate startup configuration.
- Ensure exception/error responses expose no stack, SQL, secret, cross-tenant identifier, or protected content.
- Keep uploads/public guest/outbound non-auth email dark; remove unused dependencies if not needed for beta.

### BQC-7.7 — Supply-chain and security CI

**Mode:** `IMPLEMENTS` the hard gates and artifact generation. BQC-8 reruns the same gates against the immutable candidate; it does not maintain separate scan policy.

Hard-gate:

- dependency vulnerability policy;
- secret scanning including history/diffs where supported;
- static security analysis;
- license policy;
- lockfile integrity and pinned actions;
- SBOM generation;
- container/image and artifact-content scanning;
- production dependency/prune verification;
- migration artifact consistency.

Define severity/expiry policy without hiding a required scan behind `continue-on-error`.

### BQC-7.8 — Backups and lifecycle configuration

- Configure PostgreSQL PITR/backups, Redis durability where required, object lifecycle, log/trace retention, quarantine TTL, and evidence retention.
- Document region placement/encryption/access.
- Verify restored environments boot in isolated mode and run source-policy purge before serving.
- BQC-8 performs the timed restoration/recovery proof.

## 5. Tests

- Container runs as declared identity and exposes only intended files/ports.
- Graceful termination drains/stops accepting work within budget.
- Readiness fails for required dependency/config/migration mismatch; liveness remains shallow.
- Detailed metrics endpoint denies unauthenticated/public access.
- Seeded protected canaries do not appear in logs/traces/metrics/SBOM/evidence.
- Each alert is fault-injected and routes to the declared owner/test destination.
- Operator commands are authorized, bounded, idempotent, audited, and fail closed.
- Security headers/CSP, proxy/origin/body/time/session/OAuth tests run against production build.

## 6. Evidence

- Container digests, SBOM, scan reports, and deployment manifest.
- Production-like web/worker/migration deployment transcript.
- Health/metrics access and semantics results.
- Redaction/canary scan.
- Alert injection and runbook links.
- Operator-command rehearsal.
- Backup configuration and restore prerequisites.

## 7. Exit matrix

| Criterion                                                               | Required result |
| ----------------------------------------------------------------------- | --------------- |
| Reproducible production web/worker containers build                     | Pass            |
| Deployment defines migration, health, roles, replicas, shutdown, region | Pass            |
| Liveness/readiness/metrics semantics and access are correct             | Pass            |
| Required metrics/alerts exist and are injected                          | Pass            |
| Operator controls are wired, authorized, tested                         | Pass            |
| Security headers/config/OAuth/secrets/redaction pass                    | Pass            |
| Dependency/license/secret/static/container/artifact gates are hard      | Pass            |
| Backup/PITR and retention configuration is documented/active            | Pass            |

## 8. Out of scope

- Target-scale and timed restore proof (BQC-8).
- Public portal/guest/upload/email activation.
- Multi-cloud/microservice migration.
