# Section 0 — Global Sweep Findings

**Date:** 2026-05-29
**Scope:** Entire `src/` tree + config files + build tooling
**Baseline:** Build ✓ | Lint ✓ | Tests 1689/1690 pass (1 deadlock in DB integration test)

---

## Summary

| Severity  | Count  |
| --------- | ------ |
| MAJOR     | 8      |
| MINOR     | 5      |
| NIT       | 2      |
| **Total** | **15** |

---

## MAJOR Findings

### G0-1 MAJOR: Duplicate lockfiles — pnpm-lock.yaml + package-lock.json

**File:** Root directory
**Category:** slop
**Tag:** [code-fix]

**What:** Both `pnpm-lock.yaml` (11,364 lines) and `package-lock.json` (15,306 lines) exist in the project root. The project uses pnpm 9.15.9 (configured in `package.json` scripts, `.npmrc` absent but pnpm is the tool used). The npm lockfile is a vestige of a failed npm install or tool switch.

**Why it matters:** Two lockfiles create ambiguity — CI or other developers might use the wrong one, causing different dependency trees. Adds ~15K lines of noise to the repo.

**Fix direction:** Delete `package-lock.json`. Add `package-lock.json` to `.gitignore` to prevent accidental regeneration.

---

### G0-2 MAJOR: Unused dependency `@tanstack/react-router-devtools`

**File:** `package.json:40`
**Category:** dead-code
**Tag:** [code-fix]

**What:** `@tanstack/react-router-devtools` is listed as a `dependencies` entry but is never imported in any source file (`grep -r 'react-router-devtools' src/` returns zero results).

**Why it matters:** Adds to bundle size analysis, install time, and audit surface. Unused production dependency.

**Fix direction:** Remove from `dependencies` in `package.json`.

---

### G0-3 MAJOR: Unused dependency `@rolldown/binding-darwin-arm64` as direct dep

**File:** `package.json:37`
**Category:** dead-code / slop
**Tag:** [code-fix]

**What:** `@rolldown/binding-darwin-arm64` is a platform-specific binary package for rolldown. It's listed as a direct `dependencies` entry but never imported in source code. It appears in `pnpm-lock.yaml` as a transitive dependency of other packages (at versions `1.0.0-rc.16`, `1.0.0-rc.18`, `1.0.1`), suggesting it was manually added to solve a platform resolution issue rather than being genuinely needed as a direct dep.

**Why it matters:** Platform-specific binaries should not be direct dependencies — they break installs on other platforms (Linux, Windows, non-ARM Macs). The package manager resolves platform binaries automatically.

**Fix direction:** Remove from `dependencies` in `package.json`. If rolldown's optional dependency resolution fails, file an upstream issue rather than pinning a platform binary.

---

### G0-4 MAJOR: Unused devDependencies — `@testing-library/dom`, `@testing-library/react`

**File:** `package.json` devDependencies
**Category:** dead-code
**Tag:** [code-fix]

**What:** Both `@testing-library/dom` and `@testing-library/react` are listed as devDependencies but never imported anywhere in `src/`. The project uses Vitest for testing — not Testing Library.

**Why it matters:** Dead devDependencies add install time and clutter.

**Fix direction:** Remove from `devDependencies` in `package.json`.

---

### G0-5 MAJOR: Unused devDependency `@vitest/coverage-v8`

**File:** `package.json` devDependencies
**Category:** dead-code
**Tag:** [code-fix]

**What:** `@vitest/coverage-v8` is listed as devDependency but no coverage configuration exists in `vitest.config.ts` (no `coverage` key). No scripts reference coverage.

**Why it matters:** Dead devDep.

**Fix direction:** Remove from `devDependencies` or add coverage configuration if desired.

---

### G0-6 MAJOR: Unused devDependency `@tailwindcss/typography`

**File:** `package.json` devDependencies
**Category:** dead-code
**Tag:** [code-fix]

**What:** `@tailwindcss/typography` is listed as devDependency but never imported in any source file, config file, or CSS file. No `prose` classes found in components.

**Why it matters:** Dead devDep.

**Fix direction:** Remove from `devDependencies` in `package.json`.

---

### G0-7 MAJOR: Unused devDependency `jsdom`

**File:** `package.json` devDependencies
**Category:** dead-code
**Tag:** [code-fix]

**What:** `jsdom` is listed as devDependency but `vitest.config.ts` uses `environment: 'node'`, not `'jsdom'`. No test files use jsdom directly.

**Why it matters:** Dead devDep.

**Fix direction:** Remove from `devDependencies` in `package.json`.

---

### G0-8 MAJOR: Stale TODO — Phase 12 already completed

**File:** `src/components/inbox/inbox-detail-content.tsx:154`
**Category:** slop
**Tag:** [code-fix]

**What:**

```
// TODO(Phase 12): Pass currentUserId from auth context for "You" label
```

Phase 12 (Reply Flow) is marked **Completed** in `docs/plan/plan.md:710`. The feature it references has already shipped. The TODO is stale.

**Verify:** Check if the "You" label feature is implemented — if yes, remove the TODO. If not, update the TODO to reference the correct remaining work.

**Fix direction:** Verify whether `currentUserId` is available in this component via route context. If yes, implement the feature and remove TODO. If no, update TODO to specify what's still needed.

---

## MINOR Findings

### G0-9 MINOR: Stale TODO — staff context already built

**File:** `src/routes/_authenticated.tsx:160`
**Category:** slop
**Tag:** [code-fix]

**What:**

```
// TODO: wire to real team membership query when staff context is built
```

The staff context was built in Phase 6 and is implemented. `hasTeam={false}` is hardcoded — the TODO should have been resolved.

**Fix direction:** Wire to real team membership query, or if intentionally deferred, update comment to explain when it will be wired.

---

### G0-10 MINOR: Dead export — `groupAssignmentsByTeam`

**File:** `src/lib/lookups.ts:52`
**Category:** dead-code
**Tag:** [code-fix]

**What:** `groupAssignmentsByTeam` is exported but never imported by any file in `src/`. `grep -r 'groupAssignmentsByTeam' src/` returns only its definition.

**Why it matters:** Dead code adds maintenance burden — if the function signature changes, nothing breaks, but nothing benefits either.

**Fix direction:** Remove the function. If it's needed for a future phase, move it to the phase's plan document instead of the codebase.

---

### G0-11 MINOR: 4 TODO comments in production code (non-stale)

**Files:**

- `src/contexts/goal/application/use-cases/create-goal.ts:221` — Transaction wrapping for template goal persistence
- `src/contexts/goal/application/use-cases/cancel-goal.ts:57` — Transaction wrapping for cancelByParent
- `src/contexts/goal/infrastructure/jobs/spawn-recurring-instances.job.ts:106` — Unique DB constraint for dedup

**Category:** slop
**Tag:** [code-fix]

**What:** Three TODOs in the goal context about transactional safety and DB constraints. These are legitimate deferred work items.

**Why it matters:** TODOs in production code without tracking issues get forgotten. They should either be fixed or tracked in GitHub Issues.

**Fix direction:** Create GitHub Issues for each TODO and reference the issue number in the comment. Alternatively, resolve them if the work is straightforward.

---

### G0-12 MINOR: Commented-out code blocks in production files

**Files:**

- `src/shared/auth/auth.ts:19` — `// import { sendVerificationEmail } from './emails'`
- `src/shared/auth/auth.ts:25` — `// function is injected via setOnAcceptInvitation()`

**Category:** slop
**Tag:** [code-fix]

**What:** Commented-out import and explanatory comment about injection. The import is dead code; the injection comment is documentation that belongs in a proper doc comment, not a commented-out line.

**Fix direction:** Remove the commented-out import. Convert the injection explanation to a JSDoc comment on the relevant function.

---

### G0-13 MINOR: Commented-out code blocks — documentation examples in source

**Files:** Multiple domain constructors have:

```
// returning a Result."
```

This appears to be a fragment of a larger comment that was partially deleted.

**Category:** slop
**Tag:** [code-fix]

**What:** Several `domain/constructors.ts` files have orphaned comment fragments like `// returning a Result."` — these are remnants of incomplete comment edits.

**Fix direction:** Remove orphaned comment fragments. If the constructor behavior needs documentation, add a proper JSDoc block.

---

## NIT Findings

### G0-14 NIT: Husky prepare script fails

**File:** `package.json:31`
**Category:** slop
**Tag:** [code-fix]

**What:** `"prepare": "husky"` runs on `pnpm install` but fails with `sh: husky: command not found`. Husky is configured (`.husky/pre-commit` runs `pnpm exec lint-staged`, `.husky/pre-push` exists) but the prepare script uses the wrong command. Modern husky uses `husky install` or is initialized differently.

**Fix direction:** Either fix the prepare script (`npx husky install` or `husky`) or remove husky entirely if git hooks aren't needed. The lint-staged config is present in `package.json`.

**Note:** `lint-staged` itself is a devDependency and IS configured (`package.json:105`).

---

### G0-15 NIT: 5 `.gitkeep` files for empty directories

**Files:**

- `src/contexts/.gitkeep`
- `src/shared/events/.gitkeep`
- `src/shared/jobs/.gitkeep`
- `src/shared/rate-limit/.gitkeep`
- `src/shared/testing/.gitkeep`

**Category:** slop
**Tag:** [code-fix]

**What:** `.gitkeep` files mark empty directories. Most of these directories now have content (`events/` has 3 files, `jobs/` has 4 files, `testing/` has many files, `rate-limit/` has 2 files). The `.gitkeep` files are no longer needed.

**Fix direction:** Remove `.gitkeep` files from directories that are no longer empty. Keep only in truly empty directories.

---

## Verified Non-Issues (no action needed)

1. **`as any` in `routeTree.gen.ts`** — Auto-generated file. 44 occurrences, all in route tree type definitions. Expected for TanStack Router codegen. No action.
2. **`console.log` in production** — Zero instances found. All logging goes through pino `getLogger()`. Compliant.
3. **`@ts-ignore` / `@ts-expect-error`** — Zero instances found in entire codebase. Excellent discipline.
4. **`tw-animate-css`** — Depcheck flagged as unused, but it's imported via `@import 'tw-animate-css'` in `src/styles.css:5`. FALSE POSITIVE.
5. **`tsx`, `@eslint/js`, `@tanstack/devtools-vite`, `@aws-sdk/*`, `@playwright/test`** — All depcheck FALSE POSITIVES. These are used in config files, scripts, or CLI tools.
6. **Build** — Passes clean (512ms).
7. **Lint** — ESLint + check-filenames pass clean.
8. **File naming** — All component files use kebab-case. Script passes.
9. **Test count** — 178 test files, 1690 tests. 177/178 files pass. 1 deadlock failure in staff-assignment repository integration test — infrastructure issue, not code.
10. **No dead files detected** — Heuristic sweep found no source files with exports and zero importers (excluding framework-consumed entry points).
