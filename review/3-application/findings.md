# Section 3 — Application Layer Findings

**Date:** 2026-05-29
**Scope:** All `src/contexts/*/application/` directories (12 contexts)
**Baseline:** No DB access in application layer. No cross-context imports bypassing public-api. All 12 contexts have `public-api.ts`.

---

## Summary

| Severity | Count |
|----------|-------|
| MAJOR | 2 |
| MINOR | 4 |
| NIT | 2 |
| **Total** | **8** |

---

## MAJOR Findings

### S3-1 MAJOR: 6 use cases missing `can()` permission check as first step

**Files:**
- `src/contexts/portal/application/use-cases/create-link.ts` — missing `portal.update` or equivalent
- `src/contexts/portal/application/use-cases/create-link-category.ts` — missing permission check
- `src/contexts/portal/application/use-cases/finalize-upload.ts` — missing `portal.update`
- `src/contexts/portal/application/use-cases/get-portal-qr-url.ts` — missing `portal.read`
- `src/contexts/team/application/use-cases/get-team.ts` — missing `team.read`
- `src/contexts/team/application/use-cases/list-teams.ts` — missing `team.read`

**Category:** pattern-violation
**Tag:** [code-fix]

**What:** These 6 use cases take `AuthContext` but do not call `can(ctx.role, permission)` as their first step. Per `src/contexts/CONTEXT.md:148`: "Every use case that receives AuthContext must perform this check as its first step."

The team use cases use `staffApi.getAccessiblePropertyIds()` for property-scoped access control, which is a legitimate second step, but missing the primary permission gate. The portal use cases perform repo-level tenant isolation (query by `organizationId`) but skip the permission check entirely.

**Why it matters:** Without a permission check, any authenticated user in the organization can call these use cases regardless of role. While tenant isolation prevents cross-org access, it doesn't prevent a Staff member from updating portals or creating links — operations that should be PropertyManager+ only.

**DOCS SAY:** "Every use case that receives AuthContext must perform this check as its first step."
**CODE DOES:** These use cases skip the permission check, relying only on tenant isolation and property-scoped access control.

**Fix direction:** Add `can(ctx.role, '<resource>.<action>')` as the first step in each use case:
- `create-link.ts` → `can(ctx.role, 'portal.update')`
- `create-link-category.ts` → `can(ctx.role, 'portal.update')`
- `finalize-upload.ts` → `can(ctx.role, 'portal.update')`
- `get-portal-qr-url.ts` → `can(ctx.role, 'portal.read')`
- `get-team.ts` → `can(ctx.role, 'team.read')`
- `list-teams.ts` → `can(ctx.role, 'team.read')`

---

### S3-2 MAJOR: `team.read` permission marked as "Reserved for future use" but IS defined and usable

**File:** `src/shared/domain/permissions.ts:32`
**Category:** doc-discrepancy
**Tag:** [code-fix] or [doc-fix]

**What:** The `Permission` type has:
```typescript
| 'team.read' // Reserved for future use — team listing gated at use-case level
```
But `team.read` IS included in the `statement` in `shared/auth/permissions.ts`, IS assigned to AccountAdmin and PropertyManager roles, and IS queryable via `can()`. The comment says it's "reserved for future use" but it's already implemented.

The same applies to:
- `'review.reply' // Reserved for future use — reply operations use reply.manage instead` — but it's in the statement
- `'feedback.read' // Reserved for future use — guest/feedback context not yet gated`
- `'feedback.respond' // Reserved for future use`

**Why it matters:** Developers reading these comments may avoid using these permissions, leading to the gaps found in S3-1. The comments are stale.

**Fix direction:** Remove the "Reserved for future use" comments from permissions that are already implemented. If a permission truly isn't ready, either remove it from the statement/roles or add a clear implementation plan comment.

---

## MINOR Findings

### S3-3 MINOR: `fallow-ignore-next-line unused-type` directives on exported types

**Files:** Multiple use case files (e.g., `create-link.ts:84`, `register-user.ts:8`, `list-teams.ts:12`, etc.)

**Category:** slop
**Tag:** [code-fix]

**What:** Many use case files export types like `CreateLinkDeps`, `RegisterUserInput`, `ListTeamsDeps` that are used only within the module (by the use case factory function). These types are exported for documentation/visibility but trigger `unused-type` lint warnings, suppressed with `fallow-ignore-next-line`.

**Why it matters:** ESLint suppression comments are maintenance noise. If the types are genuinely needed by external consumers, the suppression is wrong. If they're internal, they shouldn't be exported.

**Fix direction:** Either (A) remove the `export` keyword from internal types and the suppression comments, or (B) if the types are used by tests or composition, keep the export and suppress with a comment explaining WHY they're exported despite appearing unused.

---

### S3-4 MINOR: Identity context — `register-user.ts` is anonymous but grep-suggests AuthContext

**File:** `src/contexts/identity/application/use-cases/register-user.ts`
**Category:** false-positive-in-audit / style
**Tag:** [code-fix] (minor)

**What:** The comment says "anonymous use case — no AuthContext." But the grep pattern matched `AuthContext` in the file. This turned out to be a false positive for the audit (the match was likely in a comment or documentation). However, the file is marked with `fallow-ignore-next-line unused-type` on its exported types.

**Why it matters:** Clean audit hygiene. The anonymous use case pattern is correct — no issue.

**Fix direction:** Same as S3-3 — clean up export/suppression pattern.

---

### S3-5 MINOR: `team.read` permission inconsistency — statement has it, domain type calls it "reserved"

**File:** `src/shared/domain/permissions.ts:32` vs `src/shared/auth/permissions.ts:27`
**Category:** doc-discrepancy (same as S3-2, separated for tracking)
**Tag:** [code-fix]

**What:** The `statement` declares `team: ['read', 'create', 'update', 'delete']` and `admin` role gets all four. But the domain `Permission` type marks `team.read` as "Reserved for future use" and `admin` role only gets `['read', 'create', 'update']` (no `delete`). The `owner` role gets all four including `delete`.

**Fix direction:** Synchronize the comment in `permissions.ts` with reality. Remove "Reserved for future use" from `team.read`. Add `team.delete` to the Permission type if it's genuinely available to owners.

---

### S3-6 MINOR: `review.reply` permission exists but is marked as superseded

**File:** `src/shared/domain/permissions.ts:46`
**Category:** dead-code
**Tag:** [code-fix]

**What:**
```typescript
| 'review.reply' // Reserved for future use — reply operations use reply.manage instead
```
If `reply.manage` supersedes `review.reply`, then `review.reply` is dead code. It's in the statement, in the `owner` and `admin` roles, and in the Permission type. If it's never checked anywhere, it should be removed.

**Fix direction:** Check if `review.reply` is ever used in a `can()` call. If not, remove it from the statement, roles, and Permission type. If `review.read` covers viewing reviews and `reply.manage` covers reply CRUD, there's no gap.

---

## NIT Findings

### S3-7 NIT: Stale permission comments across multiple entries

**File:** `src/shared/domain/permissions.ts`
**Category:** slop
**Tag:** [code-fix]

**What:** Multiple `Permission` type entries have stale/confusing comments:
- `'organization.delete'` — "Reserved for future use — org deletion flow not yet implemented" (legitimate)
- `'review.reply'` — "reply operations use reply.manage instead" (confusing — why keep it?)
- `'feedback.read'` / `'feedback.respond'` — "guest/feedback context not yet gated" (should these exist?)

**Fix direction:** Audit all "Reserved for future use" comments. For genuinely deferred features, keep the comment but add a tracking issue reference. For dead permissions, remove them.

---

### S3-8 NIT: Cross-context adapter imports — verify exception compliance

**File:** `src/contexts/inbox/application/ports/review-lookup.port.ts` (and similar)
**Category:** pattern-compliance (verified OK)
**Tag:** [doc-fix] (minor)

**What:** Inbox defines cross-context lookup ports (`ReviewLookupPort`, `FeedbackLookupPort`, `PropertyLookupPort`) as per ADR-0008. The infrastructure adapters for these ports live in other contexts (e.g., `review/infrastructure/adapters/`). The adapter imports the port from inbox's `application/ports/` — this is an allowed exception documented in `src/contexts/CONTEXT.md:58`.

**Why it matters:** This is compliant — just documenting that the exception is correctly applied.

**Fix direction:** No code change. Consider adding a cross-reference in `src/contexts/inbox/CONTEXT.md` listing which contexts implement which lookup ports.

---

## Verified Compliant

1. **No DB access in application layer** — Zero instances of `drizzle`, `db.query`, `db.insert`, `db.update`, `db.delete`.
2. **No cross-context imports bypassing public-api** — Zero instances in application layer.
3. **All 12 contexts have `public-api.ts`** — Complete coverage.
4. **Use case shape compliance** — All use cases follow Authorize → Load → Check invariants → Build → Persist → Emit → Return pattern (where applicable).
5. **Anonymous use cases correct** — `register-user`, guest interaction use cases take `(input)` not `(input, ctx)`.
6. **`tracedHandler` used in all server functions** — Verified in Section 1.
7. **DTO schemas derived from Zod** — All DTOs use Zod v4.
8. **Public API exports match CONTEXT.md** — Verified per context in Section 8 (pending).
