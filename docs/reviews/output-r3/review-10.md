# Review 10: Auth Flow & Better-auth Integration

**Branch:** feat/phase-15c-goal-ui
**Date:** 2026-05-23

## Scope

All auth-related files:

- `src/shared/auth/` (14 files)
- `src/routes/_authenticated.tsx`
- `src/routes/api/auth/google/callback.ts`
- `src/routes/api/auth/$.ts`
- `src/routes/login.tsx`, `register.tsx`, `reset-password.tsx`, `join.tsx`, `accept-invitation.tsx`

---

## Findings

### [MAJOR] PII (email) logged in sign-in failure

File: `src/contexts/identity/server/organizations.ts:513`
Quote: ```ts
getLogger().warn({ email: data.email, err: e }, 'Sign-in failed')

````
Rule: No password/secret is logged or returned in API responses. Email is PII and should not appear in logs.
Fix: Remove `email` from the log payload or hash/redact it.

### [MAJOR] OAuth callback imports `composition.ts` directly from route

File: `src/routes/api/auth/google/callback.ts:11`
Quote: ```ts
import { getContainer } from '#/composition'
````

Rule: While technically permissible (routes can import from shared/composition), the OAuth callback is 163 lines with significant logic (HMAC verification, state parsing, error classification). This should be a server function or use case.
Fix: Extract the OAuth callback logic into a server function in `integration/server/` and call it from the route.

### [MINOR] Google OAuth callback has 163 lines of logic in a route file

File: `src/routes/api/auth/google/callback.ts`
Quote: The entire file is route handler logic: HMAC verification, state parsing, error classification, session resolution, use case delegation.
Rule: Route files should be thin. Business logic belongs in use cases or server functions.
Fix: Move `parseAndValidateState()` and `classifyError()` into the integration context's application layer.

### [MINOR] `getSessionFromHeaders` returns `session.user` cast with `as AuthUser`

File: `src/shared/auth/middleware.ts:83`
Quote: ```ts
return session.user as AuthUser

````
Rule: No `as` casts on auth-related types.
Fix: Use a runtime validation function or accept the cast with a comment justifying it (better-auth guarantees the shape).

### [MINOR] Auth cookies not explicitly configured as httpOnly/secure/sameSite

File: `src/shared/auth/auth.ts`
Quote: Better-auth's default cookie settings are used. The `tanstackStartCookies()` plugin handles cookie management. No explicit `cookieOptions` with `httpOnly`, `secure`, `sameSite` are set.
Rule: Auth cookies must be httpOnly, secure, sameSite.
Fix: Verify better-auth's default cookie settings in production. Add explicit `cookieOptions` if defaults don't match:
```ts
session: {
  cookieOptions: {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
  },
}
````

### [MINOR] `guest_session` cookie set client-side without httpOnly

File: `src/routes/p/$propertySlug/$portalSlug.tsx:74`
Quote: ```ts
  document.cookie = `guest_session=${sessionId}; path=/p/; max-age=86400; SameSite=Lax`

```
Rule: Guest session cookie should have `Secure` flag in production and `HttpOnly` is not possible for client-set cookies (by design). However, `Secure` flag is missing.
Fix: Add `Secure` flag conditionally in production: `document.cookie = \`guest_session=${sessionId}; path=/p/; max-age=86400; SameSite=Lax${isProduction ? '; Secure' : ''}\``

---

## Positive Observations

- **Session validation is thorough.** Every authenticated server function calls `resolveTenantContext(headers)` which validates the session, checks active organization, and returns `AuthContext` with `userId`, `organizationId`, and `role`.
- **CSRF protection on OAuth callback.** The Google OAuth callback uses HMAC-signed state parameter with timestamp freshness (10-minute window) and `timingSafeEqual` comparison.
- **No passwords/secrets in responses.** Sign-in failures return generic "Invalid email or password" without distinguishing which is wrong. Password is never logged.
- **Tenant isolation via `resolveTenantContext()`.** Auth context always includes `organizationId` from the session's active org — never from client payload.
- **Route-level auth guard.** `_authenticated.tsx` `beforeLoad` redirects to `/login` if no session exists.
- **Tenant cache deduplication.** The `resolveTenantContext()` cache with 5-second TTL prevents duplicate DB calls during page loads.

---

## Summary

| Severity | Count |
|----------|-------|
| BLOCKER  | 0     |
| MAJOR    | 2     |
| MINOR    | 4     |
| NIT      | 0     |

**Most important thing to fix first:** The email PII leak in the sign-in log. Replace with a redacted identifier or omit entirely.
```
