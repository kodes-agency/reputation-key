# Segment 1 — Global Sweep Findings

## S1-1 MAJOR: `pino-pretty` missing from dependencies

**File:** `src/shared/observability/logger.ts`
**Category:** dead-code | doc-discrepancy
**Tag:** [code-fix]

**What:** `pino-pretty` is imported in logger.ts but not listed as a dependency. `depcheck` flags it as a missing dependency.

**Fix direction:** Add `pino-pretty` to `devDependencies` (it's a dev-only pretty-printing dependency).

---

## S1-2 MINOR: `tailwindcss` flagged as unused by depcheck

**File:** `package.json`
**Category:** doc-discrepancy
**Tag:** [needs-decision]

**What:** `tailwindcss` shows as unused by depcheck. It's a PostCSS plugin consumed via config files, not by source imports. This is a known depcheck false positive.

**Fix direction:** No action required. Known depcheck limitation with PostCSS plugins.

---

## CLEAN CHECKS (all passed)

| Check | Result |
|-------|--------|
| `console.log/warn/error` in production code | **ZERO** — clean |
| `@ts-ignore` / `@ts-expect-error` in production code | **ZERO** — clean |
| `TODO:` / `FIXME:` / `HACK:` comments | **ZERO** — clean |
| `as any` in non-generated source | **ZERO** — only in `routeTree.gen.ts` (TanStack Router codegen) |
| `ts-prune` dead export analysis | Not installed — skip |
