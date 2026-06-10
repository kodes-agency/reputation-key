# Baseline Report

**Date:** 2026-06-10
**Branch:** feat/workspace (main @ 4405bec)

## Tooling

| Check            | Result                             |
| ---------------- | ---------------------------------- |
| `pnpm typecheck` | ✅ Clean                           |
| `pnpm lint`      | ✅ Clean (eslint + filename check) |

## Global Census (non-test src/)

| Pattern                | Count | Notes                                                         |
| ---------------------- | ----- | ------------------------------------------------------------- |
| `as any`               | 44    | All in `src/routeTree.gen.ts` (auto-generated) → **excluded** |
| `@ts-ignore`           | 0     | —                                                             |
| `@ts-expect-error`     | 0     | —                                                             |
| `console.log`          | 0     | —                                                             |
| `TODO`                 | 3     | team/public-api, goal/create-goal, goal/spawn-recurring       |
| `FIXME`                | 0     | —                                                             |
| `HACK`                 | 0     | —                                                             |
| `as unknown as`        | 12    | See details below                                             |
| `throw new Error(...)` | 41    | Infrastructure/shared only — acceptable per conventions       |
| `eslint-disable`       | 37    | Mostly test files + 1 boundary bypass (webhook)               |

## Known Issues (pre-existing, not review findings)

### `as unknown as` (12 occurrences — potential type safety concern)

| File                                                        | Line     | Context                                |
| ----------------------------------------------------------- | -------- | -------------------------------------- |
| `portal/infrastructure/repositories/portal.repository.ts`   | 163      | Drizzle `execute()` return type        |
| `notification/domain/constructors.ts`                       | 83       | Empty ID placeholder                   |
| `notification/domain/constructors-email.ts`                 | 28       | Empty ID placeholder                   |
| `notification/domain/constructors-preference.ts`            | 37       | Empty ID placeholder                   |
| `activity/application/use-cases/insert-activity-log.ts`     | 75       | `'system' as unknown as UserId`        |
| `activity/domain/constructors.ts`                           | 92       | Empty ID placeholder                   |
| `dashboard/infrastructure/adapters/metric-stats.adapter.ts` | 97       | `portalIds as unknown as string[]`     |
| `goal/application/use-cases/create-goal.ts`                 | 137, 210 | `idGen() as unknown as GoalProgressId` |
| `shared/jobs/worker.ts`                                     | 37       | BullMQ connection type mismatch        |
| `shared/jobs/queue.ts`                                      | 37       | BullMQ connection type mismatch        |

### `throw new Error(...)` (41 occurrences — all in infrastructure/shared, acceptable)

Infrastructure adapters and repositories throwing on invariant violations. No occurrences in domain/application layers.

### `eslint-disable` in non-test files (7 occurrences)

| File                                            | Rule                      | Justification                                   |
| ----------------------------------------------- | ------------------------- | ----------------------------------------------- |
| `dashboard/domain/types.ts:7`                   | `boundaries/dependencies` | Needs review — domain shouldn't bypass boundary |
| `components/ui/color-picker.tsx:604`            | `no-empty-object-type`    | shadcn primitive — acceptable                   |
| `components/hooks/use-action.ts:27,29,47`       | `no-explicit-any`         | Universal function type — documented            |
| `components/hooks/use-mutation-action.ts:47,93` | `no-explicit-any`         | Same pattern                                    |
| `hooks/use-isomorphic-layout-effect.ts:1`       | `no-restricted-imports`   | Legitimate React import                         |
| `hooks/use-as-ref.ts:1`                         | `no-restricted-imports`   | Legitimate React import                         |
| `hooks/use-lazy-ref.ts:1`                       | `no-restricted-imports`   | Legitimate React import                         |
| `lib/compose-refs.ts:1`                         | `no-restricted-imports`   | Legitimate React import                         |
| `routes/api/webhooks/gbp/notifications.ts:12`   | `boundaries/dependencies` | Webhook route — documented bypass               |
| `routeTree.gen.ts:1`                            | all                       | Auto-generated                                  |

### TODOs (3)

| File                                                            | Line                              | Content |
| --------------------------------------------------------------- | --------------------------------- | ------- |
| `team/application/public-api.ts:12`                             | Expand with team lookup methods   |
| `goal/application/use-cases/create-goal.ts:221`                 | Template goal persistence         |
| `goal/infrastructure/jobs/spawn-recurring-instances.job.ts:106` | Replace with unique DB constraint |

## Context Structure Summary

| Context     | src files | domain | application | infrastructure | server | tests |
| ----------- | --------- | ------ | ----------- | -------------- | ------ | ----- |
| goal        | 30        | 5      | 8           | 8              | 7      | 17    |
| integration | 57        | 6      | 32          | 14             | 4      | 24    |
| portal      | 59        | 5      | 38          | 9              | 6      | 31    |
| inbox       | 45        | 5      | 18          | 14             | 6      | 21    |
| review      | 30        | 5      | 10          | 10             | 4      | 11    |
| identity    | 34        | 3      | 17          | 2              | 11     | 17    |
| dashboard   | 21        | 2      | 11          | 4              | 3      | 7     |
| staff       | 19        | 5      | 8           | 2              | 3      | 13    |
| property    | 19        | 5      | 9           | 2              | 2      | 12    |
| guest       | 26        | 5      | 14          | 4              | 2      | 14    |
| team        | 19        | 5      | 10          | 2              | 1      | 11    |
| metric      | 16        | 4      | 3           | 8              | 0      | 8     |
| activity    | 28        | 3      | 2           | 16             | 1      | 2     |
