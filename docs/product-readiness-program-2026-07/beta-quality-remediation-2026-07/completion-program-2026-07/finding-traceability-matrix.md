# BQC Finding Traceability Matrix

**Source:** [BQR implementation validation report](../bqr-implementation-validation-report-2026-07-16.md)  
**Rule:** a finding is closed only by the listed behavioral evidence, not by a merged PR or updated prose.

> STD-P1-07 was discovered during BQC-0.3 implementation (2026-07-17), not in the 2026-07-16 report: the `nitro/vite` production build does not auto-discover `server/plugins/`, so `security-headers.ts` (B0.7) never executes — production responses carry no CSP/HSTS/X-Frame-Options/X-Content-Type-Options/Referrer-Policy/Permissions-Policy (verified against the built `.output` bundle and a live booted server). Any control relying on the Nitro plugin lifecycle, including web process-startup assertions, is inert.

## Standards-adherence findings

| Finding                                               | Severity | Primary phase | Supporting phase | Required closure evidence                                                                                                                                                                                          |
| ----------------------------------------------------- | -------- | ------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| STD-P0-01 Portal writes authorized by read            | P0       | BQC-0         | BQC-2, BQC-6     | Independent read/write/upload capability mapping; blocked-capability negative matrix across route/server/job/worker; production config assertion                                                                   |
| STD-P0-02 Projection and receipt separate             | P0       | BQC-3         | BQC-6, BQC-8     | Real PostgreSQL crash-boundary test proving projection+receipt co-commit for every enabled consumer                                                                                                                |
| STD-P1-01 Application imports outbox infrastructure   | P1       | BQC-3         | BQC-5            | Context command interfaces own transactions/outbox; forbidden-import gate; legacy barrel imports removed from application code                                                                                     |
| STD-P1-02 Property authorization absent/fail-open     | P1       | BQC-2         | BQC-6            | PropertyAccessGrant-backed decision context; missing scope data denies; cross-property matrix through production composition                                                                                       |
| STD-P1-03 Protected content in events/activity        | P1       | BQC-1         | BQC-3, BQC-5     | Registered event/job schemas identifier-only; database scan and retention tests show no note/email/reason/review content copies                                                                                    |
| STD-P1-04 Public metrics route queries DB             | P1       | BQC-5         | BQC-7            | Route calls `OperationsSnapshot`; detailed endpoint private; public liveness exposes no dependency/tenant diagnostics                                                                                              |
| STD-P1-05 Green browser gates through errors          | P1       | BQC-6         | BQC-8            | Deliberate uncaught error/console error/a11y violation makes each authoritative gate fail; failure artifacts retained                                                                                              |
| STD-P1-06 Architecture tests prove presence only      | P1       | BQC-5         | BQC-6            | Composition/runtime behavior tests; semantic schema verification; no source scan is sole proof of a beta invariant                                                                                                 |
| STD-P1-07 Nitro server plugins inert in builds        | P1       | BQC-7         | BQC-6            | Built server serves the full B0.7 header set on every response (verified against the artifact); CI header assertion fails when any header is absent; plugin mechanism repaired or replaced with proof of execution |
| STD-P2-01 Node crypto in review domain/client         | P2       | BQC-5         | BQC-6            | Runtime-neutral domain; client build/import-boundary test; critical E2E has zero browser errors                                                                                                                    |
| STD-P2-02 Schema differs semantically from migrations | P2       | BQC-5         | BQC-6            | Metadata/generated-SQL comparison covers index order/predicates, constraints, defaults, FKs, and all migrations                                                                                                    |
| STD-P2-03 Composition/worker shotgun surgery          | P2       | BQC-5         | BQC-3            | Per-context runtime modules; adding a context job edits its module plus one composition registry only; characterization test                                                                                       |
| STD-P2-04 Ambient clocks in decisions                 | P2       | BQC-5         | BQC-6            | Injected clock/explicit `now` on replayable/domain paths; deterministic time-boundary tests                                                                                                                        |
| STD-P2-05 Dead code, complexity, duplication          | P2       | BQC-5         | BQC-6            | Triage register closed; enabled paths meet health/complexity budgets; confirmed unused controls/stale suppressions removed; duplication <7%                                                                        |
| STD-P2-06 Non-hermetic test/dev config                | P2       | BQC-6         | BQC-7            | Clean clone commands pass without providers/secrets; route candidates excluded; test email adapter local; no accidental network                                                                                    |

## Plan/specification-adherence findings

| Finding                                                 | Severity | Primary phase | Supporting phase | Required closure evidence                                                                                                                                             |
| ------------------------------------------------------- | -------- | ------------- | ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SPEC-P0-01 Durable runtime only a tracer bullet         | P0       | BQC-3         | BQC-5, BQC-8     | All enabled producer/consumer families atomic; retry taxonomy; crash/duplicate/reorder/poison/stalled/redrive suite; authoritative durable path                       |
| SPEC-P0-02 Google lifecycle/retention incomplete        | P0       | BQC-1         | BQC-3, BQC-8     | Field-copy inventory; successful-fetch clock; eligible reads; cursor refresh/purge; transactional scrub/delete; outbox/job/log/cache/backup rules; target-scale proof |
| SPEC-P0-03 Policy not authoritative everywhere          | P0       | BQC-2         | BQC-4, BQC-6     | Persisted allowlist/suspension/grant/consent; execution-time checks for routes/commands/workers/consumers/schedules/operators; dark matrix                            |
| SPEC-P1-01 Region is metadata only                      | P1       | BQC-4         | BQC-7, BQC-8     | Property decision selects queue/worker/data/provider cell; unresolved/unavailable fails closed; no-fallback fault test and evidence                                   |
| SPEC-P1-02 Jobs silently acknowledge failures           | P1       | BQC-3         | BQC-7, BQC-8     | Unknown job fails/quarantines; transient failures retry; terminal failures recorded; redrive/operator tests                                                           |
| SPEC-P1-03 BQR-5 evidence shallow/blind                 | P1       | BQC-6         | BQC-8            | Meaningful enabled-flow mutations; dark negative tests; full suite hard/green; uncaught/console/network failures block                                                |
| SPEC-P1-04 BQR-6 is templates, not proof                | P1       | BQC-8         | BQC-7            | Executed target-scale, burst/backlog, provider throttle, fault, restore, RPO/RTO, and region evidence                                                                 |
| SPEC-P1-05 Production topology/observability incomplete | P1       | BQC-7         | BQC-8            | Repeatable web/worker/container topology; private diagnostics; alerts/runbooks/operator commands exercised                                                            |
| SPEC-P1-06 Security/release gates missing               | P1       | BQC-7         | BQC-8            | Dependency/license/secret/static/container/artifact scans; SBOM; immutable release manifest and sign-off validation                                                   |
| SPEC-P2-01 Status documents contradictory               | P2       | BQC-0         | BQC-8            | One generated/evidence-aware status manifest; historical documents linked but not used as live completion truth                                                       |
| SPEC-P2-02 Evidence does not prove candidate            | P2       | BQC-8         | BQC-9            | Complete release-evidence directory bound to one release identity, environment, results, exceptions, and approvals                                                    |

## Cross-context ownership

| Context      | Primary BQC work           | Acceptance evidence                                                       |
| ------------ | -------------------------- | ------------------------------------------------------------------------- |
| Identity     | BQC-2, BQC-5, BQC-6        | Invite/session/owner/property-grant and fail-closed cross-property tests  |
| Property     | BQC-2, BQC-4               | Persisted allowlist/suspension, lifecycle and processing-target decisions |
| Integration  | BQC-2, BQC-3, BQC-4, BQC-7 | OAuth/sync/webhook jobs retry-correct, policy/region-aware, observable    |
| Review       | BQC-1, BQC-3, BQC-5        | Source lifecycle, atomic commands, manual publication/reconciliation      |
| Inbox        | BQC-1, BQC-3, BQC-6        | Content governance, apply-once projections, meaningful triage E2E         |
| Dashboard    | BQC-1, BQC-5, BQC-7        | Governed bounded reads, cache/materialization and performance evidence    |
| Metric       | BQC-3, BQC-5               | Idempotent permitted rollups, no source/staff-gamification leakage        |
| Notification | BQC-1, BQC-3, BQC-7        | Content-free durable in-app delivery; outbound email denied               |
| Activity     | BQC-1, BQC-3, BQC-5        | Privacy-filtered facts, retention, audit separation                       |
| Staff        | BQC-2, BQC-5, BQC-6        | Participation cannot grant access; enabled slice browser coverage         |
| Team         | BQC-2, BQC-6               | Denied routes/commands/events/jobs/schedules; no positive beta E2E        |
| Portal       | BQC-0, BQC-2, BQC-6        | Independent denied read/write/upload/public surfaces                      |
| Guest        | BQC-2, BQC-5, BQC-6        | Public/session/media/submission paths denied; cross-context error removed |
| Goal         | BQC-2, BQC-5, BQC-6        | Dark execution matrix; complexity/clock cleanup without activation        |
| Badge        | BQC-2, BQC-5, BQC-6        | Evaluation/worker/event/config paths denied and deterministic             |
| Leaderboard  | BQC-2, BQC-5, BQC-6        | Read/recompute/event/export paths denied                                  |
| AI           | BQC-2, BQC-4, BQC-9        | All Phase 17/18 capabilities denied; clean governance/runtime handoff     |

## Closure workflow

1. A slice links one or more finding IDs.
2. The slice adds the required failing test before implementation.
3. The implementation is cut over and the superseded path is removed.
4. CI/staging evidence is attached to a release ID.
5. The phase owner marks the finding `implementation_complete`.
6. An independent reviewer verifies the stated evidence and marks it `accepted`.
7. BQC-8 verifies all accepted findings refer to the same candidate or a compatible, immutable predecessor artifact.
