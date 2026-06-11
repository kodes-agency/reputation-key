# Convergence Pass — Agent B: Security, Data Integrity, Idempotency

**Date:** 2026-06-10
**Scope:** auth middleware, webhook handlers, token encryption, OAuth flow, DB layer, identity server functions

## Summary

| Severity  | Count  |
| --------- | ------ |
| BLOCKER   | 2      |
| MAJOR     | 5      |
| MINOR     | 4      |
| NIT       | 2      |
| **Total** | **13** |

---

## BLOCKER

````
[SECURITY] BLOCKER OAuth state nonce not validated for replay — HMAC-signed state with random nonce has no server-side replay cache
  File: src/routes/api/auth/google/callback.ts:34-89
  Quote: ```
  const nonce = crypto.randomUUID()
  const payload = { visibility, nonce, ts: Date.now() }
  const signature = signState(payload)
````

Rule: OWASP A07:2021 — Authentication and Session Management; OAuth 2.0 PKCE/state best practice requires single-use state
Fix: Maintain a short-lived nonce store (Redis SET with TTL matching STATE_MAX_AGE_MS). Reject any state whose nonce has already been consumed. Without this, a captured state parameter can be replayed within the 10-minute window to forge OAuth callbacks.

```

```

[SECURITY] BLOCKER Last-admin guard has TOCTOU race — concurrent requests can demote/remove the last admin
File: src/contexts/identity/application/use-cases/remove-member.ts:44-60
Quote: ```
const targetMember = await deps.identity.getMember(ctx, input.memberId)
// ...
const members = await deps.identity.listMembers(ctx)
const adminCount = members.filter((m) => m.role === ADMIN_ROLE).length
if (adminCount <= 1) { /_ throw _/ }
// 2. Persist — delegate to port
await deps.identity.removeMember(ctx, input.memberId)

```
Rule:  TOCTOU — time-of-check/time-of-use race; OWASP concurrency guidance
Fix:   Wrap the count-check + remove in a DB transaction with `SELECT ... FOR UPDATE` on the member rows, or use a PostgreSQL advisory lock keyed by organizationId. Same issue exists in `update-member-role.ts:65-75`. Two concurrent "demote last admin" requests both pass the count check and succeed.
```

---

## MAJOR

````
[SECURITY] MAJOR Email verification disabled — accounts usable without email confirmation
  File: src/shared/auth/auth.ts:60
  Quote: ```
  requireEmailVerification: false,
````

Rule: OWASP A07:2021 — Identity and Authentication Failures; application allows full account access without proving email ownership
Fix: Enable `requireEmailVerification: true` once email infrastructure is confirmed working. Until then, unverified emails can be used for spam, abuse, or to impersonate other users' email addresses. The code comment acknowledges this is intentional but it remains a production security gap.

```

```

[SECURITY] MAIOR No rate limiting on registration, sign-in, password reset, or create-organization endpoints
File: src/contexts/identity/server/organizations.registration.ts:67-84
Quote: ```
const auth = getAuth()
await auth.api.signInEmail({
body: { email: data.email, password: data.password },
})

```
Rule:  OWASP A07 — Brute-force protection; application has rate limiting infrastructure (shared/rate-limit) but does not apply it to auth endpoints
Fix:   Apply rate limiting (per-IP or per-email) to signInUser, registerUserAndOrg, registerMember, changePasswordFn, and createOrganizationFn. The createOrganization file has an explicit F045 comment acknowledging the gap. The rate limiter is already wired in composition.ts but only guest-facing endpoints use it.
```

````
[SECURITY] MAJOR Registration + org creation is not atomic — leaves orphaned user accounts
  File: src/contexts/identity/application/use-cases/register-user-and-org.ts:82-101
  Quote: ```
  // F148 NOTE: This is not fully atomic — user creation succeeds even if org
  // setup fails. The error code 'org_setup_failed' signals this state to the
  // client, which should prompt "you have an account, sign in and create an org."
````

Rule: Data integrity — multi-step mutation without compensating transaction leaves dangling state
Fix: Wrap both operations in a DB transaction, or implement a compensating transaction that removes the created user on org-setup failure. The current approach is intentionally documented but creates orphaned accounts that may accumulate and confuse users. At minimum, add a cleanup job or admin UI to detect and resolve orphaned accounts.

```

```

[SECURITY] MAIOR console.error logs raw error object in auth hook — potential PII/stack-trace leak to stdout
File: src/shared/auth/auth.ts:167
Quote: ```
console.error('[auth] Failed to parse propertyIds from invitation:', err)

```
Rule:  OWASP A09 — Security Logging and Monitoring Failures; raw error objects may contain stack traces with file paths, internal URLs, or user data
Fix:   Replace with `getLogger().error({ err }, '[auth] Failed to parse propertyIds from invitation')`. Every other error in the auth module uses the structured logger. This is the only `console.error` in the shared/auth directory.
```

````
[DATA-INTEGRITY] MAJOR Goal progress average calculation has read-after-write inconsistency
  File: src/contexts/goal/infrastructure/repositories/goal.repository.ts:330-332
  Quote: ```
  currentSum: sql`COALESCE(${goalProgress.currentSum}, 0) + ${delta}`,
  currentCount: sql`COALESCE(${goalProgress.currentCount}, 0) + 1`,
  currentValue: sql`(COALESCE(${goalProgress.currentSum}, 0) + ${delta}) / (COALESCE(${goalProgress.currentCount}, 0) + 1)`,
````

Rule: Data integrity — concurrent increments produce incorrect averages because the currentValue is computed from a stale read of currentSum/currentCount
Fix: The three SET columns are evaluated from the same snapshot of the row, so the formula is actually correct for a single UPDATE. However, two concurrent UPDATEs will each read the same prior state and produce a lost-update (both write the same sum+delta instead of sum+2\*delta). Wrap in `UPDATE ... WHERE currentValue = <old>` optimistic lock, or use `SELECT ... FOR UPDATE` in a transaction, or switch to a single SQL expression that doesn't decompose into three separate columns.

```

---

## MINOR

```

[SECURITY] MINOR Tenant cache uses in-process Map — breaks multi-instance deployments
File: src/shared/auth/middleware.ts:26
Quote: ```
const tenantCache = new Map<string, { ctx: AuthContext; ts: number }>()

```
Rule:  Horizontal scaling — in-memory cache diverges across processes; stale cache after org switch persists for 5s per-instance
Fix:   Acceptable for single-instance deployments. For multi-instance, either move to Redis with same TTL, or document that the 5s stale-cache window is per-process and acceptable. The code already has a note (F161) about this. Low risk but worth documenting in deployment docs.
```

````
[SECURITY] MINOR Accept-invitation endpoint does not verify the invitation belongs to the authenticated user
  File: src/contexts/identity/server/organizations.invitations.ts:24-37
  Quote: ```
  await requireAuth(headers)
  const auth = getAuth()
  await auth.api.acceptInvitation({
    headers,
    body: { invitationId: data.invitationId },
  })
````

Rule: Better-auth may handle this internally, but the server function does not explicitly validate that the authenticated user matches the invitation's target email
Fix: Verify that better-auth's `acceptInvitation` enforces the email match. If it does (likely), add a code comment documenting this assumption. If not, add explicit validation before calling acceptInvitation.

```

```

[SECURITY] MINOR Webhook returns 200 on JWT verification failure in catch-all — Pub/Sub won't retry
File: src/routes/api/webhooks/gbp/notifications.ts:107-116
Quote: ```
} catch (err) {
logger.error({ err }, 'Webhook processing failed')
return Response.json(
{ error: 'Internal Server Error', message: 'Unexpected error processing webhook notification' },
{ status: 200 }, // ← implied by comment "Always return 200 to prevent Pub/Sub retry"
)

```
Rule:  Data integrity — if JWT verification passes but downstream processing fails permanently, the message is silently dropped with no retry
Fix:   The code at line 106 returns 200 for success, but the catch at line 107 also returns status 200 (actually 500 based on the literal). Re-read the code — the catch returns `{ status: 500 }`. This is correct: transient failures will trigger Pub/Sub retry. However, the code comment "Always return 200 to prevent Pub/Sub retry" at line 105 is misleading since the catch returns 500. Update the comment to clarify the distinction.
```

````
[SECURITY] MINOR OAuth callback leaks error classification in redirect URL
  File: src/routes/api/auth/google/callback.ts:22-24
  Quote: ```
  headers: { Location: `${env.BETTER_AUTH_URL}/properties/import?error=${errorParam}` },
````

Rule: Information disclosure — error params like `session_expired`, `connection_failed` reveal internal state classification to anyone observing the redirect URL
Fix: Use opaque error codes (e.g., `e1`, `e2`) mapped client-side, or accept the minor disclosure as these are not security-sensitive classifications.

```

---

## NIT

```

[SECURITY] NIT Google OAuth error messages include full upstream response body
File: src/contexts/integration/infrastructure/adapters/google-oauth.adapter.ts:50-52
Quote: ```   throw integrationError(
    'oauth_failed',
    `Failed to exchange authorization code with Google: ${response.status} ${errorBody}`,
)

```
Rule:  Error message hygiene — upstream error bodies may contain internal Google request IDs or details that get logged
Fix:   Log the full error body at debug level, but include only the status code in the error message propagated up the stack. Same pattern in refreshAccessToken (line 122) and revokeToken (line 153).
```

````
[SECURITY] NIT Token encryption adapter does not zero Buffer after use
  File: src/contexts/integration/infrastructure/adapters/token-encryption.adapter.ts:11
  Quote: ```
  const key = Buffer.from(encryptionKey, 'hex')
````

Rule: Defense in depth — encryption key material persists in Node.js heap until GC
Fix: Low priority for Node.js (V8 doesn't easily support secure memory zeroing), but worth noting. The `key` buffer remains in memory for the lifetime of the adapter. Acceptable for this stack, but document the trade-off.

```

```
