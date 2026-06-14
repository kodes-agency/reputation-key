# Badge Context

Metric-driven recognition awards earned by portals and portal groups when criteria are met.

## Glossary

| Term                            | Definition                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **BadgeDefinition**             | A reusable badge rule with criteria, target scope, name, icon, and enabled state. System-seeded and org-enabled, not manager-edited. |
| **BadgeCriteria**               | The metric-driven condition for earning a badge. Supports threshold, streak, and milestone types with `>=` and `<=` operators.       |
| **BadgeAward**                  | An immutable historical fact: a specific portal or portal group earned a specific badge. Never revoked.                              |
| **OrganizationBadgeEnablement** | An org-level choice to enable or disable a system badge definition. Does not change criteria.                                        |
| **BadgeTargetType**             | `'portal'` or `'portal_group'`. Determines which entities can earn the badge.                                                        |
| **BadgeCriteriaVersion**        | Incremented only when the earning rule changes. Drives idempotency via `unique_key`.                                                 |
| **BadgeStreak**                 | A criterion requiring a target to be met on consecutive calendar days in the property timezone.                                      |

## Relationships

- BadgeDefinition → Organization (many-to-many via OrganizationBadgeEnablement).
- BadgeAward → BadgeDefinition (required `badgeDefinitionId`).
- BadgeAward → Property (required `propertyId`).
- BadgeAward → Portal (optional `portalId`, set when targetType is `portal`).
- BadgeAward → PortalGroup (optional `portalGroupId`, set when targetType is `portal_group`).
- Badge context **subscribes to** `metric.recorded` events from the metric context.
- Badge context **depends on** `MetricPublicApi` for querying metric aggregates and daily counts.
- Badge context **emits** `badge.awarded` events consumed by the notification context.

## Invariants

- Badge awards are immutable — never revoked on membership changes, definition disablement, portal soft-delete, or group soft-delete.
- Each award is unique per `badge_definition_id + criteria_version + target_type + target_id`.
- Only enabled definitions for the org are evaluated.
- Streak days are evaluated in the target portal's property timezone.
- Phase 16.2 badge criteria use portal-scoped metrics only.
- Phase 16.2 badges are one-time achievements per target — the same badge is not re-awarded in later periods.
- Disabling a definition prevents future awards but keeps existing awards visible.

## Events produced

| Tag             | Payload                                                                                                     | When                                 |
| --------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| `badge.awarded` | badgeDefinitionId, criteriaVersion, targetType, targetId, organizationId, propertyId, awardedAt, occurredAt | Badge evaluation inserts a new award |

## Events consumed

| Tag               | Source context | Handler action                                                       |
| ----------------- | -------------- | -------------------------------------------------------------------- |
| `metric.recorded` | metric         | Evaluate all enabled definitions for the event's portal/group target |

## Architecture layers

```
badge/
  domain/              types.ts, constructors.ts, events.ts, errors.ts, seed-badges.ts
  application/
    ports/             badge.repository.ts
    dto/               badge.dto.ts (Zod schemas)
    use-cases/         seed-badge-definitions.ts, evaluate-badge-for-target.ts, reconcile-badge-definitions.ts
    utils.ts           periodToRange, dayKeyInTimezone
    public-api.ts      re-exports DTO types, event types/constructors
  infrastructure/
    repositories/      badge.repository.ts (Drizzle)
    mappers/           badge.mapper.ts
  server/              badges.ts
  build.ts             composition root
```

## Use cases

| Use case                         | Input                                            | Output                        | Permission             |
| -------------------------------- | ------------------------------------------------ | ----------------------------- | ---------------------- |
| `seedBadgeDefinitions`           | —                                                | `BadgeDefinition[]`           | System (bootstrap)     |
| `evaluateBadgeForTarget`         | organizationId, propertyId, targetType, targetId | `BadgeEvaluationResult`       | System (event handler) |
| `reconcileBadgeDefinitions`      | organizationId?, propertyId?                     | `{ evaluated, awarded }`      | System (hourly job)    |
| `getStaffVisibleBadges`          | organizationId, userId, propertyId, limit?       | `BadgeAwardWithTarget[]`      | `badge.read`           |
| `getVisibleTargetBadges`         | organizationId, propertyId, targetType, targetId | `BadgeAwardWithTarget[]`      | `badge.read`           |
| `setOrganizationBadgeEnablement` | organizationId, badgeDefinitionId, enabled       | `OrganizationBadgeEnablement` | `badge.manage`         |

## Public API

Exported from `application/public-api.ts`:

- Types: `BadgeDefinition`, `BadgeAwardWithTarget`, `EvaluateBadgeForTargetInput`, `ReconcileBadgeDefinitionsInput`, `ReconcileBadgeDefinitionsResult`
- DTO types: `GetStaffVisibleBadgesInput`, `GetVisibleTargetBadgesInput`, `SetOrganizationBadgeEnablementInput`
- Event types: `BadgeAwarded`, `BadgeEvent`
- Event constructors: `badgeAwarded`

## Server functions

| Function                         | Method | Permission     | Route                       |
| -------------------------------- | ------ | -------------- | --------------------------- |
| `getStaffVisibleBadges`          | GET    | `badge.read`   | Staff home badge section    |
| `getVisibleTargetBadges`         | GET    | `badge.read`   | Portal detail badge section |
| `setOrganizationBadgeEnablement` | POST   | `badge.manage` | Badge settings (future)     |

## Permissions

| Permission     | AccountAdmin | PropertyManager | Staff |
| -------------- | ------------ | --------------- | ----- |
| `badge.read`   | ✓            | ✓               | ✓     |
| `badge.manage` | ✓            | ✓               | —     |

## Background jobs

- **badge.reconcile** — hourly job that re-evaluates all definitions for all portals and groups across all orgs. Catches missed events or failed evaluations.
