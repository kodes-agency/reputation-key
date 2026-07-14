# Section 2 — Domain Layer Findings

**Date:** 2026-05-29
**Scope:** All `src/contexts/*/domain/` directories (12 contexts)
**Baseline:** All domain tests pass. Zero `throw`, `class`, `enum`, `async`, or framework imports.

---

## Summary

| Severity  | Count |
| --------- | ----- |
| MAJOR     | 1     |
| MINOR     | 1     |
| NIT       | 1     |
| **Total** | **3** |

---

## MAJOR Findings

### S2-1 MAJOR: Portal context domain — non-standard file naming for portal groups

**Files:**

- `src/contexts/portal/domain/portal-group-constructors.ts`
- `src/contexts/portal/domain/portal-group-events.ts`
- `src/contexts/portal/domain/portal-group-types.ts`

**Category:** pattern-violation
**Tag:** [code-fix]

**What:** The portal context domain splits portal group concerns into separate files with hyphenated names (`portal-group-constructors.ts`, `portal-group-events.ts`, `portal-group-types.ts`) rather than co-locating them in the standard `constructors.ts`, `events.ts`, `types.ts` files with the portal entities.

**Why it matters:** Every other context follows the standard file structure (`types.ts`, `constructors.ts`, `events.ts`, `errors.ts`). Portal groups are part of the portal context (not a separate bounded context per the plan). The hyphenated file naming breaks the pattern and creates ambiguity — a developer looking for portal group constructors might not find them if they only check `constructors.ts`.

**DOCS SAY:** `contexts/<name>/domain/` — `types.ts`, `constructors.ts`, `events.ts`, `errors.ts`
**CODE DOES:** Portal group domain code lives in three separate files outside the standard structure.

**Fix direction:** Merge `portal-group-types.ts` into `types.ts`, `portal-group-constructors.ts` into `constructors.ts`, `portal-group-events.ts` into `events.ts`. If separation is desired for organizational clarity, add a `portal-group/` sub-directory within domain with its own standard files. Either way, don't break the flat naming pattern.

---

## MINOR Findings

### S2-2 MINOR: Identity context — domain has ARCHITECTURE.md instead of standard files

**File:** `src/contexts/identity/domain/ARCHITECTURE.md`
**Category:** pattern-deviation (documented)
**Tag:** [doc-fix]

**What:** Identity context domain is intentionally thin (wraps better-auth). It has no `types.ts` or `constructors.ts`. The `ARCHITECTURE.md` file documents this as an intentional deviation. However, this documentation lives in the domain directory — a non-standard location that a reviewer might miss. The top-level `src/contexts/CONTEXT.md` notes "Thin contexts (like Identity) may have empty layer folders" but doesn't explicitly call out the missing files.

**Why it matters:** The deviation is legitimate and documented, but the documentation is buried in `domain/ARCHITECTURE.md` rather than surfaced in the context's `CONTEXT.md` or the top-level contexts doc.

**Fix direction:** Add a note to `src/contexts/identity/CONTEXT.md` (if it exists) or ensure `src/contexts/CONTEXT.md` explicitly calls out that Identity has no `types.ts`/`constructors.ts` by design. The `ARCHITECTURE.md` file can remain as detailed rationale.

---

## NIT Findings

### S2-3 NIT: Dashboard context — errors.ts exists but has no domain rules

**File:** `src/contexts/dashboard/domain/errors.ts`
**Category:** slop
**Tag:** [code-fix] (minor)

**What:** Dashboard context is a thin read-only aggregation layer. Per its `CONTEXT.md`: "No writes, no events, no domain rules — pure query orchestration." Yet it has an `errors.ts` file. The file likely exists out of structural consistency rather than need.

**Why it matters:** If the dashboard never constructs domain objects or validates input at the domain level, error types may be dead code. Creates expectation that there are domain-level validations when there aren't.

**Fix direction:** Verify whether `errors.ts` exports are actually used. If unused, remove the file and document in `CONTEXT.md` that dashboard has no domain errors by design. If used (e.g., for response validation), keep but document the purpose.

---

## Verified Compliant

1. **No `class` in any domain** — Zero instances across all 12 contexts. Functional style maintained.
2. **No `enum` in any domain** — Zero instances. Union types used instead.
3. **No `throw` in any domain** — Zero instances. All error handling via `Result<T, E>`.
4. **No `async` in any domain** — Zero instances. All domain functions are synchronous.
5. **No framework imports in domain** — No React, Drizzle, or TanStack imports.
6. **No cross-context imports in domain** — Domain only imports from `shared/domain/` and its own domain files.
7. **Constructors return `Result<T, E>`** — All 12 constructor functions across contexts return `Result`. Compliant.
8. **`readonly` on domain fields** — Types use `Readonly<{...}>` wrapper. All fields protected.
9. **Event naming: past-tense** — All events use past tense (`goal.completed`, `scan.recorded`, `review.created`, etc.). No command-style events.
10. **Standard file structure** — All contexts have `types.ts`, `constructors.ts`, `events.ts`, `errors.ts` (except Identity and Dashboard which are documented as intentional deviations).
11. **`_tag` discriminated unions** — All domain events and errors use `_tag` for discrimination.
12. **No `this` usage** — Pure functions throughout.
13. **`ReadonlyArray<T>`** — Used in domain types where arrays appear.
14. **`match(...).exhaustive()`** — Used for union dispatch in rules and constructors.
