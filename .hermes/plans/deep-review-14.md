# Deep Review r14 — Type Safety & Naming Conventions

## Findings

### BLOCKER

None in production code. All `as any` occurrences are in:
- `src/routeTree.gen.ts` — auto-generated file, excluded from review scope
- `src/contexts/guest/application/use-cases/track-review-link-click.test.ts:34` — test scaffolding (acceptable)

No `@ts-ignore` or `@ts-expect-error` found. No `enum` declarations (all `z.enum` Zod calls, which is correct). No `Function`/`Object`/`{}` type annotations in production code (`Object.freeze` is a runtime call, not a type).

### MAJOR

**M1: `as unknown as T` in production code — mappers should use `unbrand()`**

Branded IDs cast to `string` via `as unknown as string` instead of using the `unbrand()` helper from `shared/domain/ids.ts`.

Files:
- `src/contexts/portal/infrastructure/mappers/portal-link.mapper.ts:24-26, 52-55`
- `src/contexts/portal/infrastructure/mappers/portal.mapper.ts:70-74`
- `src/contexts/guest/infrastructure/repositories/guest-interaction.repository.ts:36, 38`
- `src/contexts/guest/infrastructure/resolvers/portal-context-resolver.ts:20`

Fix: Import `unbrand` from `#/shared/domain/ids` and use `unbrand(id)` instead of `id as unknown as string`.

**M2: `as unknown as T` for casting raw string to branded ID**

- `src/contexts/portal/infrastructure/jobs/process-image.job.ts:62` — `organizationId as unknown as OrganizationId` where `organizationId` is `string` from job data

Fix: Use `organizationId(organizationId)` constructor from `#/shared/domain/ids`.

**M3: `new Date()` in `process-image.job.ts:66`**

Uses `new Date()` directly instead of injected clock. Job handlers are infrastructure, so less critical than domain, but still an inconsistency.

Fix: Pass `clock` via deps or use the `now ?? new Date()` fallback pattern already used in other repos.

### MINOR

**N1: `export *` in barrel files**

Files:
- `src/components/features/integration/index.ts` (5 lines)
- `src/shared/db/schema/index.ts` (13 lines)
- `src/shared/db/schema/business.ts` (12 lines)

Per CONTEXT.md: "Named re-exports in barrel files (no `export *`)." The schema files are DB infrastructure barrels — low risk. The integration index is a component barrel.

**N2: Test files using `as unknown as` for mock creation**

~30+ instances in test files. Acceptable for test scaffolding. No fix needed.

## Plan

1. Fix M1: Replace `as unknown as string` with `unbrand()` in mappers and repos
2. Fix M2: Use branded ID constructor in `process-image.job.ts`
3. Fix M3: Add clock dep to `process-image.job.ts`
4. N1 (wontfix): DB schema barrels use `export *` extensively — standard Drizzle pattern, changing would add noise with no real benefit. Integration component barrel is low-risk.

## Triage

- M1, M2, M3 → **relevant** — real type safety issues, fixable with existing utilities
- N1 → **wontfix** — `export *` in DB schema files is standard Drizzle convention; not worth the churn
- N2 → **wontfix** — test scaffolding, acceptable per review prompt
- `routeTree.gen.ts` `as any` → **outdated-doc** — auto-generated, not reviewable
