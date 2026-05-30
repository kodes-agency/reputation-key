# Codebase Deep Review — Strategy & Plan

> **Status:** Planning — do not execute yet.

**Goal:** Exhaustive section-by-section review of the entire `charlotte` codebase (~82K LOC, 865 TS/TSX files, 12 bounded contexts) to remove slop, eliminate dead code, enforce established patterns from CONTEXT.md files, and resolve discrepancies between code and documentation.

**Architecture:** Each review section targets one architectural layer across all contexts, or one context across all layers. Reviews are independent — they can run in parallel after a shared global sweep.

**Tech Stack:** TypeScript, TanStack Start/Router, Drizzle ORM, Zod v4, better-auth, hexagonal architecture.

---

## Review Philosophy

1. **Exhaust before asking.** Before flagging anything as an issue, verify it end-to-end: trace imports, check git blame for intent, look at sibling patterns.
2. **Report, don't fix.** This is a discovery pass. Findings go into categorized issues. Fixes happen in a separate phase.
3. **Doc-first.** CONTEXT.md files are authoritative. Code that contradicts docs is a finding. Docs that describe non-existent patterns are a finding.
4. **Pattern consistency is king.** One outlier in a sea of compliance is a finding — either fix the outlier or update the pattern doc.
5. **Prove dead code.** Never flag as "unused" without grep-verifying across the entire `src/` tree (not just barrel files).

## What Constitutes "Slop" in This Codebase

| Category | Examples |
|----------|----------|
| **TODO/FIXME/HACK** | `// TODO:`, `// FIXME:`, `// HACK:`, `// BUG:` in production code |
| **Commented-out code** | Blocks of old code left in comments |
| **Console abuse** | `console.log`, `console.warn`, `console.error` in production paths (not tests/scripts) |
| **`any` escape hatches** | `as any`, explicit `any` types, `@ts-ignore`, `@ts-expect-error` without justification |
| **Duplicate code** | Identical logic copy-pasted across files instead of extracted |
| **Dead/vestigial code** | Functions, exports, files, or columns imported nowhere |
| **Orphan files** | Files that import nothing and are imported by nothing |
| **License-less new files** | Files without the project license header (if applicable) |
| **Magic strings/numbers** | Unnamed constants used inline where enums or config exist |

## What Constitutes "Dead Code"

1. **Unused exports** — exported but never imported by any source file
2. **Unused imports** — imported but never referenced
3. **Unused files** — files not imported by anything, not in build graph
4. **Unused schema columns** — DB columns never read or written by any repository
5. **Unused dependencies** — packages in `package.json` not imported anywhere
6. **Vestigial code paths** — code for features described in the plan as "removed/dropped/deferred" that still exists (e.g., `staffId` on goals before Phase 15.5 executes, `referralCode` columns)

## Review Sections

The codebase is reviewed in 10 sections. Each section is self-contained and can run in parallel (except Section 0, which must run first).

### Section 0 — Global Sweep (prerequisite)

**Scope:** Entire `src/` tree. Shared infrastructure. Config files.

**What to do:**
1. **Unused dependency audit** — `depcheck` or manual: which `package.json` dependencies are unused? Unused devDependencies?
2. **Escape hatch census** — count and locate all `as any`, `any`, `@ts-ignore`, `@ts-expect-error`. Category: justified vs unjustified.
3. **TODO/FIXME/HACK census** — locate all TODO/FIXME/HACK comments. Categorize: addressed, stale, orphaned (no context).
4. **Console statement census** — locate `console.log/warn/error` outside `src/test-setup.ts` and test files. Verify none bypass the pino logger.
5. **Dead file sweep** — find files with zero importers (entry points like `build.ts`, route files, server functions are exempt — they're consumed by framework wiring, not static imports).
6. **Script check** — verify `scripts/check-filenames.mjs` still works. Check for kebab-case violations.
7. **Build output hygiene** — `pnpm build` — any warnings? Deprecation notices? Unused variable warnings?

**Output:** `review/0-global/findings.md` — categorized counts with file lists.

**Docs to check against:** `src/shared/CONTEXT.md`, `src/components/CONTEXT.md#rules` (file naming, barrel exports, line limits).

---

### Section 1 — Shared Infrastructure

**Scope:** `src/shared/` (all subdirectories: `domain/`, `events/`, `db/`, `auth/`, `jobs/`, `cache/`, `observability/`, `config/`, `testing/`, `hooks/`, `rate-limit/`)

**What to do:**
1. **Pattern compliance — verify every claim in `src/shared/CONTEXT.md`:**
   - `shared/` imports from itself + external libs only (rule: no business logic, no React except `usePermissions`)
   - `shared/events/events.ts` imports context event types (allowed exception); verify no other shared file imports from `contexts/`
   - `shared/testing/` imports from `contexts/` for test doubles only (allowed exception)
2. **Export hygiene:** Are all shared exports actually used by 2+ modules? (Rule: wait for second importer before extracting to shared)
3. **Dead code in shared:** Any unused shared exports?
4. **Auth verification:**
   - `auth.ts` — does the access control statement match all permissions in `shared/domain/permissions.ts`?
   - `middleware.ts` — is `resolveTenantContext` properly cached (5s TTL)? Is `clearTenantCache` called in every server function?
   - Are there any server functions missing `clearTenantCache()`?
5. **Domain types audit:** Are all ID types in `ids.ts` actually used? Any missing ID types?
6. **Logger audit:** Is `getLogger()` used everywhere instead of `console.*`? Any direct pino imports outside `observability/`?
7. **Cache audit:** Are `cache.port.ts` methods actually implemented by `redis-cache.ts`? Any methods in the port with no consumer?
8. **Testing fakes audit:** Do all in-memory fakes implement their corresponding port interface fully? Any missing methods?

**Output:** `review/1-shared/findings.md`

**Docs to check against:** `src/shared/CONTEXT.md`

---

### Section 2 — Domain Layer (all contexts)

**Scope:** All `src/contexts/*/domain/` directories (12 contexts × domain layers)

**What to do:**
1. **Pattern compliance — verify every claim in `src/contexts/CONTEXT.md` (domain layer rules):**
   - No `async`, no I/O, no framework imports, no `throw` — only `Result<T, E>` returns
   - `readonly` on all domain fields, `ReadonlyArray<T>`
   - Discriminated unions tagged with `_tag`
   - `match(...).exhaustive()` from ts-pattern for union dispatch
   - Functional style: no `class`, no `this`, no `enum`
2. **File structure consistency:** Every context's `domain/` should have: `types.ts`, `constructors.ts`, `events.ts`, `errors.ts`. Plus `rules.ts` where business rules exist. Any missing standard files?
3. **Constructor audit:** Do all constructors return `Result<T, DomainError>` (neverthrow)? No naked `new`/plain objects.
4. **Error audit:** Do all domain errors follow the tagged shape `{ _tag: 'XxxError', code: '<reason>', message, context? }`?
5. **Cross-context import violations:** Domain must not import from other contexts' domain/application/infrastructure/server. Only `shared/domain/`.
6. **Dead domain code:** Unused constructors, errors, events, types, rules functions.
7. **Event naming:** Past-tense only (`portal.created`, not `createPortal`). Commands forbidden.

**Output:** `review/2-domain/findings.md`

**Docs to check against:** `src/contexts/CONTEXT.md` (The Four Layers table, Functional Style, Error Pattern, Events sections)

---

### Section 3 — Application Layer (all contexts)

**Scope:** All `src/contexts/*/application/` directories

**What to do:**
1. **Pattern compliance — verify `src/contexts/CONTEXT.md` (application layer rules):**
   - No DB queries, no HTTP code, no React
   - No domain rule duplicates (delegates to domain)
   - Use case shape: Authorize → Load → Check invariants → Build → Persist → Emit → Return. Steps in order.
   - Permission check is first step for every use case receiving `AuthContext`
2. **Use case audit (per context):**
   - Does every use case with `AuthContext` have `can(role, permission)` as first step?
   - Are there use cases missing from the CONTEXT.md table for that context?
   - Are there use cases in CONTEXT.md that don't exist in code?
   - Do anonymous/public use cases correctly take `(input)` not `(input, ctx)`?
3. **Port interface audit:**
   - Are all ports defined in `ports/` fully implemented by infrastructure?
   - Any port methods with zero callers?
   - Any port methods called but not defined?
4. **DTO audit:**
   - Are Zod schemas in `dto/` actually used by forms in `components/`?
   - Any DTO schemas that duplicate validation rules from domain?
5. **Public API audit:** For each context that has `public-api.ts`:
   - Does it export everything listed in the context's CONTEXT.md "Public API" section?
   - Are there exports not listed in CONTEXT.md?
   - Are there cross-context imports that bypass `public-api.ts` (importing from `domain/`, `server/`, or non-public-api `application/` directly)?
6. **Dead application code:** Unused use cases, DTOs, port interfaces, public API exports.

**Output:** `review/3-application/findings.md`

**Docs to check against:** `src/contexts/CONTEXT.md` (The Four Layers, Use Case Shape, When to Skip Layers, Permission Check Pattern), per-context CONTEXT.md files (Use Cases tables, Public API sections)

---

### Section 4 — Infrastructure Layer (all contexts)

**Scope:** All `src/contexts/*/infrastructure/` directories

**What to do:**
1. **Pattern compliance — `src/contexts/CONTEXT.md` (infrastructure rules):**
   - No business rules (delegates to domain/application)
   - No HTTP routing (server functions own that)
   - No React
2. **Repository audit:**
   - Do all Drizzle repository implementations match their port interfaces?
   - Tenant isolation: does every query include `organizationId` filter?
   - Any direct `db.query.table` calls outside repositories?
   - Any missing mapper for tables that need row↔domain transformation?
3. **Mapper audit:**
   - Pure functions? (no side effects, no async)
   - Row → Domain and Domain → Row both present for each entity?
4. **Adapter audit:**
   - Do all adapters implement their port interface fully?
   - Are external service calls wrapped with proper error translation (catch → tagged error)?
5. **Event handler audit:**
   - Are all events listed in `CONTEXT.md` "Events consumed" table actually handled?
   - Are there handlers for events not listed in CONTEXT.md?
   - Are handlers idempotent? Do they log via shared logger? (No `throw`)
6. **Job audit:**
   - Are all jobs listed in CONTEXT.md "Background jobs" actually implemented?
   - Are there jobs not listed in CONTEXT.md?
   - Are jobs registered in `build.ts` (or `registry.ts`)?
7. **Dead infrastructure code:** Unused repositories, mappers, adapters, handlers, jobs.

**Output:** `review/4-infrastructure/findings.md`

**Docs to check against:** `src/contexts/CONTEXT.md` (The Four Layers, Testing table), per-context CONTEXT.md files (Architecture Layers, Background Jobs sections)

---

### Section 5 — Server Functions (all contexts)

**Scope:** All `src/contexts/*/server/` directories

**What to do:**
1. **Pattern compliance — verify every claim in `src/contexts/CONTEXT.md` (server function pattern):**
   - Every handler wrapped in `tracedHandler()`
   - Every handler calls `resolveTenantContext(headers)` (unless public/anonymous)
   - Every handler calls `clearTenantCache()`
   - Error mapping: pattern-match `_tag` + `code`, throw `Error` with `.name`/`.message`/`.code`/`.status`
   - No raw `return { success: false }` — throw errors
   - `catchUntagged` wrapping for non-domain errors
2. **Validator audit:** Do all server functions have Zod validators? Any missing `.validator()`?
3. **Method audit:** Are HTTP methods correct? (GET for reads, POST for mutations)
4. **Permission defense-in-depth:** For server functions that don't delegate to use cases (e.g., thin wrappers), do they have their own `can()` check?
5. **Route-to-server-fn mapping:** Does every route that calls a server function have that function defined and exported? Any server functions defined but never called from a route?
6. **Dead server functions:** Functions exported but never imported by any route.

**Output:** `review/5-server/findings.md`

**Docs to check against:** `src/contexts/CONTEXT.md` (Server Function Pattern), per-context CONTEXT.md files (Server Functions tables)

---

### Section 6 — Routes

**Scope:** `src/routes/` (all files)

**What to do:**
1. **Pattern compliance — verify every claim in `src/routes/CONTEXT.md`:**
   - **Loaders:** Is every route using `loader` for data fetching (not `useQuery` inside components)?
   - **`useMutationAction`:** Are mutations using `useMutationAction` (not raw `useServerFn`)?
   - **Actions as props:** Server function hooks defined in route files, passed to form components as props. Forms never import server functions directly.
   - **Route guards:** Do protected routes have `can()` in `beforeLoad`?
   - **Dependency rules:** Routes import from `contexts/<ctx>/server/` and `components/` and `shared/`. Never from `domain/`, `application/`, `infrastructure/` (except `type`-only from `dto/`).
2. **Route-to-context mapping:** Does every route that calls a server function respect the bounded context boundaries?
3. **StaleTime audit:** Are `staleTime` values consistent with the strategy table (5 min structural, 60s detail, 30s active)?
4. **Public route audit:** Guest routes, login, webhooks — are they correctly outside `_authenticated`? Do webhook routes follow the exception rules?
5. **Parent loader usage:** Do child routes use `getRouteApi()` to read parent data instead of re-fetching?
6. **i18n/accessibility:** Any hardcoded strings that should be translated? Missing `aria-` attributes?
7. **Dead routes:** Files not referenced by any route tree? Unused route params?

**Output:** `review/6-routes/findings.md`

**Docs to check against:** `src/routes/CONTEXT.md`

---

### Section 7 — Components

**Scope:** `src/components/` (all subdirectories)

**What to do:**
1. **Pattern compliance — verify every claim in `src/components/CONTEXT.md`:**
   - **Kebab-case filenames** — enforce via `scripts/check-filenames.mjs`
   - **Named exports only** — no `export default`
   - **Barrel re-exports** — each feature has `index.ts` exporting page-level components only
   - **Max 150 lines** — flag files exceeding limit (exempt: `ui/`)
   - **Props typing** — `type Props = Readonly<{ ... }>` on all components (exempt: `ui/`)
   - **One concept per folder**
2. **Dependency rule compliance:**
   - Components never import from `domain/`, `application/` (non-dto), `infrastructure/`
   - Components import from `shared/ hooks, utilities, domain types for display`
   - High-mutation components importing from `server/` — are they documented with a comment?
3. **Form pattern audit:**
   - All forms use TanStack Form + Zod v4 + shadcn/ui? Any React Hook Form / Formik / plain useState?
   - Schemas derived from `contexts/<ctx>/application/dto/` (not duplicated)?
   - Submission via `useServerFn` passed as prop (not called directly)?
   - Validation trigger: `validators.onSubmit` (not onChange)?
   - `useServerFn` state drives submit button + error display? No manual `isSubmitting`?
4. **Permission pattern audit:**
   - No `canEdit`/`canCreate` boolean props — use `usePermissions()` instead
   - No `hasRole()` for permission checks — only for hierarchy (sidebar visibility)
5. **Chart compliance:** All charts use shadcn charts? `ChartContainer` wrapper? `var(--color-X)` for fill/stroke? `var(--chart-N)` for colors?
6. **Dead components:** Unused components (exported but imported nowhere). Orphan feature folders.
7. **Anti-pattern scan:**
   - `useQuery` for route-scoped data (should be in loader)
   - Server functions called directly without `useServerFn`
   - Server function hooks defined inside components

**Output:** `review/7-components/findings.md`

**Docs to check against:** `src/components/CONTEXT.md`

---

### Section 8 — Per-Context Deep Dive

**Scope:** Each bounded context reviewed holistically (all layers together). 12 sub-sections, one per context: identity, property, portal, guest, team, staff, integration, review, inbox, metric, goal, dashboard.

**What to do (per context):**
1. **CONTEXT.md vs Code Reconciliation:**
   - Does every entity listed in "Key Entities" exist in domain types?
   - Does every invariant listed actually have enforcement code (in constructors, rules, DB constraints)?
   - Does every event listed in "Events produced/consumed" have corresponding code?
   - Does every use case listed have an implementation?
   - Does every server function listed have a route that calls it?
   - Are there code entities/events/use cases NOT documented in CONTEXT.md?
2. **Layer integrity:**
   - Are all four layers present (domain, application, infrastructure, server)?
   - If a layer is missing (e.g., metric context has no server/ by design), is it documented as intentional?
   - Is `build.ts` wiring all deps correctly?
3. **Schema reconciliation:**
   - Do Drizzle schema tables match the domain types? Any extra/outdated columns?
   - Are all indexes from the plan actually created?
4. **Test coverage scan (not execution — content scan):**
   - Does every domain rule have a test? Every constructor? Every error path?
   - Do all port implementations have integration tests with tenant isolation?
   - Are there use cases with zero tests?
5. **Cross-context dependency audit:**
   - Does this context import from other contexts correctly (only via `public-api.ts`)?
   - Exception: adapter implementations importing the port they implement (allowed).
6. **Vestigial code from deferred/moved features:**
   - Phase 15.5 changes not yet executed: `staffId`/`teamId` on goals, `referralCode` in staff, `teams.portalId`, `getStaffIdForSession`, `resolveReferralCode`, `?ref=` extraction in portal route
   - Any other code for features marked as "deferred" or "removed" in the plan?

**Output:** `review/8-contexts/<context-name>.md` for each of 12 contexts

**Docs to check against:** Each context's `CONTEXT.md`, plus `src/contexts/CONTEXT.md` (general rules)

---

### Section 9 — Cross-Cutting Concerns

**Scope:** Composition root, bootstrap, worker, config, build tooling, test setup.

**What to do:**
1. **Composition root (`src/composition.ts`, `src/bootstrap.ts`):**
   - Are all contexts built and wired?
   - Are all event handlers registered?
   - Are all background jobs registered?
   - Are all cross-context adapters wired correctly?
2. **Build configuration:** `vite.config.ts`, `tsup.config.ts`, `tsconfig.json` — any misconfigurations? Path aliases consistent?
3. **Test infrastructure:** `src/test-setup.ts`, `vitest.config.ts` — complete? Any missing global mocks?
4. **Worker (`src/worker/`):** BullMQ worker setup correct? All jobs from all contexts registered?
5. **Environment config:** `src/shared/config/env.ts` — all required env vars documented? Any unused env vars?
6. **Migrations:** Do Drizzle migrations exist for all schema changes? Any drift between schema files and migration files?
7. **CI/CD:** Does `pnpm build` pass? `pnpm lint`? `pnpm test`?

**Output:** `review/9-cross-cutting/findings.md`

---

## Execution Plan

### Phase 1: Sections 0-3 (infrastructure + core layers)
Sections that establish baselines for everything else. Run sequentially but section-internals can be parallel.

- **Section 0** — Global Sweep (1 session)
- **Section 1** — Shared Infrastructure (1 session)
- **Section 2** — Domain Layer (1 session, can parallel with Section 3)
- **Section 3** — Application Layer (1 session, can parallel with Section 2)

### Phase 2: Sections 4-7 (implementation layers)
Each is large but independent — can run in parallel (4 sessions simultaneously).

- **Section 4** — Infrastructure Layer (1 session)
- **Section 5** — Server Functions (1 session)
- **Section 6** — Routes (1 session)
- **Section 7** — Components (1 session)

### Phase 3: Section 8 — Per-Context Deep Dives
12 contexts. Batch into 3-4 sessions (3-4 contexts per session, parallelizable).

- Session 8A: identity, property, portal (foundational contexts)
- Session 8B: guest, team, staff (mid-tier)
- Session 8C: integration, review, inbox (review pipeline)
- Session 8D: metric, goal, dashboard (analytics pipeline)

### Phase 4: Section 9 — Cross-Cutting
- **Section 9** (1 session)

### Phase 5: Consolidation
- Merge all findings into `review/MASTER-FINDINGS.md`
- Categorize by severity: CRITICAL (build-breaking, security), MAJOR (pattern violation, dead code), MINOR (style, naming), NIT (cosmetic)
- Tag each finding with `[code-fix]` or `[doc-fix]` (which side changes)
- Group related findings into fix batches

**Total:** ~14 sessions. All Phase 2 and Phase 3 sessions can run in parallel.

---

## Finding Format

Every finding uses this structure:

```markdown
### [ID] Severity: Short description

**File:** `path/to/file.ts:45`
**Category:** pattern-violation | dead-code | slop | doc-discrepancy | missing-coverage
**Tag:** [code-fix] | [doc-fix]

**What:** Concise description of the issue.
**Why it matters:** Impact on codebase health, why it contradicts the docs.
**DOCS SAY:** Quote from relevant CONTEXT.md.
**CODE DOES:** What the code actually does.

**Fix direction:** Either the code must change to match the docs, or the docs must be updated. If ambiguous, present both options.
```

---

## Severity Definitions

| Severity | Definition |
|----------|-----------|
| **CRITICAL** | Build failure, security hole, data loss risk, broken invariant |
| **MAJOR** | Clear pattern violation, dead code path, doc/code mismatch on architecture |
| **MINOR** | Style inconsistency, missing but non-critical test, unused import |
| **NIT** | Cosmetic: naming preference, comment clarity, file organization |

---

## Discrepancy Resolution Rules

When code contradicts CONTEXT.md:

1. **If the code is newer/better** and the pattern was intentionally evolved → `[doc-fix]`: Update CONTEXT.md
2. **If the code is a regression/oversight** → `[code-fix]`: Fix the code
3. **If ambiguous** → flag as `[needs-decision]` with both options presented
4. **If the code is vestigial from a deferred feature** (e.g., staffId on goals before Phase 15.5) → `[code-fix]` but note "blocked by Phase 15.5"

---

## Anti-Patterns to Watch For (across all sections)

- `canEdit`/`canCreate` booleans passed as props (should use `usePermissions()`)
- `hasRole()` used for permission checks (should use `can()`)
- `useQuery` for route-scoped data (should use loader)
- Server functions called directly without `useServerFn`
- Business logic in server functions (should be in use cases)
- Direct DB access from routes or components
- `class` / `this` / `enum` (functional style required)
- `console.log` instead of `getLogger()`
- Raw `return { success: false }` instead of throwing tagged errors
- Missing `tracedHandler()` wrapping
- Missing `clearTenantCache()` after server function
- Missing `catchUntagged` for non-domain errors
- Cross-context imports bypassing `public-api.ts`

---

## Tooling Notes

For each section, the reviewer will use:
- `search_files` (grep) — pattern search for imports, anti-patterns, dead references
- `read_file` — reading individual files for detailed analysis
- `terminal` — running `pnpm build`, `pnpm lint`, `depcheck`, `scripts/check-filenames.mjs`
- `execute_code` — programmatic analysis for large-scale checks (e.g., "find all files with `as any`", "check all use cases have permission checks")

**Do NOT use LLM-only review.** Every finding must be verified with tool output — grep results, file reads, build output.

---

## Deliverables

For each section:
- `review/<section>/findings.md` — all findings in standard format
- `review/<section>/summary.md` — counts by severity/category, high-level observations

After consolidation:
- `review/MASTER-FINDINGS.md` — all findings merged, de-duplicated, categorized
- `review/fix-batches.md` — findings grouped into actionable fix batches
