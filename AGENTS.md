# context-mode — MANDATORY routing rules

context-mode MCP tools available. Rules protect context window from flooding. One unrouted command dumps 56 KB into context.

## Think in Code — MANDATORY

Analyze/count/filter/compare/search/parse/transform data: **write code** via `ctx_execute(language, code)`, `console.log()` only the answer. Do NOT read raw data into context. PROGRAM the analysis, not COMPUTE it. Pure JavaScript — Node.js built-ins only (`fs`, `path`, `child_process`). `try/catch`, handle `null`/`undefined`. One script replaces ten tool calls.

## BLOCKED — do NOT attempt

### curl / wget — BLOCKED

Intercepted and replaced with error. Do NOT retry.
Use: `ctx_fetch_and_index(url, source)` or `ctx_execute(language: "javascript", code: "const r = await fetch(...)")`

### Inline HTTP — BLOCKED

`fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, `http.request(` — intercepted. Do NOT retry.
Use: `ctx_execute(language, code)` — only stdout enters context

### WebFetch — BLOCKED

Use: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)`

## REDIRECTED — use sandbox

### Bash (>20 lines output)

Bash ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`.
Otherwise: `ctx_batch_execute(commands, queries)` or `ctx_execute(language: "shell", code: "...")`

### Read (for analysis)

Reading to **Edit** → Read correct. Reading to **analyze/explore/summarize** → `ctx_execute_file(path, language, code)`.

### Grep (large results)

Use `ctx_execute(language: "shell", code: "grep ...")` in sandbox.

## Tool selection

1. **GATHER**: `ctx_batch_execute(commands, queries)` — runs all commands, auto-indexes, returns search. ONE call replaces 30+. Each command: `{label: "header", command: "..."}`.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — all questions as array, ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — sandbox, only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — store in FTS5 for later search.

## Subagent routing

Routing block auto-injected into subagent prompts. Bash-type subagents upgraded to general-purpose. No manual instruction needed.

## Output

Terse like caveman. Technical substance exact. Only fluff die.
Drop: articles, filler (just/really/basically), pleasantries, hedging. Fragments OK. Short synonyms. Code unchanged.
Pattern: [thing] [action] [reason]. [next step]. Auto-expand for: security warnings, irreversible actions, user confusion.
Write artifacts to FILES — never inline. Return: file path + 1-line description.
Descriptive source labels for `ctx_search(source: "label")`.

## ctx commands

| Command       | Action                                                                            |
| ------------- | --------------------------------------------------------------------------------- |
| `ctx stats`   | Call `ctx_stats` MCP tool, display full output verbatim                           |
| `ctx doctor`  | Call `ctx_doctor` MCP tool, run returned shell command, display as checklist      |
| `ctx upgrade` | Call `ctx_upgrade` MCP tool, run returned shell command, display as checklist     |
| `ctx purge`   | Call `ctx_purge` MCP tool with confirm: true. Warns before wiping knowledge base. |

After /clear or /compact: knowledge base and session stats preserved. Use `ctx purge` to start fresh.

## Fallow — codebase analysis gate

Fallow (dead code, complexity, boundaries) is installed as a devDependency. Config + regression baseline: `.fallowrc.json` (audit.gate: new-only).

**After editing code, before staging/committing** — self-check the changeset:

```bash
pnpm exec fallow dead-code --changed-since origin/main --format json
```

Clean → proceed. A newly-orphaned export/file → remove it, but **confirm reachability first** with `pnpm exec fallow dead-code --trace <file>:<export> --format json`. Never delete to silence a finding.

**Pre-commit/push gate (automatic):** `.claude/hooks/fallow-gate.sh` (PreToolUse on `Bash`) runs `fallow audit` on every `git commit`/`git push` and **blocks only on `verdict: fail`** — issues your changeset _introduces_ (new-only). It fails open on runtime errors / missing binary. On block: read the JSON findings on stderr, fix, retry.

**CI gate:** `.github/workflows/fallow.yml` runs `fallow audit --gate new-only` on every PR — the shared source of truth.

**WIP caution:** the baseline may include unused exports/files in active work. Do not delete flagged WIP symbols without a `trace` confirming they are truly dead. Prefer `@expected-unused` or leave them for the feature to complete.

## Auth-table schema migrations — STRICT (no manual SQL)

Auth tables and their custom columns are managed by the **better-auth CLI**, never by hand-written SQL. Manual `ALTER TABLE` / `CREATE TABLE` against auth tables is a **STRICT NO** — it desyncs better-auth's migration journal and silently drifts the live DB. (This exact drift once left `invitation.propertyIds` and 7 `organization` billing/SLA columns missing → every invite 500'd.)

**Auth-managed tables (better-auth CLI):** `user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`, and ALL `additionalFields` on them.

**Business tables (Drizzle):** only the tables in `drizzle.config.ts` `tablesFilter` (`properties`, `reviews`, `portals`, …). Use `pnpm db:generate` / `db:migrate`. Drizzle's filter deliberately excludes auth tables — `db:push` will not and must not touch them.

**Single source of truth for auth additionalFields:** `src/shared/auth/org-schema.ts` — imported by BOTH `src/shared/auth/auth.ts` (runtime) and `src/shared/auth/auth-cli.ts` (migration CLI). Edit it ONCE; both configs see the change. Never re-declare additionalFields inline in either file.

**Workflow — adding/changing an auth additionalField (e.g. a new column on `organization` / `invitation`):**

1. Edit `src/shared/auth/org-schema.ts` (the only place).
2. `pnpm auth:generate` → review the generated SQL under `better-auth_migrations/`.
3. `pnpm auth:migrate` to apply.

**Do NOT:**

- Add `scripts/migrations/*.sql` for auth tables — that folder is legacy business-table patches only.
- Re-declare `additionalFields` inline in `auth.ts` or `auth-cli.ts` — use `org-schema.ts`.
- Hand-patch an auth column with raw SQL when the tooling "didn't add it."

If `auth:generate` reports "schema already up to date" but you expect a missing column, the CLI config (`auth-cli.ts`) has drifted from `auth.ts` — fix the shared `org-schema.ts`, then re-generate. Never bypass with manual SQL.

## Agent skills

### Issue tracker

Issues live in GitHub Issues at `kodes-agency/reputation-key`. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Co-located context files in the source tree:

- Root: `CONTEXT.md` — glossary, architecture overview, pointers to layer docs
- Components: `src/components/CONTEXT.md` — folder structure, naming, forms, hooks
- Contexts: `src/contexts/CONTEXT.md` — layers, use cases, server functions, dependency rules
- Shared: `src/shared/CONTEXT.md` — auth, cache, observability, testing
- Routes: `src/routes/CONTEXT.md` — loaders, mutations, auth guards, staleTime
- Plan: `docs/plan/plan.md` — remaining phases (10–22)
- ADRs: `docs/adr/`
