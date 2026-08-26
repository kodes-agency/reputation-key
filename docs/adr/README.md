# Architecture Decision Record index

This index is the navigation authority for active ADRs. Decision precedence is:
external obligations, the approved product contract, accepted superseding ADRs,
active standards, executable enforcement, then legacy implementation notes. A
file remaining in this directory does not make every historical clause current.

Statuses are taken from each ADR. Older ADRs that use `Implemented` or omit YAML
frontmatter are retained as historical accepted decisions unless a superseding
ADR below narrows them. Missing number ranges (`0023–0029`, `0034–0037`) were
never issued; numbers are not reused.

| ADR                                                                       | Decision                               | Current disposition                                     |
| ------------------------------------------------------------------------- | -------------------------------------- | ------------------------------------------------------- |
| [0001](0001-dynamic-access-control.md)                                    | Dynamic access control                 | Historical; constrained by 0033, 0047, and 0052         |
| [0002](0002-section-based-navigation.md)                                  | Section-based navigation               | Active with beta capability/role constraints            |
| [0003](0003-review-bounded-context.md)                                    | Review bounded context                 | Partially superseded by 0030, 0031, and 0055            |
| [0004](0004-inbox-bounded-context.md)                                     | Inbox bounded context                  | Partially superseded by 0055                            |
| [0005](0005-gbp-review-api-fix.md)                                        | GBP Review API path/error model        | Historical implementation decision                      |
| [0006](0006-staff-bounded-context.md)                                     | Staff bounded context                  | Partially superseded by 0052                            |
| [0007](0007-dashboard-read-only-aggregation.md)                           | Read-only Dashboard aggregation        | Active, subject to governed metrics                     |
| [0008](0008-cross-context-boundaries.md)                                  | Cross-context data access              | Active                                                  |
| [0009](0009-permission-model.md)                                          | Permission model                       | Partially superseded by 0033 and 0052                   |
| [0010](0010-activity-bullmq-delivery.md)                                  | Activity BullMQ delivery               | Active only with durable-fact ownership in 0030/0056    |
| [0011](0011-notification-bullmq-delivery.md)                              | Notification BullMQ delivery           | Active with 0046 and durable outbox requirements        |
| [0012](0012-nitro-dev-mode-exclusion.md)                                  | Nitro dev-mode exclusion               | Active implementation decision                          |
| [0013](0013-portal-groups-replace-team-staff-scope.md)                    | Portal Groups replace people scopes    | Partially superseded by 0052; Teams are not beta-active |
| [0014](0014-badges-and-leaderboards-separate-contexts.md)                 | Recognition context separation         | Historical; activation constrained by the beta contract |
| [0015](0015-import-protection-server-only-leak.md)                        | Server-only import protection          | Active                                                  |
| [0016](0016-active-property-url-query-param.md)                           | Active Property URL state              | Active implementation decision                          |
| [0017](0017-injectable-clock.md)                                          | Injectable clock                       | Active                                                  |
| [0018](0018-injectable-container.md)                                      | Injectable container                   | Active                                                  |
| [0019](0019-simulation-harness.md)                                        | Deterministic simulation harness       | Active                                                  |
| [0020](0020-progress-only-goal-model.md)                                  | Progress-only Goal model               | Superseded by 0042                                      |
| [0021](0021-leaderboard-remove-composite-add-matrix.md)                   | Leaderboard metrics                    | Historical; recognition constrained by beta contract    |
| [0022](0022-notification-resource-resolved-at-creation.md)                | Notification resource resolution       | Active with 0046                                        |
| [0030](0030-identifier-only-domain-events-and-outbox.md)                  | Content-minimal durable facts          | Active                                                  |
| [0031](0031-google-source-content-and-ai-processing-boundary.md)          | Google/AI content boundary             | Active with 0054/0055                                   |
| [0032](0032-beta-capability-and-cohort-controls.md)                       | Capability/cohort controls             | Active                                                  |
| [0033](0033-authorization-policy.md)                                      | Authorization policy                   | Active                                                  |
| [0038](0038-beta-service-objectives-and-recovery.md)                      | Beta service objectives/recovery       | Active internal targets, not customer SLA               |
| [0039](0039-people-access-and-attribution.md)                             | People/access/attribution separation   | Partially superseded by 0052                            |
| [0040](0040-portal-and-group-history.md)                                  | Portal/Group event-time history        | Active                                                  |
| [0041](0041-governed-metric-registry.md)                                  | Governed Metric registry               | Active                                                  |
| [0042](0042-goal-measure-kinds.md)                                        | Goal measure kinds                     | Active                                                  |
| [0043](0043-worker-recognition-boundary.md)                               | Worker recognition boundary            | Historical; beta activation remains deferred/controlled |
| [0044](0044-public-portal-and-guest-response.md)                          | Public Portal/Guest policy             | Active with the approved Portal/Guest contract          |
| [0045](0045-activity-audit-and-domain-events.md)                          | Activity/audit/event separation        | Partially superseded by 0056                            |
| [0046](0046-notification-policy.md)                                       | Notification categories/channels       | Active                                                  |
| [0047](0047-persisted-policy-state.md)                                    | Persisted policy state                 | Active                                                  |
| [0048](0048-property-region-routing.md)                                   | US-only ProcessingRegion routing       | Superseded by 0054                                      |
| [0049](0049-beta-local-acceptance.md)                                     | Local controlled-beta acceptance       | Active as local evidence only                           |
| [0050](0050-google-import-and-live-performance.md)                        | Google import/live Performance         | Active with 0053–0055                                   |
| [0051](0051-release-identity-and-canary-ergonomics.md)                    | Release identity/canary ergonomics     | Active                                                  |
| [0052](0052-beta-people-access-attribution-and-manager-responsibility.md) | Beta people/access/responsibility      | Active                                                  |
| [0053](0053-production-redis-workload-isolation.md)                       | Production Redis isolation             | Active                                                  |
| [0054](0054-data-cell-catalogue-and-routing.md)                           | Data Cell catalogue/routing            | Active; supersedes 0048                                 |
| [0055](0055-stable-review-and-inbox-handling-cycles.md)                   | Stable Review and Handling Cycles      | Active; supersedes parts of 0003/0004                   |
| [0056](0056-operational-action-history-integrity-claims.md)               | Honest action-history integrity claims | Active; supersedes part of 0045                         |

When an ADR is added, removed, or renamed, update this table in the same change.
Supersession must name the exact retained and replaced decisions; do not delete
historical ADRs to make the current architecture appear simpler.
