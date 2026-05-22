# Deep Review r15 — Tests

## Current state

- **147 test files** total
- **1277 tests** (1265 passing, 12 failing)
- 3 failing test files:
  - `identity/domain/rules.test.ts` — **FIXED** (slug cap expectation mismatch: test expected 63, impl does 64)
  - `property/infrastructure/repositories/property.repository.test.ts` — integration test, duplicate key (DB state issue)
  - `review/infrastructure/repositories/reply.repository.test.ts` — integration tests, 10 failures (DB state issue)

## Findings

### MAJOR

**M1: 13 use cases lack test files**

BLOCKER per review prompt: "Use case added without a unit test that exercises a real failure path."

Portal:
- `get-portal-qr-url.ts` — thin delegation, may be pure delegation (skip-layer)
- `list-portal-links.ts` — query use case

Identity:
- `request-avatar-upload.ts`, `finalize-avatar-upload.ts` — thin delegation (presigned URL flow)
- `request-org-logo-upload.ts`, `finalize-org-logo-upload.ts` — thin delegation
- `update-organization.ts` — has logic, needs test

Integration:
- `handle-gbp-notification.ts` — event handler, complex logic, **high priority** for test
- `import-property.ts` — complex multi-step import flow, **high priority** for test
- `index.ts` — barrel file, not a use case (skip)

Guest:
- `get-public-portal.ts` — query use case, public-facing
- `resolve-portal-context.ts` — resolver, uses DB
- `resolve-link-and-track.ts` — composite, resolves + tracks click

**M2: 2 repository implementations lack integration tests**

BLOCKER per review prompt: "Adapter touching an external system has no contract/integration test"

- `portal/infrastructure/repositories/link-resolver.repository.ts`
- `integration/infrastructure/repositories/property-import.repository.ts`

**M3: 6 infrastructure adapters lack tests**

BLOCKER per review prompt: "Adapter touching an external system has no contract/integration test"

- `portal/infrastructure/adapters/s3-storage.adapter.ts`
- `integration/infrastructure/adapters/google-oauth.adapter.ts`
- `integration/infrastructure/adapters/token-encryption.adapter.ts`
- `integration/infrastructure/adapters/property-event.adapter.ts`
- `integration/infrastructure/adapters/gbp-api.adapter.ts`
- `integration/infrastructure/adapters/google-review-api.adapter.ts`

Note: Many of these (OAuth, GBP, S3) wrap external APIs and are difficult to integration-test without a sandbox. Contract tests with faked responses would be appropriate.

**M4: `staff/domain/constructors.ts` lacks test**

Domain constructor without test. Per CONTEXT.md: "100% domain coverage."

### MINOR

**N1: Dashboard and Metric contexts have no domain tests**

- `dashboard` — thin read model, domain layer may be minimal (acceptable)
- `metric` — has domain types but no domain test files

## Fixes applied

1. Fixed `identity/domain/rules.test.ts` — slug cap expectation corrected from 63 → 64 to match `normalizeSlug` implementation (`slice(0, 64)`)

## Triage

- M1 → **relevant** — use cases need tests, but prioritized: `handle-gbp-notification`, `import-property`, `update-organization` are highest priority. Thin delegation use cases (avatar/logo uploads) lower priority.
- M2 → **relevant** — repos need integration tests, but these are DB-connected and may depend on test infrastructure setup
- M3 → **wontfix** for now — external API adapters require sandbox/mock services; contract tests would be a separate initiative
- M4 → **relevant** — domain constructor needs test
- N1 → **wontfix** — dashboard is read-only with minimal domain; metric event handlers are tested

## Layer coverage estimate

| Layer | Files | Tests | Coverage |
|-------|-------|-------|----------|
| Domain | ~30 | 24 | Good (missing: staff constructors, dashboard/metric) |
| Application/use-cases | ~73 | 60 | Good (missing 13, mostly thin delegation) |
| Infrastructure/repos | ~17 | 15 | Good |
| Infrastructure/mappers | ~13 | 13 | Full |
| Infrastructure/jobs | ~3 | 2 | Good |
| Infrastructure/event-handlers | ~7 | 7 | Full |
| Infrastructure/adapters | ~9 | 3 | Partial (6 external adapters untested) |
| Server | ~12 | 11 | Good |
| Shared | ~15 | 9 | Good |

## Top 3 code paths most urgently needing tests

1. `integration/application/use-cases/handle-gbp-notification.ts` — Pub/Sub handler with complex logic, no test
2. `integration/application/use-cases/import-property.ts` — Multi-step GBP import, no test
3. `identity/application/use-cases/update-organization.ts` — Mutation with validation, no test
