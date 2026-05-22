# Architecture & Layer Integrity Audit

**Date:** 2026-05-22
**Scope:** 11 bounded contexts (dashboard, guest, identity, inbox, integration, metric, portal, property, review, staff, team)

---

## 1. Dependency Direction (domain ← application ← infrastructure ← server)

### Result: ✅ CLEAN — Zero violations

| Check | Pattern | Hits |
|-------|---------|------|
| Domain → Application | `from.*\.\./application` in `*/domain/` | 0 |
| Domain → Infrastructure | `from.*\.\./infrastructure` in `*/domain/` | 0 |
| Domain → Server | `from.*\.\./server` in `*/domain/` | 0 |
| Application → Infrastructure | `from.*\.\./infrastructure` in `*/application/` | 0 |
| Application → Server | `from.*\.\./server` in `*/application/` | 0 |
| Server → Infrastructure | `from.*infrastructure` in `*/server/` | 0 |

All layers respect strict dependency direction. No upward imports detected.

---

## 2. Cross-Context Imports

### Violations

#### V2.1 — Direct cross-context domain import (runtime value)

- **File:** `src/contexts/integration/infrastructure/adapters/property-event.adapter.ts:7`
- **Import:** `import { propertyCreated } from '#/contexts/property/domain/events'`
- **Issue:** Imports a runtime function (`propertyCreated` event constructor) from property context's domain directly, bypassing public-api barrel.
- **Severity:** **MEDIUM** — Cross-context domain access. Infrastructure adapter importing from another context's domain is a boundary violation, even though it's in infrastructure layer. Should import through `property/application/public-api` or a dedicated event-types barrel.

#### V2.2 — Direct cross-context port import bypassing public-api

- **File:** `src/contexts/integration/infrastructure/adapters/google-review-api.adapter.ts:5`
- **Import:** `import type { GoogleReviewApiPort } from '#/contexts/review/application/ports/google-review-api.port'`
- **Issue:** Imports a port type directly from review context's internal application/ports directory instead of through `review/application/public-api`. The `GoogleReviewApiPort` is NOT re-exported from `review/application/public-api.ts`.
- **Severity:** **LOW** — Type-only import (erased at runtime), but bypasses the public API contract. Should add `GoogleReviewApiPort` to `review/application/public-api.ts` and import from there.

### Allowed Cross-Context Imports (no violation)

All of the following conform to the "event types only" exception or go through public-api barrels:

**Event type imports (allowed per architecture):**
- `inbox/infrastructure` → `review/domain/events` (type-only: `ReviewCreated`, `ReviewUpdated`, `ReplyPublished`)
- `inbox/infrastructure` → `guest/domain/events` (type-only: `FeedbackSubmitted`)
- `integration/infrastructure` → `property/domain/events` (type-only: `PropertyCreated` in `on-property-created.ts` handler)
- `review/infrastructure` → `property/domain/events` (type-only: `PropertyCreated`)
- `metric/infrastructure` → `guest/domain/events` (type-only: `FeedbackSubmitted`, `RatingSubmitted`, `ReviewLinkClicked`, `ScanRecorded`)
- `metric/infrastructure` → `review/domain/events` (type-only: `ReviewCreated`)

**Public-api barrel imports (correct pattern):**
- `portal/application` → `property/application/public-api` (`PropertyPublicApi`)
- `inbox/application` → `staff/application/public-api` (`StaffPublicApi`)
- `identity/application` → `portal/application/public-api` (`StoragePort`)
- `property/application` → `staff/application/public-api` (`StaffPublicApi`)
- `integration/application` → `review/application/public-api` (`ReviewQueuePort`)
- `integration/infrastructure` → `review/application/public-api` (`GoogleReview`, `StarRating`)
- `team/application` → `property/application/public-api` (`PropertyPublicApi`)
- `team/application` → `staff/application/public-api` (`StaffPublicApi`)
- `guest/application` → `portal/application/public-api` (`LinkResolverPort`)

---

## 3. Public API Barrels

### Status

| Context | Has `application/public-api.ts` | Cross-context consumer | Notes |
|---------|------|--------|-------|
| dashboard | ✅ | No | Has barrel, no external consumers |
| guest | ❌ | Yes (inbox, metric) | Consumers only import event types from `domain/events` — allowed. Barrel would formalize boundary. |
| identity | ❌ | No | No cross-context consumers. Barrel not currently needed. |
| inbox | ✅ | No | Has barrel, no external consumers |
| integration | ✅ | No | Has barrel, no external consumers |
| metric | ❌ | No | No cross-context consumers. Barrel not currently needed. |
| portal | ✅ | Yes (identity, guest) | Barrel used correctly |
| property | ✅ | Yes (portal, integration, team) | Barrel used correctly |
| review | ✅ | Yes (inbox, integration, metric) | Barrel used correctly |
| staff | ✅ | Yes (inbox, property, team) | Barrel used correctly |
| team | ❌ | No | No cross-context consumers. Barrel not currently needed. |

### Recommendation (LOW severity)

- **guest**: Add `application/public-api.ts` re-exporting event types to formalize the boundary, even though current direct event-type imports are allowed.
- **identity, metric, team**: No immediate need, but consider adding stubs for future-proofing.

---

## 4. Domain Purity

### Result: ✅ CLEAN — All 11 contexts pass

| Check | Pattern | Hits |
|-------|---------|------|
| async functions | `async ` in `*/domain/*.ts` | 0 (comments only) |
| class declarations | `^class ` in `*/domain/*.ts` | 0 (comment only: "Tagged record instead of class") |
| DB/HTTP imports | `postgres\|knex\|pg\|http\|axios\|fetch\|prisma\|drizzle\|supabase` in `*/domain/*.ts` | 0 |

Domain files across all contexts contain:
- `types.ts` — Readonly type definitions
- `errors.ts` — Tagged discriminated union error constructors
- `events.ts` — Event type definitions and pure event constructors
- `rules.ts` — Pure validation functions returning `Result`
- `constructors.ts` — Smart constructors composing validations

All domain files only import from `#/shared/domain` (IDs, Result, slug utilities) and within their own context's domain layer. No side effects, no I/O, no classes.

---

## 5. Composition Root

### Result: ✅ PROPER

- **File:** `src/composition.ts` — single composition root (325 lines)
- **Per-context:** All 11 contexts have `build.ts` files for local DI wiring
- **Pattern:** Manual DI — no framework, no decorators, no auto-wiring. Dependencies passed as function arguments.

**Build order (correct dependency chain):**
1. `staff` (no cross-context deps)
2. `identity` (no cross-context deps)
3. `property` → depends on `staff.publicApi`
4. `team` → depends on `property.publicApi`, `staff.publicApi`
5. `portal` → depends on `property.publicApi`
6. `guest` → depends on `portal.linkResolver`
7. `integration` → depends on `property.publicApi`
8. `review` → depends on `googleReviewApi` adapter (from integration infra)
9. `inbox` → depends on `staff.publicApi`
10. `metric` (no cross-context deps)
11. `dashboard` (no cross-context deps)

Cross-context wiring correctly passes public APIs as ports. The composition root's direct infrastructure imports (e.g., `createPropertyRepository`, `createGoogleReviewApiAdapter`) are architecturally correct — the composition root is authorized to wire infrastructure adapters to application ports.

---

## Summary

| Category | Severity | Count | Details |
|----------|----------|-------|---------|
| Dependency direction | — | 0 violations | Clean |
| Cross-context imports | MEDIUM | 1 | V2.1: property-event.adapter.ts imports runtime value from property/domain |
| Cross-context imports | LOW | 1 | V2.2: google-review-api.adapter.ts imports port type bypassing public-api |
| Missing public-api barrels | LOW | 1 | guest context has cross-context consumers but no barrel |
| Domain purity | — | 0 violations | Clean |
| Composition root | — | 0 violations | Proper DI wiring |

**Total violations: 2 (1 MEDIUM, 1 LOW) + 1 recommendation**

### Recommended fixes:

1. **V2.1 (MEDIUM):** In `review/application/public-api.ts`, re-export event types from `property/domain/events`, OR have `property/application/public-api.ts` re-export `propertyCreated`. Then update `integration/infrastructure/adapters/property-event.adapter.ts` to import through the barrel.

2. **V2.2 (LOW):** Add `GoogleReviewApiPort` to `review/application/public-api.ts` exports:
   ```ts
   export type { GoogleReviewApiPort } from './ports/google-review-api.port'
   ```
   Then update `integration/infrastructure/adapters/google-review-api.adapter.ts:5` to import from `#/contexts/review/application/public-api`.

3. **Guest barrel (LOW):** Create `guest/application/public-api.ts` re-exporting event types for formalized boundary.
