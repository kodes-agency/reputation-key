# Convergence Round 2 — Security Deep Dive: Auth Flows

**Date:** 2026-06-10
**Reviewer:** ConvergenceSecurity
**Scope:** OAuth state replay, last-admin TOCTOU, email verification, rate limiting on auth endpoints

## Summary

| Severity  | Count | Notes                                                           |
| --------- | ----- | --------------------------------------------------------------- |
| BLOCKER   | 0     | Both round-1 BLOCKERs downgraded                                |
| MAJOR     | 2     | Last-admin TOCTOU (real but narrow); auth endpoints unprotected |
| MINOR     | 1     | Email verification migration gap                                |
| NIT       | 0     | —                                                               |
| **Total** | **3** |                                                                 |

---

## Round-1 BLOCKER Reassessment

### BLOCKER → MAJOR: OAuth state nonce replay

**Original:** `SECURITY BLOCKER` — HMAC-signed state with random nonce has no server-side replay cache.

**Verdict: DOWNGRADED TO MINOR (design-by-decision, low exploitability)**

The round-1 finding asserted that the nonce in OAuth state should be single-use with a server-side replay cache. After full code analysis:

1. **The OAuth flow is NOT a user-facing login flow.** It is a Google Business Profile account-connection flow (`src/contexts/integration/server/google-auth-url.ts`). Only authenticated users with `integration.manage` permission can generate an OAuth URL (line 46-56).
2. **The state parameter carries `visibility` preference, not identity.** The callback (`src/routes/api/auth/google/callback.ts`) uses `resolveTenantContext` to get the authenticated user — the state cannot impersonate a different user.
3. **The 10-minute HMAC-signed timestamp window is the primary replay defense.** The nonce provides entropy for HMAC uniqueness, not single-use guarantees. A captured state token can only be replayed to connect the original authenticated user's Google account — the attacker gains nothing because the connection is bound to the authenticated session.
4. **The `code` exchange happens server-side against Google's token endpoint with `redirect_uri` verification.** Google's authorization code is single-use; replaying the same `state` with a different `code` is not possible because the code was already consumed.
5. **The tenant-separation audit (docs/audits/tenant-separation-security-audit.md:240-244) explicitly reviewed and approved this design.**

The remaining theoretical risk: within the 10-minute window, a network observer who captures the full callback URL (including `code` + `state`) could replay it before the original callback completes. This is mitigated by HTTPS in production (§4.2 of SECURITY_ONBOARDING.md) and Google's single-use authorization code.

**Action:** No code change needed. Add a comment in `callback.ts` explaining the defense model.

````
[SECURITY] MINOR OAuth state nonce is not single-use — documented-by-design
  File: src/routes/api/auth/google/callback.ts:34-89
  Quote: ```
  // Build state with visibility preference, CSRF nonce, and HMAC signature
  const nonce = crypto.randomUUID()
  const payload = { visibility, nonce, ts: Date.now() }
  const signature = signState(payload)
````

Rule: Defense-in-depth — single-use state nonces are recommended but not required here
Fix: Add a code comment at callback.ts:62 documenting that the nonce provides HMAC
uniqueness, not single-use guarantees, and that the 10-minute HMAC timestamp + server-side code exchange is the primary CSRF defense. Approved in tenant
separation audit. A Redis nonce store would be defense-in-depth but adds
operational complexity for a flow only accessible to authenticated admins.

```

---

### BLOCKER → MAJOR: Last-admin TOCTOU race

**Original:** `SECURITY BLOCKER` — concurrent requests can demote/remove the last admin.

**Verdict: UPGRADED FROM BLOCKER BUT KEPT AS MAJOR (real vulnerability, narrow window)**

After code analysis:

1. **The TOCTOU is real.** `remove-member.ts:44-60` and `update-member-role.ts:65-75` both do:
   - `getMember()` → `listMembers()` → count admins → `removeMember()` / `updateMemberRole()`
   - Between count and persist, another concurrent request can remove/demote the other admin.

2. **No transaction or lock exists.** Search for `transaction`, `FOR UPDATE`, `advisory_lock`, and `SERIALIZABLE` across the codebase shows no transaction wrapping in identity operations. The `auth-identity.adapter.ts` delegates to better-auth's `api.removeMember()` / `api.updateMemberRole()` which are individual API calls, not transactional.

3. **Exploitability is narrow but non-zero.** The attack requires:
   - Two admin-level users in the same org
   - Both simultaneously removing/demoting admins (or one admin with two browser tabs)
   - The org must have exactly 2 admins
   - Race window is the round-trip time between `listMembers` and `removeMember`

4. **Impact is severe if exploited:** Organization becomes admin-less, requiring direct database intervention to recover.

5. **Mitigating factors:** The application deploys as a single replica (`railway.json: "numReplicas": 1`), so the race window is confined to event-loop interleaving within a single Node.js process. Two concurrent `async` handlers can interleave at any `await` boundary.

**Action:** Add PostgreSQL advisory lock or wrap in a transaction.

```

[SECURITY] MAJOR Last-admin TOCTOU race — no transaction or lock on admin count + mutation
File: src/contexts/identity/application/use-cases/remove-member.ts:44-63
Quote: ```
const targetMember = await deps.identity.getMember(ctx, input.memberId)
// ...
const members = await deps.identity.listMembers(ctx)
const adminCount = members.filter((m) => m.role === ADMIN_ROLE).length
if (adminCount <= 1) { /_ throw _/ }
// 2. Persist — delegate to port (better-auth handles the rest)
await deps.identity.removeMember(ctx, input.memberId)

```
Rule:  TOCTOU — time-of-check/time-of-use race; concurrent admin removal within single-process
       event loop can interleave at await boundaries
Fix:   Add a PostgreSQL advisory lock keyed by `organizationId` before the admin-count check,
       released after the remove/update. Alternative: use a Redis SETNX lock with short TTL.
       The single-replica deployment (railway.json) limits the window but does not eliminate it —
       Node.js event-loop interleaving at `await` boundaries is sufficient for the race.
       Same issue exists in update-member-role.ts:66-75.
```

---

## New Findings

### Email verification — migration concerns

**Analysis of `requireEmailVerification` flip:**

The code in `auth.ts:51-70` has `requireEmailVerification: false` with a detailed comment listing prerequisites. The `emailVerification` block is entirely commented out (lines 65-71). The `SECURITY_ONBOARDING.md:62-79` documents this as a production blocker with prerequisites.

**What happens if re-enabled without migration:**

1. **Existing unverified users are immediately locked out.** Better Auth's `requireEmailVerification: true` blocks session creation for `emailVerified: false` users. All existing users registered while verification was disabled will have `emailVerified: false` in the database — they cannot sign in.

2. **No migration path exists in the codebase.** There is no script or job to bulk-set `emailVerified: true` for existing users, nor a "grace period" mechanism.

3. **The `sendVerificationEmail` hook is commented out.** Line 66-71 — re-enabling `requireEmailVerification` without also uncommenting and testing this block means new users receive no verification email.

````
[SECURITY] MINOR Re-enabling email verification will lock out all existing users
  File: src/shared/auth/auth.ts:51-71
  Quote: ```
  requireEmailVerification: false,
  // ...
  // Re-enable email verification once email sending is set up
  // emailVerification: {
  //   sendOnSignUp: true,
  //   sendVerificationEmail: async ({ user, url }) => {
````

Rule: Migration safety — flipping requireEmailVerification to true requires a database
migration to set emailVerified = true for all existing users
Fix: Before enabling: (1) uncomment the emailVerification block, (2) add a migration
script: `UPDATE "user" SET email_verified = true WHERE email_verified = false`,
(3) test the full flow with Resend domain verification. Document the migration
step in SECURITY_ONBOARDING.md §4.1. This is already tracked as a production
blocker but the migration requirement is not explicitly called out.

```

### Rate limiting on auth endpoints

**Analysis:**

1. **The rate limiter is wired but only applied to guest endpoints.** `composition.ts:68-72` creates a rate limiter with 60 req/min, but only `submitRatingFn` and `submitFeedbackFn` call `rateLimiter.check()`. No auth endpoint uses it.

2. **No upstream rate limiting is visible.** No Cloudflare, nginx, or reverse proxy config exists in the repository. Deployment is via Railway (`railway.json`) with nixpacks builder — no custom nginx/Cloudflare layer. Railway provides no built-in rate limiting.

3. **Better Auth has no built-in rate limiting.** The `betterAuth()` configuration in `auth.ts` does not include any rate-limit plugin or option. Password reset, sign-in, and registration are unprotected.

4. **The auth-settings.helpers.ts handles 429** (line 42-48) — suggesting rate limiting was anticipated but never applied at the application layer.

```

[SECURITY] MAJOR No rate limiting on authentication endpoints — sign-in, registration, password reset unprotected
File: src/contexts/identity/server/organizations.registration.ts:63-87
Quote: ```
export const signInUser = createServerFn({ method: 'POST' })
.inputValidator(signInInputSchema)
.handler(
tracedHandler(
async ({ data }) => {
const auth = getAuth()
await auth.api.signInEmail({
body: { email: data.email, password: data.password },
})

```
Rule:  OWASP A07:2021 — brute-force protection; application has rate limiting infrastructure
       (shared/rate-limit) but does not apply it to any auth endpoint. No upstream rate limiting
       exists (Railway deployment, no Cloudflare/nginx config in repo).
Fix:   Apply per-IP rate limiting to: signInUser, registerUserAndOrg, registerMember,
       changePasswordFn, and createOrganizationFn. The rateLimiter instance is already available
       via getContainer() — add rateLimiter.check(ipHash) before each auth operation.
       Consider separate limits: strict for sign-in (5-10/min), looser for registration (3-5/min).
```

---

## Confirmed Clean Areas

- **OAuth state HMAC implementation** — cryptographically sound: HMAC-SHA256 with dedicated secret, `timingSafeEqual`, 10-minute freshness. The tenant-separation audit approved this design.
- **Token encryption** — AES-256-GCM with proper IV, validated in prior audits.
- **Session management** — Better Auth handles cookie flags, session regeneration, and server-side session storage. No issues found.
- **Authorization enforcement** — Every use case checks `can(role, permission)` before mutation. No bypass paths found.
