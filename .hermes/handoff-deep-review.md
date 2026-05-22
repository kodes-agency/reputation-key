# Handoff: Deep Code Review Loop (r08–r17)

## What This Session Is About

Executing a sequential deep code review loop against a hexagonal-architecture TypeScript codebase (`reputation-key`). Each review follows: **subagent runs review → triage findings → write plan → implement fixes → verify tsc**. 17 reviews defined in `docs/deep-review.md`.

## Current State

| Review | Status | Findings | Notes |
|--------|--------|----------|-------|
| r01 Architecture & Layering | ✅ Done | 5B 4M 2m | Cross-context imports fixed, public-api barrels added |
| r02 Bounded Context Boundaries | ✅ Done | 7B 4M 2m | Cross-table reads → ports, hasRole→can() |
| r03 Domain Layer Purity (11 ctxs) | ✅ Done | 12B 9M 6m | Branded IDs, domain error factories, validators |
| r04 Application / Use Case Layer | ✅ Done | 2B 16M 3m | PG 23505 extracted to port errors, renames |
| r05 Infrastructure Adapters | ✅ Done | 3B 4M 1m | Config injection (3 adapters), doc comments |
| r06 Server Functions | ✅ Done | 4B 10M | Error leak fixes, gbp-notification relocated, can() added |
| r07 Routes, Loaders & Mutations | ✅ Done | 1B 8M 2m | Mostly clean — component extractions deferred (cosmetic) |
| **r08 React Components & Hooks** | **▶ NEXT** | **Not started** | Subagent was interrupted before starting |
| r09 Permissions & Authorization | Pending | | |
| r10 Auth Flow & Better-auth | Pending | | |
| r11 Multi-tenancy & Tenant Isolation | Pending | | |
| r12 Observability | Pending | | |
| r13 Error Handling & Result Types | Pending | | |
| r14 Type Safety & Naming | Pending | | |
| r15 Tests | Pending | | |
| r16 Per-Context Deep Dive | **DEFERRED** | Skip for now | |
| r17 ADR & Doc Compliance | Pending | | |

## Where to Resume

**Start at r08 (React Components & Hooks).** The subagent was interrupted before it could begin.

### Review Prompts Location
All 17 review definitions are in `docs/deep-review.md`. Each has a "Prompt:" section with BLOCKER/MAJOR/MINOR criteria.

### r08 Prompt Summary (lines 308–330 of docs/deep-review.md)
Review `src/components/` + `src/shared/hooks/` + `src/components/hooks/`:
- **BLOCKER:** canEdit/canCreate props (use usePermissions()), hasRole() gating, toDomainRole() in components, cross-context imports, raw fetch
- **MAJOR:** Conditional hooks, useEffect for derivable state, useEffect for data fetching

### r09–r17: Read each prompt from docs/deep-review.md before running

## Execution Pattern (follow this exactly)

For each review r08–r17 (except r16):

1. **Read the review prompt** from `docs/deep-review.md`
2. **Run review** via `delegate_task` — subagent greps for patterns, reads files, produces findings
3. **Triage findings** — mark each: `relevant` (fix), `outdated-doc` (doc was wrong), `wontfix` (by design), `deferred` (later phase)
4. **Write plan** to `.hermes/plans/deep-review-NN.md`
5. **Implement fixes** via `delegate_task` or direct `patch` calls
6. **Verify** with `npx tsc --noEmit 2>&1 | head -20`
7. **Update progress file** `.hermes/deep-review-progress.json`
8. **Update todo list** — mark completed, advance to next

## Key Files & Paths

- **Working directory:** `/Users/bozhidardenev/conductor/workspaces/reputation-key/hong-kong`
- **Review definitions:** `docs/deep-review.md`
- **Progress file:** `.hermes/deep-review-progress.json` — update `last_updated` timestamp before/after each review
- **Plans:** `.hermes/plans/deep-review-NN.md` (01–07 already exist)
- **Project context:** `CONTEXT.md` (root), `src/contexts/CONTEXT.md`, `src/components/CONTEXT.md`, `src/routes/CONTEXT.md`, `src/shared/CONTEXT.md`
- **11 bounded contexts:** dashboard, guest, identity, inbox, integration, metric, portal, property, review, staff, team

## Key Architecture Facts

- Hexagonal/clean architecture with bounded contexts
- TanStack Start (React) + file-based routing
- Drizzle ORM for Postgres, BullMQ for jobs, Redis for caching
- Branded IDs in `src/shared/domain/ids.ts`
- Permissions: `can(role, permission)` server-side, `usePermissions()` client-side
- Auth: better-auth with `resolveTenantContext()` for server fns
- Multi-tenant: `organizationId` in all tenant-owned table queries
- Server functions: 7-step pattern (tracedHandler, auth, validation, can(), use case, map, error envelope)

## Watchdog Cron

- Job ID: `b7bf6abbf58e`, name: `deep-review-watchdog`
- Runs every 20 min, checks `.hermes/deep-review-progress.json` staleness
- Auto-resumes stalled reviews
- **Update `last_updated` in progress file** before/after each review step to prevent false resumes

## Triage Heuristics Used So Far

- **outdated-doc**: Finding describes intended behavior documented elsewhere (e.g., Dashboard reads tables directly)
- **wontfix**: Finding describes an acceptable pattern (e.g., factory closures, equals() on Readonly types)
- **deferred**: Real issue but low ROI or belongs in later review (e.g., missing tests → r15, inline schemas → r17)
- **relevant**: Must fix — actual violations of architecture rules

## Common Fix Patterns Applied

1. **Cross-context imports** → re-export via `application/public-api.ts`
2. **Raw string IDs** → branded types from `src/shared/domain/ids.ts`
3. **PG error codes in use cases** → port-level error classes
4. **`getEnv()` in adapters** → config injection
5. **`hasRole()`** → `can(role, permission)`
6. **`new Error()` in domain** → domain error constructors
7. **Raw error messages to client** → static messages + server-side logging

## Skills to Use

- `reputation-key` — project conventions
- `diagnose` — if build breaks during fixes
- `writing-plans` — for complex multi-file refactors
