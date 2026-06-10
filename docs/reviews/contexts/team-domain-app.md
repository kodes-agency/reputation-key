# Team Context — Domain & Application Layer Review

**Date:** 2026-06-10
**Scope:** `src/contexts/team/domain/`, `src/contexts/team/application/`, `src/contexts/team/build.ts`
**Dimensions:** D2 (events), D3 (use cases), D4 (build function), D11 (domain purity), D15 (error handling), D12 (CONTEXT.md accuracy)

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 1      |
| MAJOR     | 4      |
| MINOR     | 4      |
| NIT       | 3      |
| **Total** | **12** |

---

## Findings

### [D2] MAJOR — Event constructors use `crypto.randomUUID()` instead of injected IdGenerator

- **File:** `src/contexts/team/domain/events.ts:24`
- **Quote:**
  ```ts
  eventId: crypto.randomUUID(),
  ```
- **Rule:** D11 (domain purity) — domain must not call `crypto` directly; IDs should be injected via `IdGenerator` / Clock port so the domain remains deterministic and testable.
- **Fix:** Accept `eventId` as a constructor argument (like `occurredAt` is asserted), or pass an `idGen` function. All three constructors (`teamCreated`, `teamUpdated`, `teamDeleted`) have the same issue (lines 24, 45, 66).

### [D2] NIT — Event tag naming uses dots (`team.created`) not full context.entity.verb form

- **File:** `src/contexts/team/domain/events.ts:9`
- **Quote:**
  ```ts
  _tag: 'team.created'
  ```
- **Rule:** D2 — Tag naming: `context.entity.verb`, no hyphens. Tags `team.created`, `team.updated`, `team.deleted` omit the context prefix. Other contexts may already use this shorter form as convention; if so, document the exception. This is NIT only if the project convention is consistently 2-part tags.
- **Fix:** Verify project-wide tag convention. If 3-part is required, rename to `team.team.created` etc. Otherwise document the convention.

### [D2] MINOR — `correlationId` always set to `null`, never threaded from use-case context

- **File:** `src/contexts/team/domain/events.ts:25`
- **Quote:**
  ```ts
  correlationId: null,
  ```
- **Rule:** D2 — Envelope fields: eventId, occurredAt, correlationId. All three event constructors hard-code `correlationId: null` and do not accept it as input.
- **Fix:** Add `correlationId` to the constructor args (with fallback `null`) so callers can thread correlation from `AuthContext` or a request-scoped trace.

### [D4] MAJOR — `build.ts` imports `randomUUID` from `crypto` (Node built-in) directly

- **File:** `src/contexts/team/build.ts:17`
- **Quote:**
  ```ts
  import { randomUUID } from 'crypto'
  ```
- **Rule:** D11 — Composition root should wire ports, not embed I/O primitives inline. Using `randomUUID` directly works but bypasses the `IdGenerator` port pattern. The `clock` is correctly injected as `deps.clock`, but `idGen` is constructed ad-hoc rather than from a shared port.
- **Fix:** Minor inconsistency rather than a hard violation. Consider extracting `idGen` to a shared `#/shared/domain/ids` factory for consistency with other contexts.

### [D3] MAJOR — Use cases `throw` domain errors instead of returning `Result`

- **File:** `src/contexts/team/application/use-cases/create-team.ts:32`
- **Quote:**
  ```ts
  throw teamError('forbidden', 'this role cannot create teams')
  ```
- **Rule:** D3 + D15 — Use cases should return typed errors (via `Result` or `Either`). All five use cases use `throw teamError(...)` for every failure path. This includes: `create-team.ts` (lines 32, 38, 46, 63), `update-team.ts` (lines 29, 36, 45, 56), `get-team.ts` (lines 29, 33, 47), `list-teams.ts` (line 29), `soft-delete-team.ts` (lines 31, 37, 47).
- **Fix:** Return `Result<Team, TeamError>` (or `Result<void, TeamError>` for delete) from use cases. Let the server layer map to HTTP. If the project convention is throw-based error flow, document this as an explicit architectural choice.

### [D3] MINOR — `UpdateTeamInput` uses raw `string` for `teamId` instead of branded `TeamId`

- **File:** `src/contexts/team/application/use-cases/update-team.ts:33`
- **Quote:**
  ```ts
  const tid = toTeamId(input.teamId)
  ```
- **Rule:** D3 — Input types should carry domain types where possible. The DTO `UpdateTeamInput` has `teamId: string` and the use case converts it via `toTeamId()`. `SoftDeleteTeamInput` and `GetTeamInput` correctly use `TeamId` branded type. `CreateTeamInput` uses `string` for `propertyId` — same pattern.
- **Fix:** Accept the inconsistency or standardize: either DTOs use raw strings + convert at the boundary (current pattern), or DTOs use branded IDs. Document the convention.

### [D3] MINOR — `listTeams` returns empty array instead of `forbidden` error when user lacks property access

- **File:** `src/contexts/team/application/use-cases/list-teams.ts:41`
- **Quote:**
  ```ts
  if (!idSet.has(input.propertyId)) {
    return []
  }
  ```
- **Rule:** D3 — This silently returns `[]` rather than a `forbidden` error when a non-admin user requests teams for a property they cannot access. While this prevents information leakage (acceptable for list endpoints), it differs from `getTeam` which throws `team_not_found`.
- **Fix:** Intentional design choice for list endpoints. Document this in CONTEXT.md or ADR.

### [D11] BLOCKER — Domain events import `node:assert/strict` (Node built-in I/O)

- **File:** `src/contexts/team/domain/events.ts:4`
- **Quote:**
  ```ts
  import assert from 'node:assert/strict'
  ```
- **Rule:** D11 — Domain purity: no Node built-ins, no I/O, no `process.env`. `node:assert/strict` is a Node runtime module. While `assert` is synchronous and side-effect-free in production, it technically violates the "no Node imports" rule. If `NODE_ENV=production` strips assertions, this is benign but architecturally impure.
- **Fix:** Replace `assert` with a pure validation check:
  ```ts
  if (!(args.occurredAt instanceof Date)) {
    throw teamError('invalid_name', 'occurredAt must be Date')
  }
  ```
  Or use a shared pure assertion utility in `#/shared/domain`.

### [D11] MINOR — `buildTeam` constructor accepts `Date` directly instead of via Clock port

- **File:** `src/contexts/team/domain/constructors.ts:18`
- **Quote:**
  ```ts
  now: Date
  ```
- **Rule:** D11 — Time via Clock port. The constructor takes `now: Date` as input (injected by the caller), which is correct. This is actually compliant — the clock dependency is injected via the use case. Not a violation.
- **Fix:** No fix needed. This is informational.

### [D15] MAJOR — `create-team.test.ts` property API stub throws `new Error('not implemented')`

- **File:** `src/contexts/team/application/use-cases/create-team.test.ts:33`
- **Quote:**
  ```ts
  importProperty: async () => {
    throw new Error('not implemented')
  },
  ```
- **Rule:** D15 — No `throw new Error` in domain/application code. Test stubs should fail gracefully or return a safe default. If `importProperty` is accidentally called, the generic `Error` is untyped and bypasses `isTeamError` checks.
- **Fix:** Return a safe value or use `teamError('forbidden', ...)` instead.

### [D12] MAJOR — CONTEXT.md claims `team.read` is "reserved for future use" but it is actively enforced

- **File:** `src/contexts/team/CONTEXT.md:79`
- **Quote:**
  ```
  - `team.read` — List/view teams (reserved for future use — currently gated at use-case level)
  ```
- **Rule:** D12 — Verify CONTEXT.md claims match actual code. In reality, `team.read` is actively enforced in `getTeam` (line 27: `can(ctx.role, 'team.read')`) and `listTeams` (line 28: `can(ctx.role, 'team.read')`). The permission is not "reserved for future use" — it is live.
- **Fix:** Update CONTEXT.md to reflect that `team.read` is actively enforced for get/list operations.

### [D12] NIT — CONTEXT.md does not document `AssignmentCheckPort` or `team_has_assignments` error code

- **File:** `src/contexts/team/CONTEXT.md:41`
- **Quote:**
  ```
  team/
    domain/              types.ts, constructors.ts, events.ts, errors.ts, rules.ts
    application/
      ports/             team.repository.ts
  ```
- **Rule:** D12 — Architecture layers section omits `assignment-check.port.ts` from the ports directory listing. The `team_has_assignments` error code exists in `errors.ts` but is not mentioned in the glossary or invariants section.
- **Fix:** Add `assignment-check.port.ts` to the architecture layers listing. Add a note about the deletion guard invariant ("Teams with active assignments cannot be deleted").

### [D12] NIT — CONTEXT.md events section omits `propertyId` from `team.updated` description

- **File:** `src/contexts/team/CONTEXT.md:30`
- **Quote:**
  ```
  - **`team.updated`** — teamId, organizationId, propertyId, name, occurredAt.
  ```
- **Rule:** D12 — Verify CONTEXT.md events match actual code. The code at `events.ts:30-39` shows `TeamUpdated` includes `eventId` and `correlationId` in its envelope. The CONTEXT.md lists the payload fields but not envelope fields. Same for `team.created` and `team.deleted`.
- **Fix:** Document envelope fields (`eventId`, `correlationId`) in the events section, or note that they are implicit per the event standard.

---

## Positive Observations

1. **D3 structure is strong**: All five use cases follow the 7-step pattern (authorize → load → check rules → build domain → persist → emit → return) or a clean subset appropriate to the operation.

2. **D1 layer boundaries respected**: Domain layer imports only `#/shared/domain/ids` and local modules. Application layer imports domain types, shared ports, and other contexts' `public-api.ts` — never reaching into infrastructure or server layers.

3. **D5 repository port**: Every method takes `orgId` as the first parameter. Adapter pattern is clean.

4. **D6 authorization**: All use cases use `can(role, permission)` from shared. No `hasRole` or bare string equality.

5. **D7 multi-tenancy**: `ctx.organizationId` flows through every repo call. No `organizationId` from request body.

6. **D8 build.ts**: Clean composition root — wires deps, creates repo, injects anti-corruption port for assignment checks.

7. **D15 error handling**: `TeamError` is a tagged union with closed error codes. `isTeamError` type guard available. Consistent `_tag: 'TeamError'` pattern.

8. **Test coverage**: All use cases have test files covering happy path + error paths. Domain modules (constructors, errors, rules) also have dedicated tests.
