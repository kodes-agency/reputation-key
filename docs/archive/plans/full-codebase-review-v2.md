# Full-Scale Codebase Review Plan — Reputation Key

**Date:** 2026-06-10
**Codebase:** reputation-key (986 src files, ~93K LOC, 14 bounded contexts, 200 test files, 12 E2E tests)
**Branch:** `feat/workspace` (rebased from `main` at `4405bec`)
**Goal:** Exhaustive review of codebase adherence to established docs, standards, and patterns. Every finding cited against a specific rule in CONTEXT.md, ADR, or `docs/standards.md`.

---

## Source of Truth Documents

Every finding must reference one of these:

| Document                                    | Scope                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `CONTEXT.md` (root)                         | Bounded contexts, glossary, auth architecture, roles, permission patterns, forbidden patterns         |
| `DESIGN.md`                                 | Product design system, UI conventions, theming                                                        |
| `PRODUCT.md`                                | Feature scope, user stories, acceptance criteria                                                      |
| `REUI.md`                                   | UI component patterns, layout rules, scroll isolation                                                 |
| `AGENTS.md`                                 | Agent/LLM integration rules                                                                           |
| `docs/standards.md`                         | Event naming, use case shape, build function shape, repository ports, CONTEXT.md section requirements |
| `docs/deep-review.md`                       | 17 review prompts with per-layer BLOCKER/MAJOR/MINOR rubric                                           |
| `docs/adr/0001–0010`                        | Accepted architectural decisions                                                                      |
| `src/contexts/CONTEXT.md`                   | Layer dependency rules, file organization per context                                                 |
| `src/contexts/<name>/CONTEXT.md` (14 files) | Per-context: glossary, invariants, events, use cases, permissions, server functions                   |
| `src/components/CONTEXT.md`                 | Component conventions, 150-line limit, boundary rules                                                 |
| `src/shared/CONTEXT.md`                     | Shared module conventions                                                                             |
| `src/routes/CONTEXT.md`                     | Route conventions, auth guards, loader patterns                                                       |
| `eslint.config.js`                          | Architectural boundary enforcement (boundaries plugin), restricted imports, file length               |

---

## Review Dimensions

Each dimension is a distinct review axis. Findings are categorized by dimension and cross-referenced.

### D1. Architecture & Layer Boundaries

**Rules source:** `src/contexts/CONTEXT.md`, `eslint.config.js`, `docs/standards.md` §6

**Checks per file:**

1. **Dependency direction is strict and one-directional:**
   - `domain/` → imports only itself + `shared/domain/`. Forbidden: async, I/O, framework, React, Drizzle, better-auth, fetch, `process.env`
   - `application/` → imports `domain/` + `shared/domain/` + `shared/events/`. Forbidden: `infrastructure/`, `server/`, `routes/`, `components/`
   - `infrastructure/` → imports `domain/` + `application/` + `shared/` + external libs. Forbidden: business rules, HTTP routing, other contexts' `infrastructure/`
   - `server/` → imports `application/` + `shared/` + TanStack Start. Forbidden: business logic, direct DB access

2. **Cross-context calls go through `application/public-api.ts` only.** No direct imports of another context's `domain/` or `infrastructure/`.

3. **Composition root (`src/composition.ts`)** is the only place wiring concrete adapters to ports. Use cases never `new` an infrastructure class.

4. **Bootstrap order** owned by `src/bootstrap.ts`. No side effects at import time.

5. **eslint boundary rules are not bypassed** by `eslint-disable` comments without documented justification.

### D2. Event Standards

**Rules source:** `docs/standards.md` §1

**Checks per event:**

1. **Tag naming:** `context.entity.verb` format. No hyphens (use underscores). Shorthand when context=entity.
2. **Type naming:** `PascalCase(tag)` with dots removed.
3. **Constructor naming:** `camelCase(TypeName)`.
4. **Constructor validation:** All event constructors include assertions for impossible states.
5. **Envelope fields:** Every event has `eventId` (auto-generated), `occurredAt` (caller-provided with assertion), `correlationId` (optional).
6. **Flat payload:** No `data: { ... }` wrapper. Envelope fields are siblings of domain fields.
7. **Union naming:** One union per context: `{ContextName}Event`.
8. **File organization:** One file per context: `domain/events.ts`.
9. **Field naming:** `occurredAt` (not `recordedAt`/`createdAt`), `userId` (not `authorUserId`), `organizationId`, `propertyId`, ordered fields.
10. **4-layer consistency:** definition → constructor → union membership → handler subscription. All four must align.

### D3. Use Case Standards

**Rules source:** `docs/standards.md` §2

**Checks per use case:**

1. **Three exported types:** `{Name}Input`, `{Name}Deps`, `{Name}` (return type).
2. **Steps in order:** Authorize → Load entities → Check rules → Build domain → Persist → Emit events → Return.
3. **Authorization via `can(role, permission)`** from `shared/domain/permissions`. Not `hasRole()`, not string equality.
4. **No framework objects** in constructor or method signature.
5. **Returns domain entities/DTOs/void**, not DB rows or ORM models.
6. **All side effects through injected ports.** No `fetch`, `console.log`, `process.env` in use case body.
7. **Typed errors.** No `throw new Error('...')` in domain/application. Use `Result<T, DomainError>`.

### D4. Build Function Standards

**Rules source:** `docs/standards.md` §3

**Checks per context `build.ts`:**

1. Returns `Readonly<{ publicApi, internal: { repos, useCases } }>`.
2. `publicApi` is the ONLY cross-context boundary.
3. `internal` accessible only from `composition.ts`.
4. All repos and use cases are wired through build, not created ad-hoc.

### D5. Repository & Port Standards

**Rules source:** `docs/standards.md` §5

**Checks per port/adapter:**

1. **Port naming:** `{Entity}Repository` interface, `create{Entity}Repository(db)` factory.
2. **Port location:** `application/ports/<entity>.repository.ts`.
3. **Signatures:** `insert(DomainType)`, `findById(id, orgId)` (tenant-scoped), `update(DomainType)`.
4. **Domain-generated IDs** — no `defaultRandom()` on schema columns.
5. **Adapter returns domain types** — no DB row leaks, mappers use `unbrand()` correctly.
6. **Every SELECT/UPDATE/DELETE includes `WHERE organization_id = ?`** (tenant isolation).

### D6. Permission & Authorization

**Rules source:** `CONTEXT.md` (Permission Patterns, Forbidden patterns), `docs/deep-review.md` §9, ADR 0001

**Checks across all layers:**

1. **Three APIs used correctly:**
   - `can(role, permission)` — server functions + route `beforeLoad` only
   - `usePermissions()` — React components only
   - `hasRole(role, requiredRole)` — sidebar visibility + domain hierarchy only
2. **Forbidden patterns (all BLOCKER):**
   - Passing `canEdit`/`canCreate`/`canDelete` boolean props to components
   - Using `hasRole()` for permission checks
   - Calling `toDomainRole()` on already-mapped domain role
   - Permission strings as bare literals instead of constants from `shared/auth/permissions.ts`
   - `role === 'AccountAdmin'` string equality instead of `can()`
   - PropertyManager mutations without `staff_assignment` verification
   - Replies surfaced to Staff role
3. **Client check must have matching server-side check.** Client is affordance, never guard.
4. **Permission matrix completeness:** every permission is granted to at least one role and enforced in at least one use case.

### D7. Multi-Tenancy & Data Isolation

**Rules source:** `CONTEXT.md` (Identity, Property Access), `docs/deep-review.md` §11

**Checks:**

1. Every DB query on tenant-owned table has `organizationId` in predicate. Enumerate all violations.
2. `organizationId` always from `AuthContext`, never from request body/query string.
3. PropertyManager mutations verify `staff_assignment` row exists for `(userId, propertyId)`.
4. No cross-tenant joins possible.
5. Background jobs/Pub/Sub handlers re-establish tenant context.
6. Cache keys include `organizationId`.
7. Tests for tenant-scoped code include second-org fixture asserting non-visibility.

### D8. Server Functions

**Rules source:** `docs/deep-review.md` §6, `src/contexts/CONTEXT.md`

**7-step shape check per server function:**

1. Wrapped in `tracedServerFn`
2. Auth middleware → `resolveTenantContext()` → `AuthContext`
3. Input validated by schema (zod) at entry
4. Permission check via `can(role, permission)`
5. Resolve use case from composition root
6. Call use case, map result to client shape
7. Errors translated to stable error envelope

**Additional checks:**

- `organizationId` from `AuthContext` not request body
- No direct repo calls (must go through use case)
- No reaching into other context's internals
- Tracing span includes `organizationId`, `userId`, `useCase`, resource id

### D9. Routes, Loaders & Mutations

**Rules source:** `src/routes/CONTEXT.md`, `docs/deep-review.md` §7

**Checks per route:**

1. Authenticated routes nested under `_authenticated.tsx` or have own `beforeLoad` guard.
2. `beforeLoad` does auth resolution only — no data fetching.
3. Loaders/mutations call server functions, not repos/ORM/fetch directly.
4. `organizationId` from auth context, not URL params or localStorage.
5. Mutation invalidation keys match loader query keys.
6. `Suspense`/`ErrorBoundary` around `useSuspenseQuery` children.
7. Route state that belongs in URL (filters, pagination) is in URL.
8. No `if (user.role === '...')` in routes — use `can()` server-side.

### D10. React Components & Hooks

**Rules source:** `src/components/CONTEXT.md`, `REUI.md`, `docs/deep-review.md` §8

**Checks per component:**

1. **No boolean permission props** — use `usePermissions()`.
2. **No `hasRole()` for gating** — only for hierarchy.
3. **No cross-context internal imports** — no reaching into `contexts/*/infrastructure` or `domain/`.
4. **No raw `fetch`** in client components — use loaders/mutations/server functions.
5. **150-line limit** on component files (shadcn primitives exempt; feature components must comply).
6. **`useEffect` not used** for derivable state or data fetching that belongs in loaders.
7. **Event handlers stable** — not re-created every render when passed to memoized children.
8. **Form state** uses project form library/pattern, not hand-rolled `useState` per field.
9. **Error states** not swallowed — catch → toast → telemetry.
10. **Accessibility:** interactive elements with role/keyboard, images with alt, no color-only signals, `<label>` associations.
11. **Scroll isolation** per REUI.md conventions.

### D11. Domain Purity

**Rules source:** `docs/deep-review.md` §3, `docs/standards.md`

**Checks per domain file:**

1. No imports from: React, TanStack, better-auth, Drizzle, fetch/axios, google-\*, `node:fs`, `node:crypto` for IO, `process.env`, `infrastructure/`, `application/`, `server/`, `routes/`, `components/`, `shared/auth/`, `shared/observability/`.
2. Entities immutable — mutation via methods returning new instances or emitting events.
3. Factory/rehydrate distinction — `new Entity({...})` not allowed from outside domain.
4. IDs are branded types, not raw `string`.
5. Business failures are typed `DomainError`, not `throw new Error()`.
6. Time via injected `Clock` port, not `new Date()` or `Date.now()`.
7. UUID via injected `IdGenerator`, not inline generation.
8. State transitions as explicit methods, not `if/else` chains.
9. Invariants from CONTEXT.md glossary are enforced in code.

### D12. Context Documentation Accuracy

**Rules source:** `docs/standards.md` §4

**Checks per `src/contexts/<name>/CONTEXT.md`:**

1. **Required sections present** (in order): Bounded context, Glossary, Relationships, Invariants, Events produced, Events consumed, Architecture layers, Use cases, Public API, Server functions, Permissions.
2. **Events produced table** matches actual `_tag` values in `domain/events.ts`.
3. **Events consumed table** matches actual handler subscriptions in `infrastructure/event-handlers/`.
4. **Use cases table** matches actual files in `application/use-cases/`.
5. **Server functions table** matches actual files in `server/`.
6. **Architecture layers tree** matches actual directory structure.
7. **Permissions matrix** matches actual `can()` calls in code.
8. **No removed sections present** (language/dialogue, flagged ambiguities, intentional deviations).

### D13. ADR Compliance

**Rules source:** `docs/adr/0001–0010`

**Checks per ADR:**

1. Status matches reality (Accepted → reflected in code; Superseded → old pattern removed).
2. Decision is implemented as described.
3. No code contradicts the ADR's stated rules.
4. ADRs referenced in CONTEXT.md exist on disk and vice versa.

### D14. Type Safety & Naming

**Rules source:** `docs/deep-review.md` §14, `docs/standards.md`

**Checks across all src/:**

1. No `any` / `as any` outside test scaffolding (enumerate every occurrence).
2. No `as unknown as T` — use type guards or schema validation.
3. No `@ts-ignore` / `@ts-expect-error` without reason comment.
4. No non-null assertion `!` to dodge real `undefined`.
5. Branded ID types used consistently — no raw `string` for `UserId`, `PropertyId`, etc.
6. Discriminated unions with exhaustive `never` assertions in switches.
7. Public exports have explicit return types.
8. File naming consistent with project convention (kebab-case).

### D15. Error Handling & Result Types

**Rules source:** `docs/deep-review.md` §13

**Checks:**

1. No `throw new Error('...')` in domain/application layers.
2. No bare `catch (e) {}` or `catch { return null }`.
3. No HTTP status codes leaking into domain/application.
4. No internal error details returned to client.
5. Validation errors and auth errors are distinct types.
6. Consistent error envelope at server function boundary.
7. Domain errors extend common `DomainError` base.
8. Use cases return `Result<T, DomainError>`, not `null` for failure.

### D16. Observability

**Rules source:** `docs/deep-review.md` §12, `src/shared/CONTEXT.md`

**Checks:**

1. Every server function wrapped in `tracedServerFn`.
2. No PII/secrets logged (tokens, reviewer names+email, OAuth payloads).
3. Structured logging, not string concatenation.
4. Span attributes: `organizationId`, `userId`, `role`, `useCase`, `resource.type`, `resource.id`.
5. No `console.log` outside scripts.
6. Background jobs/Pub/Sub handlers create own root span.
7. External calls (GBP, DB, OAuth) wrapped in spans.

### D17. Test Quality

**Rules source:** `docs/deep-review.md` §15

**Checks:**

1. Use cases have tests for happy + forbidden + business-failure paths.
2. Domain invariants tested (entity rejects invalid state).
3. State machine transitions tested (allowed + forbidden).
4. Adapters have contract/integration tests.
5. Server functions with auth have forbidden-role tests.
6. Tenant-scoped code has second-tenant test.
7. Tests assert behavior, not implementation details.
8. No shared fixture mutation causing order dependence.
9. Time/random stubbed (no flaky tests).
10. Test names describe expected behavior, not what's called.

### D18. UI/UX Pattern Adherence

**Rules source:** `REUI.md`, `DESIGN.md`

**Checks:**

1. Design tokens used correctly (colors, spacing, typography from defined tokens).
2. Component patterns match REUI.md conventions.
3. Layout patterns consistent (page shell, sidebar, top bar).
4. Form patterns consistent across all forms.
5. Loading states handled (skeletons, spinners).
6. Empty states handled.
7. Error states handled at page and component level.
8. Responsive patterns applied.

---

## Execution Plan

### Phase 1: Baseline (Gate 0)

**Before any review starts, establish the baseline.**

| Step | Command          | Purpose                                                                    |
| ---- | ---------------- | -------------------------------------------------------------------------- |
| 1.1  | `pnpm typecheck` | TypeScript compiles clean                                                  |
| 1.2  | `pnpm lint`      | ESLint passes (document any existing warnings)                             |
| 1.3  | `pnpm test`      | All tests pass (document any existing failures)                            |
| 1.4  | Global census    | Count `as any`, `@ts-ignore`, `console.log`, `TODO/FIXME/HACK`, dead files |

**Exit gate:** Baseline documented. Existing failures recorded as known issues, not review findings.

---

### Phase 2: Per-Context Deep Dives (D1–D17 per context)

**14 contexts reviewed in priority order (largest/most complex first).**

Each context review follows the same sub-routine:

#### Context Review Sub-Routine

**Pre-read (mandatory, in order):**

1. `src/contexts/<name>/CONTEXT.md`
2. Relevant ADRs from `docs/adr/`
3. `docs/standards.md`
4. `docs/deep-review.md` §16 (per-context template)

**Execution — 3 parallel agents per context:**

| Agent                       | Scope                                                                          | Dimensions           |
| --------------------------- | ------------------------------------------------------------------------------ | -------------------- |
| **Domain + Application**    | `domain/`, `application/`, `build.ts`                                          | D2, D3, D4, D11, D15 |
| **Infrastructure + Server** | `infrastructure/`, `server/`                                                   | D5, D7, D8, D16      |
| **Frontend**                | `ui/` (if any), server fn usage in routes, component imports from this context | D6, D9, D10          |

**Per-agent checklist:**

1. Read the CONTEXT.md first
2. Read relevant ADRs
3. Check every file against applicable dimensions
4. For D12 (doc accuracy): verify CONTEXT.md claims match actual code
5. Output findings in standardized format

**Context batch order:**

| Batch | Contexts                                                                                  | Rationale              |
| ----- | ----------------------------------------------------------------------------------------- | ---------------------- |
| 1     | **goal** (47 files), **integration** (81 files), **portal** (90 files)                    | Largest + most complex |
| 2     | **inbox** (66 files), **review** (41 files), **identity** (51 files)                      | Core business logic    |
| 3     | **dashboard** (28 files), **staff** (32 files), **property** (31 files)                   | Medium complexity      |
| 4     | **guest** (40 files), **team** (30 files), **metric** (24 files), **activity** (30 files) | Smaller contexts       |

**Exit gate per context:** All CRITICAL + MAJOR findings documented. CONTEXT.md accuracy verified.

---

### Phase 3: Cross-Cutting Verification (D1, D6, D7, D14)

**After all per-context reviews complete.**

| Check                           | Method                                                                   | Dimensions |
| ------------------------------- | ------------------------------------------------------------------------ | ---------- |
| Cross-context import violations | grep for imports into `domain/` or `infrastructure/` from other contexts | D1         |
| Event system consistency        | Verify definition → constructor → union → handler for every event        | D2         |
| Public API barrel completeness  | Every context exports via `public-api.ts`, no direct access              | D1         |
| Composition root correctness    | `composition.ts` wires all adapters, no orphaned ports                   | D4         |
| Permission matrix end-to-end    | Every permission: granted → enforced → tested                            | D6         |
| Tenant isolation sweep          | Every repo query includes `organizationId`                               | D7         |
| Type safety sweep               | `as any`, branded IDs, exhaustive switches                               | D14        |
| Circular dependency detection   | No circular imports between contexts                                     | D1         |

---

### Phase 4: UI & Component Review (D10, D18)

| Agent | Scope                                                                        | LOC   |
| ----- | ---------------------------------------------------------------------------- | ----- |
| A     | `src/components/features/`                                                   | ~10K  |
| B     | `src/components/ui/` + `src/components/forms/`                               | ~5.4K |
| C     | `src/components/layout/` + `src/components/hooks/` + `src/components/inbox/` | ~4.3K |

**Checks:** D10 (component patterns), D18 (UI/UX adherence), D14 (type safety), line limits.

---

### Phase 5: Documentation Accuracy (D12, D13)

**After all code reviews and fixes applied.**

1. Re-read each CONTEXT.md
2. Cross-reference every claim against actual code (post-fix)
3. Verify ADRs describe current architecture
4. Check root CONTEXT.md bounded-contexts table matches actual contexts
5. Verify all "Key Files" entries exist

---

### Phase 6: Test Quality Review (D17)

**Per-context test audit:**

1. List all use cases → check test file exists for each
2. List all domain invariants → check test asserts each
3. List all state machine transitions → check test for allowed + forbidden
4. List all server functions → check forbidden-role test
5. List all tenant-scoped code → check second-tenant test
6. Score test quality: naming, behavior-assertion, no implementation coupling

---

### Phase 7: Convergence Loop

**After all phases complete, iterate until clean.**

```
REPEAT:
  1. Dispatch 3 parallel agents (different focus areas):
     - Agent A: Edge cases, unchecked returns, unsafe casts
     - Agent B: Event contracts, security, data integrity, idempotency
     - Agent C: Cross-cutting, wiring, dead code, CONTEXT.md drift
  2. Each agent reads ALL target files fresh
  3. Merge findings → deduplicate
  4. IF findings: fix, run typecheck + lint + test, reset counter, go to 1
  5. IF zero findings (all 3 clean): increment counter
     - IF counter >= 3: DONE
     - ELSE: go to 1
```

---

## Finding Format

Every finding follows this structure:

````
[DIMENSION] [SEVERITY] <one-line summary>
  File: path/to/file.ts:LINE
  Quote: ```<≤5 lines>```
  Rule:  <which document + section is violated>
  Fix:   <concrete fix direction>
````

### Severity Levels

| Level       | Definition                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **BLOCKER** | Violates explicit rule in CONTEXT.md/ADR/standards.md, breaks layer boundary, leaks tenants/secrets, or is a correctness bug |
| **MAJOR**   | Convention violation, missing test for non-trivial path, swallowed error, unsafe type, duplicated logic                      |
| **MINOR**   | Naming inconsistency, dead code, redundant comment, suboptimal-but-correct pattern                                           |
| **NIT**     | Style preference (group these, do not enumerate one-by-one)                                                                  |

---

## Deliverables

| Artifact                                | Description                                                                |
| --------------------------------------- | -------------------------------------------------------------------------- |
| `docs/reviews/findings.md`              | All findings organized by dimension, severity, and context                 |
| `docs/reviews/context-health/<name>.md` | Per-context health report (one page each)                                  |
| `docs/reviews/permission-matrix.md`     | Full permission × role matrix with enforcement status                      |
| `docs/reviews/tenant-isolation.md`      | All repo queries with tenant-scoping status                                |
| `docs/reviews/coverage-gaps.md`         | Test coverage gaps by layer                                                |
| `docs/reviews/doc-drift.md`             | All documentation inaccuracies                                             |
| `docs/reviews/summary.md`               | Executive summary: counts by severity, top 10 risks, recommended fix order |

---

## Estimated Effort

| Phase                              | Estimated Sessions  | Parallelism                     |
| ---------------------------------- | ------------------- | ------------------------------- |
| Phase 1: Baseline                  | 0.5                 | Sequential                      |
| Phase 2: Per-Context (14 contexts) | 14–20               | 3 agents per context, 4 batches |
| Phase 3: Cross-Cutting             | 2–3                 | 3 agents                        |
| Phase 4: UI/Components             | 2–3                 | 3 agents                        |
| Phase 5: Doc Accuracy              | 1–2                 | 1–2 agents                      |
| Phase 6: Test Quality              | 2–3                 | 3 agents                        |
| Phase 7: Convergence               | 3–8 rounds          | 3 agents per round              |
| **Total**                          | **~25–40 sessions** |                                 |

---

## Precedence Rules for Conflicts

When two rules conflict:

1. `docs/standards.md` overrides `docs/deep-review.md` (standards are codified)
2. ADR overrides general conventions
3. Per-context CONTEXT.md overrides root CONTEXT.md for that context's scope
4. Code is correct and docs drifted → flag as doc-fix, not code-fix
5. Ambiguous → flag for decision, do not assume
