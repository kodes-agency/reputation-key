# Phase 11 Inbox Fixes — Iteration 1

## Issues to Fix

### Critical (must fix)

1. **[C1] Server functions trust client `organizationId`** → Add `resolveTenantContext` to all server functions following the portal/identity pattern. Import `headersFromContext` and `resolveTenantContext`. Replace `organizationId(data.organizationId)` with `ctx.organizationId` from resolved tenant context.

2. **[C3] Server functions trust client `userId`** → Get userId from resolved tenant context (`ctx.userId`) instead of `data.userId`. Remove `userId` from all DTO schemas where it was accepted from client payload.

3. **[C2] `getInboxItemDetail` bypasses use case layer** → Create a `getInboxItemDetail` use case that wraps the repository call, then call it from the server function.

### Medium (should fix)

4. **[M1+M3+M4] Unsafe `as string` casts on branded IDs** → Create a shared `unbrand()` utility or use explicit `String(id)` / template literal. Replace all `as string` casts.

5. **[M2] `ids as unknown as string[]` in bulkUpdateStatus** → Use `.map(id => id as unknown as string)` or the unbrand utility.

6. **[M5] Unread counter decremented in loop** → Add `decrementBy(orgId, userId, count)` to UnreadCounterPort or batch the calls.

7. **[M6] Redis count === 0 triggers unnecessary DB query** → Trust Redis 0 value, only fall through on Redis error.

8. **[M7] `new Date()` instead of injected clock in repository** → Repository shouldn't use its own time source. Accept clock or use DB `now()`. (Deferred — this is an existing pattern tradeoff; DB-level `updatedAt` from `updatedAtColumn()` may handle it.)

### Minor (if time permits)

9. **[m4] Cursor JSON.parse without try/catch** → Wrap in try/catch, return empty result on malformed cursor.

## Execution Order

1. Fix C1 + C3: Refactor all 7 server functions to use `resolveTenantContext`
2. Fix C2: Create `getInboxItemDetail` use case
3. Fix M1+M3+M4+M2: Replace unsafe `as string` casts
4. Fix M6: Trust Redis 0 value in getUnreadCount
5. Fix m4: Add cursor parse error handling
6. Run full test suite
7. Commit

## Verification

- `pnpm test --run` passes
- No TypeScript errors
- Server functions match the portal/identity pattern exactly
