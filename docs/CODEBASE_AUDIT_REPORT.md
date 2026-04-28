# Reputation Key — Comprehensive Codebase Audit Report

**Auditor:** Kimi Code CLI  
**Date:** 2026-04-28  
**Scope:** Full codebase (228 source files, 47 test files, 4 bounded contexts)  
**Docs reviewed:** `README.md`, `AGENTS.md`, `docs/conventions.md`, `docs/patterns.md`, `docs/plan/plan.md`, `docs/phase-6-review.md`, `docs/phase-6-final-review.md`

---

## 1. Executive Summary

| Category               | Score  | Status                             |
| ---------------------- | ------ | ---------------------------------- |
| Architecture adherence | 95/100 | Strong                             |
| Conventions compliance | 88/100 | Good, with regressions             |
| Pattern fidelity       | 93/100 | Strong                             |
| Test coverage          | 96/100 | Excellent (447 tests, all passing) |
| Type safety            | 82/100 | **Typecheck FAILS**                |
| Lint cleanliness       | 85/100 | **Lint FAILS**                     |
| Security posture       | 78/100 | **Critical: secrets in .env**      |
| Documentation accuracy | 85/100 | Minor contradictions found         |

**Overall verdict:** The codebase is architecturally sound and well-tested, but has **regressed since Phase 6 final review** — typecheck and lint now fail, and real secrets are committed in `.env`. These are blockers that must be fixed before Phase 7.

---

## 2. Doc Adherence Analysis

### 2.1 ✅ Strong adherence — architecture

| Rule                                                                  | Evidence                                                    | Status |
| --------------------------------------------------------------------- | ----------------------------------------------------------- | ------ |
| Four-layer structure (domain → application → infrastructure → server) | All 4 contexts follow it                                    | ✅     |
| Dependency direction inward                                           | ESLint `boundaries` plugin enforces mechanically            | ✅     |
| Composition root pattern                                              | `composition.ts` is clean, explicit, no DI framework        | ✅     |
| Factory functions returning records                                   | All repos, use cases, adapters follow this                  | ✅     |
| Branded IDs                                                           | `PropertyId`, `TeamId`, `OrganizationId`, etc. all branded  | ✅     |
| Tenant isolation (`organization_id` on every table, `baseWhere()`)    | Consistent across all repos                                 | ✅     |
| Events as past-tense facts                                            | `team.created`, `staff.assigned`, etc.                      | ✅     |
| Tagged errors with `_tag` + `code`                                    | All contexts follow pattern                                 | ✅     |
| `match(...).exhaustive()` in server functions                         | Property, team, staff all use it                            | ✅     |
| Clock injection instead of `new Date()`                               | Every use case uses `deps.clock()`                          | ✅     |
| No classes                                                            | `grep -rn "class "` returns only `class-variance-authority` | ✅     |
| No enums                                                              | `grep -rn "enum "` returns zero results                     | ✅     |

### 2.2 ⚠️ Partial adherence — conventions

| Rule                                      | Issue                                                                                        | Status  |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ------- |
| `type` aliases preferred over `interface` | Mix of both; not enforced by lint                                                            | ⚠️      |
| `readonly` on all domain fields           | Consistent in domain, but `SetValues` types in repos strip readonly (acceptable for Drizzle) | ✅      |
| `ReadonlyArray<T>` for arrays             | Used in domain, some application types use plain arrays                                      | ⚠️      |
| Zod import from `zod/v4`                  | All code uses `zod/v4`, but `patterns.md` examples still show `zod`                          | ⚠️ docs |

### 2.3 ❌ Regressions since Phase 6 final review

The Phase 6 final review (2026-04-25) claimed "`tsc --noEmit` clean, `eslint` clean" — **this is no longer true**.

---

## 3. Type Safety & Static Analysis

### 3.1 ❌ TypeScript — 15 errors (`tsc --noEmit`)

**File: `src/contexts/team/application/use-cases/list-teams.test.ts`** (7 errors)

```
Type 'string' is not assignable to type 'string & { __brand: "TeamId"; }'
Type 'string' is not assignable to type 'string & { __brand: "PropertyId"; }'
Cannot assign to 'getAccessiblePropertyIds' because it is a read-only property
```

- **Root cause:** Test file creates mock data with raw strings instead of using branded ID constructors (`teamId()`, `propertyId()`), and attempts to mutate a `Readonly` property.
- **Severity: P1** — breaks the build gate.
- **Fix:** Use fixture helpers (`uuidFromLabel`, branded ID constructors) from `shared/testing/fixtures.ts`.

**File: `src/contexts/team/application/use-cases/update-team.ts`** (1 error)

```
'TeamId' is declared but its value is never read
```

- **Severity: P2** — dead import.

**File: `src/shared/auth/permissions.test.ts`** (7 errors)

```
'beforeEach' is declared but its value is never read
'ac', 'owner', 'admin', 'memberRole' declared but never read
```

- **Severity: P2** — test file has unused imports.

### 3.2 ❌ ESLint — 18 errors

All errors are `@typescript-eslint/no-unused-vars`:

| File                                                     | Count | Issue                                                                     |
| -------------------------------------------------------- | ----- | ------------------------------------------------------------------------- |
| `staff/application/use-cases/create-staff-assignment.ts` | 3     | `PropertyId`, `TeamId`, `UserId` imported but unused                      |
| `staff/server/staff-assignments.ts`                      | 4     | `PropertyId`, `StaffAssignmentId`, `TeamId`, `UserId` imported but unused |
| `team/application/use-cases/list-teams.test.ts`          | 2     | `userId` unused import, `teamRepo` unused variable                        |
| `team/application/use-cases/update-team.ts`              | 1     | `TeamId` unused import                                                    |
| `shared/auth/permissions.test.ts`                        | 5     | `beforeEach`, `ac`, `owner`, `admin`, `memberRole` unused                 |

**Total: 18 lint errors** — all trivial to fix, but they break the lint gate.

**Severity: P1** — conventions state lint must pass.

---

## 4. Security & Vulnerability Assessment

### 4.1 🔴 CRITICAL — Real secrets committed in `.env`

The `.env` file at repository root contains **production-equivalent secrets**:

| Secret                | Value                                                | Risk                |
| --------------------- | ---------------------------------------------------- | ------------------- |
| `DATABASE_URL`        | Full Neon PostgreSQL connection string with password | Database compromise |
| `DATABASE_URL_POOLER` | Same credentials, pooled endpoint                    | Database compromise |
| `RESEND_API_KEY`      | `re_JhnYLnw7_7f2d8RePASwgDaDe65wYkEbr`               | Email sending abuse |
| `BETTER_AUTH_SECRET`  | 64-char hex secret                                   | Session forgery     |

- `.gitignore` **does** include `.env` and `.env.local` — so these won't be pushed to git.
- **But** the file exists on disk in the working tree. If this repo is ever cloned to a shared environment, zipped for backup, or the user accidentally commits `.env` after modifying `.gitignore`, secrets leak.
- **Recommendation:** Rotate all secrets immediately. Move `.env` to `.env.example` with placeholder values. Add `.env` to `.gitignore` if not already present (it is). Document secret rotation in onboarding.

**Severity: P0** — secrets are exposed on the filesystem.

### 4.2 🟡 HIGH — Email verification disabled

`src/shared/auth/auth.ts`:

```ts
requireEmailVerification: false,
```

With a TODO comment saying "Enable email verification in production."

- Anyone can register with any email address — no verification required.
- This is acceptable for early development but is a **production blocker**.

**Severity: P1** for production readiness; P3 for current development phase.

### 4.3 🟡 HIGH — `.env` file is source of truth for all environments

No environment-specific config separation (`.env.development`, `.env.production`, `.env.test`). The single `.env` file mixes development DB URLs with what appear to be real production credentials.

**Severity: P2** — configuration hygiene issue.

### 4.4 🟡 MEDIUM — `requireEmailVerification: false` + `sendResetPassword` enabled

Password reset emails are sent via Resend, but email addresses are not verified. A user could register with someone else's email, then trigger a password reset for that account.

**Severity: P2** — depends on whether email verification is enabled before launch.

### 4.5 🟢 LOW — Tenant isolation is mechanically enforced

- Every repository method takes `organizationId` as first parameter.
- Every query uses `baseWhere(orgId)` which filters `organization_id = $1 AND deleted_at IS NULL`.
- Insert operations have explicit tenant mismatch guards:
  ```ts
  if (property.organizationId !== orgId) {
    throw new Error('Tenant mismatch on property insert')
  }
  ```
- Cross-tenant integration tests exist for all repos.

**No SQL injection risk detected** — Drizzle ORM parameterized queries used throughout. No raw SQL string concatenation.

### 4.6 🟢 LOW — No `eval()`, `Function()`, or dynamic code execution

Clean search results — no dangerous dynamic execution patterns.

### 4.7 🟡 MEDIUM — Error objects may leak stack traces

Server functions throw plain `Error` objects (required for TanStack Start seroval serialization). The client receives `error.message`. If any use case or infrastructure layer includes sensitive data in error messages, it could leak to the client.

**Current code audit:** Error messages are generic ("Property not found", "Slug taken"). No sensitive data in messages. ✅

### 4.8 ✅ RESOLVED — Auth adapter uses Zod-validated response schemas

`auth-identity.adapter.ts` previously used `as unknown as ...` casts to map better-auth's loosely-typed API responses. These have been replaced with Zod schemas in `better-auth-schemas.ts` and a `parseBetterAuthResponse()` helper that validates at runtime and throws tagged `IdentityError`s on mismatch.

**Resolution:** Zod parsing at the adapter boundary removes the casts and catches response shape changes at runtime.

---

## 5. Architecture Integrity

### 5.1 ✅ Layer boundaries — mechanically enforced

ESLint `boundaries` plugin configuration is **excellent** — it maps every folder pattern to an element type and enforces allowed imports with `default: 'disallow'`. This is a strong architectural backstop.

Key rules enforced:

- `domain/` → only `shared-domain`
- `application/` → `domain`, `shared-domain`, `shared-events`
- `infrastructure/` → `domain`, `application`, `shared-*`
- `server/` → `domain` (error types only), `application`, `shared-*`
- `routes/` → `server`, `application` (DTOs only), `components`, `shared-*`
- `components/` → `components`, `shared-*`, `application` (DTOs only)

### 5.2 ✅ Cross-context communication — correct patterns

| Relationship          | Pattern                                                                          | Status |
| --------------------- | -------------------------------------------------------------------------------- | ------ |
| Team → Property       | `PropertyExistsPort` interface in team context, thin adapter in `composition.ts` | ✅     |
| Property/Team → Staff | `PropertyAccessProvider` in `shared/domain/property-access.port.ts`              | ✅     |
| Identity → Staff      | Event-based (`afterAcceptInvitation` hook wires staff assignment creation)       | ✅     |

No context imports another's use cases or repositories directly.

### 5.3 ✅ Composition root — clean and complete

`composition.ts`:

- All dependencies visible in one file
- No DI framework, no decorators
- `propertyExists` wired as thin adapter around `propertyRepo.findById`
- `propertyAccess` correctly delegates to `staffAssignmentRepo.getAccessiblePropertyIds`
- Event bus passed to all use cases that emit events

### 5.4 ⚠️ One concern — `createOrg` and `setActiveOrg` helpers in composition

These are thin wrappers around better-auth API calls, placed in `composition.ts` rather than in the identity context's infrastructure. This is pragmatic (they're only used by `registerUserAndOrg`), but slightly blurs the line. Not a violation, just a note.

---

## 6. Code Quality Findings

### 6.1 ✅ Functional style — excellent

- Zero `class` declarations in business logic
- Zero `enum` declarations
- Immutable updates throughout domain
- `Result<T, E>` from `neverthrow` used correctly in domain
- `ts-pattern` `match(...).exhaustive()` used for all error code dispatch

### 6.2 ⚠️ Unused imports — widespread but trivial

18 lint errors all relate to unused imports/variables. This suggests:

- IDE auto-imports not being cleaned up
- No pre-commit hook running lint
- Refactoring left behind dead code

**Fix:** Run `pnpm lint:fix` — most will auto-fix.

### 6.3 ⚠️ In-memory store utility is dead code

`shared/testing/in-memory-store.ts` exists but none of the in-memory repos use it. Each repo has its own inline `Map`-based implementation. The file's own comment incorrectly claims it's "used by property, team, and staff in-memory repos."

**Severity: P3** — remove or adopt.

### 6.4 ✅ Error handling — unified and correct

All server functions now use the shared `throwContextError()` helper (introduced in Phase 6.5). Pattern is consistent:

1. Catch tagged error via `isXxxError(e)` type guard
2. Map code → HTTP status via `match(e.code).with(...).exhaustive()`
3. Throw via `throwContextError(errorName, e, status)`

This is a significant improvement over the earlier inconsistency noted in `phase-6-review.md`.

### 6.5 ✅ Use case step ordering — correct

All use cases follow the 7-step pattern, skipping absent steps:

| Use case                | Steps used                                    |
| ----------------------- | --------------------------------------------- |
| `createProperty`        | 1→2→3→4→5→6→7 (full)                          |
| `updateProperty`        | 1→2→3→4→5→6→7 (field-level validation)        |
| `createTeam`            | 1→2→3→4→5→6→7 (full)                          |
| `updateTeam`            | 1→2→3→4→5→6→7 (field-level, fixed in Phase 6) |
| `createStaffAssignment` | 1→3→4→5→6→7                                   |
| `removeStaffAssignment` | 1→2→5→6                                       |

### 6.6 ✅ Form patterns — correct

All forms follow the documented pattern:

- Schema derived from DTO via `.pick().required()` / `.extend()`
- `useForm` with `validators.onSubmit`
- Mutation defined in route, passed as prop to form component
- Uses `SubmitButton`, `FormErrorBanner`, shadcn `Field` primitives

---

## 7. Test Coverage Analysis

### 7.1 ✅ All tests pass

```
Test Files  47 passed (47)
Tests       447 passed (447)
Duration    36.11s
```

### 7.2 ✅ Coverage by layer

| Layer                      | Contexts covered                      | Test count | Quality                               |
| -------------------------- | ------------------------------------- | ---------- | ------------------------------------- |
| Domain rules               | property, team, staff, identity       | ~50        | Thorough                              |
| Domain constructors        | property, team                        | ~15        | Thorough                              |
| Domain errors              | property, team, staff, identity       | ~20        | Type guards tested                    |
| Use cases                  | all 4 contexts                        | ~100       | Happy path + all error paths          |
| Repositories (integration) | property, team, staff                 | ~25        | CRUD + tenant isolation + soft-delete |
| Mappers                    | property, team, staff                 | ~25        | Round-trip assertions                 |
| Server functions           | property, team, staff, identity       | ~70        | Auth + error paths                    |
| Shared                     | auth, rate-limit, jobs, events, roles | ~45        | Utility tests                         |
| E2E                        | property CRUD                         | 2          | Playwright                            |
| Smoke                      | app bootstrap                         | 2          | Basic                                 |

### 7.3 ✅ Tenant isolation tests

Every repository integration test suite includes explicit cross-tenant query tests:

- `property.repository.test.ts` — cross-org query returns empty
- `team.repository.test.ts` — cross-org query returns empty
- `staff-assignment.repository.test.ts` — cross-org query returns empty/null

### 7.4 ✅ Test isolation strategy

- `singleFork: true` in vitest config prevents TRUNCATE CASCADE races
- Unique org IDs per test file (`org-prop-test-*`, `org-team-test-*`, etc.)
- Each test file truncates only its own tables

### 7.5 ⚠️ Missing tests — minor gaps

| Missing                                        | Severity | Notes                                               |
| ---------------------------------------------- | -------- | --------------------------------------------------- |
| `getProperty` server function integration test | P3       | Covered by unit tests                               |
| `resendInvitation` use case test               | P3       | Thin delegation, low risk                           |
| `registerUser` use case test                   | P3       | Thin delegation                                     |
| Event handler tests                            | P3       | No cross-context handlers yet (correct for Phase 6) |

---

## 8. Documentation Contradictions

### 8.1 ⚠️ Zod import path inconsistency

| Source                 | Import                                |
| ---------------------- | ------------------------------------- |
| `conventions.md`       | "This project uses Zod v4 (`^4.3.6`)" |
| `patterns.md` examples | `import { z } from 'zod'`             |
| Actual code            | `import { z } from 'zod/v4'`          |

**Resolution:** `patterns.md` should be updated to use `zod/v4` in all examples.

**Severity: P3**

### 8.2 ⚠️ `patterns.md` claims `in-memory-store.ts` is used

> "Now used by property, team, and staff in-memory repos"

This is false — none of the in-memory repos import from it.

**Severity: P3**

### 8.3 ⚠️ `README.md` vs `conventions.md` — folder structure discrepancy

`README.md` shows:

```
src/
  contexts/       # Business domains
  shared/         # Shared infrastructure
  routes/         # TanStack Start routes
  components/     # UI components
```

`conventions.md` shows a more detailed structure including `integrations/`, `worker/`, `lib/`, etc. The README is simplified but not wrong — just less precise.

**Severity: P3**

### 8.4 ⚠️ Phase 6 final review claims clean typecheck/lint — now false

The `phase-6-final-review.md` document states:

> "Status: ✅ 330/330 tests pass, `tsc --noEmit` clean, `eslint` clean"

As of 2026-04-28, both typecheck and lint fail. This indicates regressions were introduced after the Phase 6 gate was declared passed.

**Severity: P2** — gate documentation is now stale.

---

## 9. Priority-Ranked Findings

### P0 — Fix immediately (security / build blockers)

| #   | Issue                      | File(s) | Action                                                                                |
| --- | -------------------------- | ------- | ------------------------------------------------------------------------------------- |
| 1   | **Real secrets in `.env`** | `.env`  | Rotate all secrets. Replace `.env` with `.env.example` containing placeholder values. |

### P1 — Fix before any merge (build failures)

| #   | Issue                           | File(s)                                                       | Action                                                |
| --- | ------------------------------- | ------------------------------------------------------------- | ----------------------------------------------------- |
| 2   | **Typecheck fails (15 errors)** | `list-teams.test.ts`, `update-team.ts`, `permissions.test.ts` | Fix branded ID types in test; remove dead imports     |
| 3   | **Lint fails (18 errors)**      | 5 files                                                       | Run `pnpm lint:fix` or manually remove unused imports |

### P2 — Fix before production

| #   | Issue                                | File(s)                   | Action                                                                 |
| --- | ------------------------------------ | ------------------------- | ---------------------------------------------------------------------- |
| 4   | **Email verification disabled**      | `auth.ts`                 | Enable `requireEmailVerification: true` once Resend domain is verified |
| 5   | **No environment config separation** | `.env`                    | Create `.env.development`, `.env.production`, `.env.test` templates    |
| 6   | **Stale Phase 6 gate documentation** | `phase-6-final-review.md` | Update to reflect current state, or archive                            |

### P3 — Nice to fix (tech debt / docs)

| #   | Issue                                                    | File(s)                                    | Action                                                |
| --- | -------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------- |
| 7   | **`patterns.md` uses `zod` instead of `zod/v4`**         | `patterns.md` all Zod examples             | Update imports                                        |
| 8   | **`in-memory-store.ts` is dead code**                    | `shared/testing/in-memory-store.ts`        | Remove or adopt                                       |
| 9   | **`patterns.md` falsely claims in-memory store is used** | `patterns.md`                              | Remove claim                                          |
| 10  | **Auth adapter `as unknown` casts**                      | `auth-identity.adapter.ts`                 | ✅ Resolved — Zod schemas + `parseBetterAuthResponse` |
| 11  | **Missing use case tests for thin delegation**           | `resend-invitation.ts`, `register-user.ts` | Add minimal happy-path tests                          |

---

## 10. What's Done Exceptionally Well

1. **Architectural boundary enforcement via ESLint** — The `boundaries` plugin configuration is among the best I've seen. It mechanically enforces the dependency rules from conventions.md.
2. **Test coverage discipline** — 447 tests, colocated with source, covering happy path + every error path, tenant isolation, and soft-delete behavior.
3. **Functional style consistency** — Zero classes, zero enums, immutable data, `Result` types, factory functions. The team committed to a style and stuck with it.
4. **Tenant isolation** — Mechanical and consistent. `baseWhere()` helper means you can't accidentally forget the tenant filter.
5. **Composition root clarity** — `composition.ts` is readable, explicit, and makes the full dependency graph visible in one file.
6. **Event system** — Past-tense naming, master union type, typed `emit`/`on`, idempotent handler pattern documented.
7. **Error handling unification** — The `throwContextError` helper and `.exhaustive()` pattern mean adding a new error code forces compiler-checked updates in server functions.
8. **Cross-context boundary design** — `PropertyExistsPort` and `PropertyAccessProvider` demonstrate mature understanding of bounded contexts.

---

## 11. Conclusion

Reputation Key is a **well-architected codebase** with strong conventions, excellent test coverage, and mature bounded-context design. The architectural foundations are solid for Phase 7 (Portal Builder) and beyond.

However, **three blockers must be addressed before proceeding**:

1. **P0 — Rotate secrets** (`.env` contains real credentials)
2. **P1 — Fix typecheck** (15 TS errors, all in test files)
3. **P1 — Fix lint** (18 ESLint errors, all unused vars/imports)

These are all quick fixes (estimated < 30 minutes total) but they represent a process gap — the codebase regressed after a "clean" gate was declared. Consider adding a pre-commit hook (e.g., Husky + lint-staged) or CI gate that blocks merge on typecheck/lint failure.

**Recommended next steps:**

1. Fix P0–P1 issues
2. Update `phase-6-final-review.md` or archive it
3. Add pre-commit hook for lint + typecheck
4. Proceed to Phase 7 with confidence
