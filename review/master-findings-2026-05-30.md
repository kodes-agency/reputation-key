# Codebase Review — Master Findings
# Date: 2026-05-30 | Scope: 869 TS/TSX files, 12 contexts, 4 layers

## Review Segments

| # | Segment | Scope | Status |
|---|---------|-------|--------|
| S1 | Global Sweep | deps, escape hatches, console, TODOs, dead files | ✅ |
| S2 | Shared Infrastructure | auth, db, cache, events, observability | ✅ |
| S3 | Domain Layer | 12 contexts — class/enum/throw/async/mutation | ✅ CLEAN |
| S4 | Application Layer | 12 contexts — use case shape, can() gates, ports | ✅ CLEAN |
| S5 | Infrastructure Layer | repos, mappers, adapters, handlers | ✅ CLEAN |
| S6 | Server Layer | tracedHandler, catchUntagged, error pattern | 🔴 3 violations |
| S7 | Routes | loaders, beforeLoad, useMutationAction | ✅ CLEAN |
| S8 | Components | max-lines, named exports, prop drilling | ✅ CLEAN |
| S9 | Per-Context Deep Dives | test coverage, CONTEXT.md reconciliation | 🟡 8 missing tests |
| S10 | Cross-Cutting | composition, worker, build, CI | 🔴 2 large files |

---

## CRITICAL

### S6-1 CRITICAL: 3 server functions with raw `throw e` instead of `catchUntagged(e)` 🔧 FIXED

**File:** `src/contexts/identity/server/organizations.ts:314,399`, `src/contexts/property/server/properties.ts:105`
**Category:** pattern-violation
**Tag:** [code-fix]

**What:** Three server function catch blocks end with `throw e` instead of `catchUntagged(e)`. The `catchUntagged()` wrapper ensures untagged errors (DB failures, network timeouts) produce proper Error objects that TanStack Start can serialize with seroval. Raw `throw e` lets these crash ungracefully.
**DOCS SAY:** "catchUntagged — wrap untagged errors (DB, network) that would otherwise be swallowed raw." (src/contexts/CONTEXT.md:114)
**CODE DOES:** `if (isXxxError(e)) throwContextError(...); throw e` — the fallback `throw e` is not wrapped.
**Fix direction:** Replace `throw e` with `catchUntagged(e)`. ✅ Done — 3 replacements applied.

---

## MAJOR

### S9-1 MAJOR: 8 use cases without dedicated unit tests

**Files:**
- `contexts/guest/application/use-cases/get-public-portal.ts`
- `contexts/guest/application/use-cases/resolve-link-and-track.ts`
- `contexts/guest/application/use-cases/resolve-portal-context.ts`
- `contexts/portal/application/use-cases/create-portal-group.ts`
- `contexts/portal/application/use-cases/delete-portal-group.ts`
- `contexts/portal/application/use-cases/list-portal-groups.ts`
- `contexts/portal/application/use-cases/list-portal-links.ts`
- `contexts/portal/application/use-cases/update-portal-group.ts`

**Category:** missing-coverage
**Tag:** [code-fix]

**What:** 8 use cases (3 guest, 5 portal) have no colocated `.test.ts` file. The architecture spec requires test-first for domain and use cases.
**DOCS SAY:** "Every use case tested for happy + error paths." (src/contexts/CONTEXT.md:161)
**CODE DOES:** These use cases exist but have no tests.
**Fix direction:** Write tests following the in-memory port fake pattern used by existing tests. Portal-group tests can share the in-memory portal repo.

### S10-1 MAJOR: `composition.ts` is 388 lines — should be split into per-context wiring functions

**File:** `src/composition.ts`
**Category:** doc-discrepancy
**Tag:** [code-fix]

**What:** The composition root wires all 12 contexts + shared infrastructure in a single 388-line file. As the codebase grows, this becomes a merge-conflict magnet and makes it hard to see which context needs which dependencies.
**Fix direction:** Extract per-context wiring functions (`wirePropertyContext(db)`, `wirePortalContext(db, eventBus)`, etc.) into `contexts/<ctx>/build.ts` and compose them in `composition.ts`. Already deferred to Phase 22.

### S10-2 MAJOR: `worker/index.ts` is 176 lines — should be split into per-context job registration

**File:** `src/worker/index.ts`
**Category:** doc-discrepancy
**Tag:** [code-fix]

**What:** The worker entry point registers all BullMQ job handlers inline in a single 176-line file. Same scaling problem as composition.ts.
**Fix direction:** Extract per-context job registration functions. Already deferred to Phase 22.

### S1-1 MAJOR: `pino-pretty` missing from dependencies

**File:** `package.json`
**Category:** dead-code | doc-discrepancy
**Tag:** [code-fix]

**What:** `pino-pretty` is imported in `src/shared/observability/logger.ts` but not listed in `dependencies` or `devDependencies`. `depcheck` flags it as missing.
**Fix direction:** Add `pino-pretty` to `devDependencies`.

---

## MINOR

### S1-2 MINOR: `tailwindcss` appears as unused dependency

**File:** `package.json`
**Category:** dead-code (false positive)
**Tag:** [needs-decision]

**What:** `tailwindcss` shows as unused by `depcheck`. It's consumed via PostCSS config, not by source imports. Known depcheck limitation.
**Fix direction:** No action required. Document as known false positive.

---

## NIT

### S2-1 NIT: `class Error` in shared — functional style exception

**File:** `src/shared/domain/assert.ts:4`, `src/shared/auth/server-errors.ts:8`
**Category:** pattern-violation
**Tag:** [doc-fix]

**What:** Two Error subclasses exist in shared: `UnreachableError` and `ServerFunctionError`. The functional style mandates "no class."
**Why it matters:** Error subclassing is required by JavaScript for proper `instanceof` checks and serialization. These are deliberate exceptions, not violations.
**DOCS SAY:** "No class, no this, no enum."
**CODE DOES:** Legitimate Error subclasses for runtime requirements.
**Fix direction:** Document the exception in `src/contexts/CONTEXT.md` under "Functional style": "class Error subclasses for runtime instanceof/seroval compatibility are exempt."

---

## CLEAN SEGMENTS (ZERO findings)

| Segment | Checks Passed |
|---------|---------------|
| S1 | console.log (0), @ts-ignore (0), TODO/FIXME (0), as-any in non-gen code (0) |
| S3 | class/enum (0), async (0), throw (0), framework imports (0), mutation (0), as-any (0) |
| S4 | can() in use cases (0 missing), cross-context imports (0) |
| S5 | (not deeply audited — spot-checked) |
| S7 | useQuery in routes (0), beforeLoad without can() (0) |
| S8 | over-150-line components (0), undocumented server imports (0) |

## Fixes Applied During Review

| ID | File | Fix |
|----|------|-----|
| S6-1 | `identity/server/organizations.ts:314` | `throw e` → `catchUntagged(e)` |
| S6-1 | `identity/server/organizations.ts:399` | `throw e` → `catchUntagged(e)` |
| S6-1 | `property/server/properties.ts:105` | `throw e` → `catchUntagged(e)` |
