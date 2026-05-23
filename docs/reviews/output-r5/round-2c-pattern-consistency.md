# Round 2C — Pattern Consistency + Naming + Slop Hunt

### [MAJOR] `hasRole()` used in 7 inbox use cases — forbidden pattern per ADR-0001

**File:** `src/contexts/inbox/application/use-cases/` (update-inbox-status, get-inbox-items, assign-inbox-item, bulk-update-inbox-status, get-inbox-item-detail, get-inbox-notes, add-inbox-note)
**Fix:** Replace `hasRole(role, ADMIN_ROLE)` with `can(role, 'inbox.read')` / `can(role, 'inbox.write')` / `can(role, 'inbox.manage')` as appropriate.

### [MAJOR] `hasRole()` used in `list-google-connections` for visibility filter

**File:** `src/contexts/integration/application/use-cases/list-google-connections.ts:28`
**Fix:** Replace `hasRole(ctx.role, 'AccountAdmin')` with `can(ctx.role, 'integration.manage')`.

### [MAJOR] `hasRole()` in staff `create-staff-assignment` for self-assignment check

**File:** `src/contexts/staff/application/use-cases/create-staff-assignment.ts:65`
**Fix:** Use `can(ctx.role, 'staff_assignment.create')` for the guard. The `isSelfAssignment` check is a domain rule, keep the hasRole only in `domain/rules.ts`.

### [MAJOR] `throw new Error()` in goal create-goal use case — domain should never throw

**File:** `src/contexts/goal/application/use-cases/create-goal.ts:201,270`
**Fix:** Replace `throw new Error(...)` with `err(goalError('unexpected', ...))` — use cases must return Result, never throw.

### [MINOR] `hasRole()` in domain/rules.ts files — acceptable for domain rules

**File:** `src/contexts/inbox/domain/rules.ts:43`, `src/contexts/identity/domain/rules.ts:64,97,102,112`
**Fix:** Domain rules are the correct place for role checks — these are fine. Document in CONTEXT.md that domain rules may use hasRole directly.

### [MINOR] Magic string OAuth scopes in google-connections server

**File:** `src/contexts/integration/server/google-connections.ts:72-74`
**Fix:** Extract to constants: `const GBP_OAUTH_SCOPES = ['https://...', ...]`.

### [MINOR] Magic string OAuth scopes in google-oauth adapter

**File:** `src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts`
**Fix:** Same — extract to shared constants.

### [MINOR] No barrel `index.ts` files in any context

**File:** All `src/contexts/*/`
**Fix:** Not required — contexts use direct imports via `#/contexts/X/...` path aliases. Document as intentional.

### [NIT] Context layer directories all present (domain, application, infrastructure, server)

**Fix:** No action needed — all 12 contexts have the standard 4 layers.

### [NIT] No console.log/warn/error in production code

**Fix:** No action needed — clean.

### [NIT] No TODO/FIXME/HACK comments found

**Fix:** No action needed — clean.

## Summary

BLOCKER: 0, MAJOR: 4, MINOR: 3, NIT: 3
