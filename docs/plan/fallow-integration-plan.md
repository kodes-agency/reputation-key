# Fallow Integration Plan

> Integrate [Fallow](https://docs.fallow.tools) (codebase-level static analysis: dead code, duplication, complexity, architecture boundaries) into the dev process so the agent self-checks before/after every task, and CI enforces the same policy for everyone.

## Current state (as of 2026-06-16)

| Surface                         | Status                                                                                                                                                                                                                                        |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.fallowrc.json`                | Exists but is **baseline-only** (a recorded `regression.baseline` of 247 issues). No policy: no `entry`, `ignorePatterns`, `rules`, `boundaries`, or `audit` gate.                                                                            |
| CI (`.github/workflows/ci.yml`) | Runs typecheck + lint + test. **No Fallow step.**                                                                                                                                                                                             |
| Husky                           | `pre-commit` = `lint-staged`; `pre-push` = `typecheck` + `lint`. **No Fallow.**                                                                                                                                                               |
| Agent gate (`.claude/`)         | Only `.claude/skills/` installs. **No `PreToolUse` Fallow gate, no AGENTS.md managed block.**                                                                                                                                                 |
| Baseline backlog                | 7 unused files · 104 unused exports · 121 unused types · 6 unused deps · 5 unused devDeps · 3 test-only deps · 1 duplicate export. **Repo is NOT clean** → use `gate: "new-only"` so the gate fails only on _new_ issues, not the legacy 247. |

The codebase already does **manual** layer-integrity audits (regex-based, `docs/audit/layer-integrity-audit.md`) for the exact things Fallow automates deterministically. Fallow replaces that manual pass.

---

## 1. Dev-process integration: the 3-layer check loop

Three gates, each at a different moment. They are complementary, not redundant.

### Layer A — After generating code (agent self-check, proactive)

The agent runs this **after** writing/editing code, **before** staging/committing. Catches newly-orphaned exports, files, and imports the change created.

```bash
# Only the files this task touched vs origin/main. Fast, scoped, JSON for the agent to parse.
fallow dead-code --changed-since origin/main --format json
```

- Clean → proceed to commit.
- New unused export/file → remove it, re-run.
- Use `trace_export` / `trace_file` (MCP) before deleting anything uncertain.

### Layer B — Before commit / push (agent gate, blocking)

A Claude Code `PreToolUse` hook on `Bash` that matches `git commit`/`git push`. Runs `fallow audit` and **blocks only on `verdict: "fail"`**, feeding the JSON findings back to the agent on stderr so it fixes and retries.

Install (writes `.claude/settings.json` + `.claude/hooks/fallow-gate.sh` + a managed AGENTS.md block):

```bash
fallow hooks install --target agent --dry-run   # preview first
fallow hooks install --target agent             # apply
```

Semantics: `audit` defaults to `gate: "new-only"` — an agent editing a file with pre-existing dead exports is punished only for exports _it_ adds. Runtime errors fail **open** (one stderr line) so a missing binary never wedges the loop. `git push --no-verify` does **not** bypass it (it runs before the shell command).

### Layer C — Before PR merge (shared CI gate, for humans + all agents)

Add to `.github/workflows/ci.yml` so every push/PR is gated identically:

```yaml
- name: Fallow audit
  run: pnpm exec fallow audit --format json --quiet
```

`audit` returns exit 0 (pass/warn) or 1 (fail). `--quiet` keeps the log focused on the verdict + introduced findings.

### When each fires

| Moment                             | Gate                                         | Blocks?                                 |
| ---------------------------------- | -------------------------------------------- | --------------------------------------- |
| Agent finishes editing             | `fallow dead-code --changed-since` (Layer A) | No (advisory; agent self-corrects)      |
| Agent runs `git commit`/`git push` | `fallow audit` PreToolUse hook (Layer B)     | Yes, on `fail`                          |
| PR opened / updated                | `fallow audit` in CI (Layer C)               | Yes, on `fail` (shared source of truth) |

> "Before or after each task": **Layer A is the after-task self-check; Layer B is the before-commit block.** Wire both. Layer A catches issues early and cheaply; Layer B guarantees nothing regresses past the agent; Layer C guarantees it for humans and other tools.

---

## 2. Proposed `.fallowrc.json` policy

Replaces the baseline-only file. Keeps the recorded baseline (rename it to `.fallow-baseline.json` via `fallow dead-code --save-baseline`) and adds a real policy.

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/fallow-rs/fallow/main/schema.json",

  // --- Entry points (beyond package.json + framework auto-detection) ---
  "entry": [
    "src/router.tsx", // client + route graph root
    "src/worker/index.ts", // BullMQ worker entry
    "src/bootstrap.ts", // server bootstrap
    "src/composition.ts", // DI composition root
    "scripts/cleanup-kodes.ts", // standalone TS scripts run directly
    "scripts/check-db.ts",
    "vite.config.ts",
    "drizzle.config.ts",
  ],

  // --- Files excluded from ALL analysis (see §3 ignore plan) ---
  "ignorePatterns": [
    "src/routeTree.gen.ts",
    "drizzle/**",
    "dist/**",
    "dist-worker/**",
    ".output/**",
    "e2e/**",
    "docs/**",
    ".claude/**",
  ],

  // --- Packages invoked via dlx/npx or platform-specific, never imported ---
  "ignoreDependencies": [
    "@rolldown/binding-darwin-arm64", // native rolldown binding, optional/platform
    "@tanstack/intent", // invoked via `pnpm dlx`, not imported
    "@better-auth/cli", // invoked via `npx` in auth:* scripts
  ],

  // production: true narrows the "real" pass to non-test source + runtime deps.
  // Run a separate non-production pass occasionally to catch test-only rot.
  "production": false,

  "rules": {
    "unresolved-imports": "error",
    "unlisted-dependencies": "error",
    "duplicate-exports": "error",
    "circular-dependencies": "error",
    "unused-files": "warn",
    "unused-dependencies": "warn",
    "unused-dev-dependencies": "warn",
    "unused-exports": "warn",
    "unused-types": "off",
  },

  "duplicates": {
    "mode": "mild",
    "minTokens": 50,
    "minLines": 5,
    "threshold": 10,
  },

  "health": {
    "maxCyclomatic": 20,
    "maxCognitive": 15,
  },

  "audit": {
    "gate": "new-only", // adoption-friendly: fail only on issues the changeset introduces
  },
}
```

Rationale for rule severities:

- **`error`** for `unresolved-imports`, `unlisted-dependencies`, `duplicate-exports`, `circular-dependencies` — high-confidence bugs, low debate, clear now.
- **`warn`** for the unused-\* family during rollout — visibility without blocking. Promote to `error` per category as each backlog bucket is cleared.
- **`unused-types: off`** initially (121 in baseline — the noisiest bucket). Re-enable to `warn` once exports/files/deps are clean.
- `production` left `false` so the daily pass also covers test files; flip to `true` for the canonical "shipped code" dead-code pass.

---

## 3. Ignore plan (which files to exclude, and why)

### Must ignore — generated / build output (never hand-edited)

| Pattern                                   | Why                                                                                                                                                         |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/routeTree.gen.ts`                    | Auto-generated by TanStack Router (`@tanstack/react-router`). 47 KB of generated route imports. Would produce false unused-export noise and skew the graph. |
| `drizzle/**`                              | Generated SQL migrations + `meta/_journal.json` + `*_snapshot.json`. Not imported by app code.                                                              |
| `dist/**`, `dist-worker/**`, `.output/**` | Build output. Already excluded in `tsconfig.json`.                                                                                                          |

### Should ignore — non-application-source

| Pattern      | Why                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `e2e/**`     | Playwright E2E specs. Standalone entry surface; better excluded than modeled as app graph. (Alternative: `production: true` excludes all test files automatically.) |
| `docs/**`    | Markdown plans, ADRs, audits. Not code.                                                                                                                             |
| `.claude/**` | Agent skill installs + (future) hook scripts. Tooling, not product code.                                                                                            |

### Dependencies to mark always-used (`ignoreDependencies`)

These are invoked by scripts/tools, never statically imported — without an entry Fallow reports them as unused:

| Package                          | Why retained                                                                     |
| -------------------------------- | -------------------------------------------------------------------------------- |
| `@rolldown/binding-darwin-arm64` | Platform-specific native binding for rolldown (optionalDependency).              |
| `@tanstack/intent`               | Skill loader, invoked via `pnpm dlx @tanstack/intent` (AGENTS.md), not imported. |
| `@better-auth/cli`               | Auth schema generator, invoked via `npx` in `auth:generate`/`auth:migrate`.      |

Everything else (test runners, linters, `drizzle-kit`, `tsx`, `tsup`, `husky`, `lint-staged`, `@types/*`) is auto-classified by Fallow's built-in plugins (Vite, Vitest, ESLint, Tailwind) + `package.json` script tracing. **Do not hand-list those** — let detection handle them, then triage survivors.

### Do NOT ignore (common mistakes to avoid)

- `src/contexts/*/server/**` — these are `createServerFn` results, RPC-stubbed for the client; they ARE reachable graph roots. (The Vite import-protection deny list deliberately excludes them — same reason.)
- `src/components/features/*/index.ts` barrels — legitimate re-export surfaces. If they produce `duplicate-export` noise across features, add scoped `ignoreExports` entries, **not** a broad ignore.
- Individual files you "think are dead" — use `trace_file`/`trace_export` to confirm reachability before excluding. Excluding to silence a finding is the anti-pattern.

---

## 4. Architecture boundaries (phased — automates the manual audit)

The repo's manual `layer-integrity-audit.md` checks exactly what Fallow `boundaries` encodes as config. Phase this in **after** the dead-code baseline shrinks, so boundary violations aren't drowned in dead-code noise.

### Phase B1 — within-context layer direction (replaces audit §1)

Encodes the 4-layer rule from `src/contexts/CONTEXT.md` (domain ← application ← infrastructure ← server):

```jsonc
"boundaries": {
  "zones": [
    { "name": "domain",         "patterns": ["src/contexts/*/domain/**"] },
    { "name": "application",    "patterns": ["src/contexts/*/application/**"] },
    { "name": "infrastructure", "patterns": ["src/contexts/*/infrastructure/**"] },
    { "name": "server",         "patterns": ["src/contexts/*/server/**"] },
    { "name": "shared",         "patterns": ["src/shared/**"] },
    { "name": "routes",         "patterns": ["src/routes/**"] },
    { "name": "components",     "patterns": ["src/components/**"] }
  ],
  "rules": [
    { "from": "domain",         "allow": ["shared"] },
    { "from": "application",    "allow": ["domain", "shared"] },
    { "from": "infrastructure", "allow": ["domain", "application", "shared"] },
    { "from": "server",         "allow": ["application", "shared"], "allowTypeOnly": ["domain"] },
    { "from": "shared",         "allow": [] }
  ]
},

- `domain` may import only `shared` (and `shared/domain`). ✓ matches CONTEXT.md.
- `server` → `domain` allowed **type-only** (the documented `isXxxError`/error-code guard exception). ✓
- `routes`/`components` unrestricted here (they reach `server` fns + `shared`); constrain later if desired.

This reproduces the manual "Dependency Direction" check (currently ✅ CLEAN) as an enforced, deterministic rule — preventing regression instead of catching it by hand.

### Phase B2 — cross-context public-api-only (replaces audit §2)

The harder rule: a context may import another context **only** through its `application/public-api.ts`. Layer zones alone can't express file-granularity barrel constraints, so this needs `rulePacks` (banned imports) banning direct `#/contexts/<X>/(domain|infrastructure|server)/` imports from other contexts. **Exact `rulePacks` schema to be confirmed against `/configuration` + `fallow schema` before encoding** — do not guess the syntax. This is where the 2 real violations (V2.1, V2.2) were found manually, so it's the highest-value boundary to automate.

### Phase B3 — client/server boundary (replaces ADR 0015 manual verification)

The Vite `importProtection.client.files` deny list (server-only modules) could be mirrored as a boundary so Fallow also flags client→server-only imports statically. Lower priority — Vite already enforces this at build/dev — but it adds a fast pre-build signal.

---

## 5. Rollout

**Stage 1 — clean (1–2 sessions, agent-driven per Fallow adoption guide §3):**
1. Apply the §2 config + §3 ignores.
2. `fallow dead-code` → clear `unresolved-imports` + `unlisted-deps` (error bucket, zero expected).
3. Delete the 7 unused files (confirm each with `trace_file`).
4. Remove the 6 unused deps + 5 devDeps (confirm with `trace_dependency`).
5. Triage 104 unused exports (delete / `@public` / `ignoreExports` / `@expected-unused`).
6. Re-enable `unused-types: warn`, triage 121 types.
7. Save fresh baseline: `fallow dead-code --save-baseline .fallow-baseline.json`.

**Stage 2 — gates on:**
8. `fallow hooks install --target agent` (Layer B).
9. Add `fallow audit` step to CI (Layer C).
10. Add the AGENTS.md "after editing, run `fallow dead-code --changed-since`" guidance (Layer A).

**Stage 3 — boundaries:**
11. Phase B1 layer-direction zones.
12. Phase B2 cross-context rulePacks (after confirming schema).
13. Phase B3 client/server boundary (optional).

---

## Decisions (recorded 2026-06-16)

1. **Interface: CLI-only.** No `mcpServers` entry. Layer A/B/C all use the `fallow` CLI. Revisit MCP only if the agent routinely needs `trace_export` / `inspect_target`.
2. **Boundaries: staged.** Dead-code cleanup (Stage 1–2) before any boundary zones (Stage 3). Phase B1 → B2 → B3.
3. **`unused-types`: `off` initially**, promoted to `warn` after the unused-exports bucket is cleared.
```
