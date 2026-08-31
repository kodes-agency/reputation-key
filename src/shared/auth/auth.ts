// Better Auth server configuration

/** Session expiry: 30 days in seconds */
export const SESSION_EXPIRY_SECONDS = 60 * 60 * 24 * 30

/** Rolling session update age: 24 hours in seconds */
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24

/** Invitation expiry: 7 days in seconds */
export const INVITATION_EXPIRY_SECONDS = 60 * 60 * 24 * 7

import { betterAuth } from 'better-auth'
import { createAuthMiddleware } from 'better-auth/api'
import { organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { getEnv } from '#/shared/config/env'
import { getPool } from '#/shared/db/pool'
import { getRedis } from '#/shared/cache/redis'
import { getLogger } from '#/shared/observability/logger'
import { absoluteUrl } from '#/shared/email/urls'
import {
  sendResetPasswordEmail,
  sendInvitationEmail,
  sendVerificationEmail,
} from './emails'
import { organizationSchema } from './org-schema'
import { ac, owner, admin, memberRole } from './permissions'
import {
  claimsE2ERateLimitBypass,
  isE2ERateLimitBypassAuthorized,
} from './beta-capabilities'
import { createBetterAuthRateLimitStorage } from './better-auth-rate-limit-storage'
import { generateBetterAuthDatabaseId } from './registration-user-id'

/**
 * Better Auth remains the authentication provider, not the application write
 * authority for Organization membership. The HTTP adapter blocks these raw
 * routes; these provider hooks are the second, in-process fence for accidental
 * direct `auth.api` calls. App-owned Identity commands bind every required
 * lifecycle collaborator explicitly through the application container.
 */
async function denyRawOrganizationLifecycleWrite(): Promise<never> {
  throw new Error(
    'Raw Better Auth organization lifecycle write denied; use an app-owned Identity command',
  )
}

export function createAuth() {
  const env = getEnv()
  const pool = getPool()
  const redis = getRedis()
  const authRateLimitStorage = redis
    ? createBetterAuthRateLimitStorage(redis, {
        keyHmacSecret: env.BETTER_AUTH_SECRET,
      })
    : undefined

  // Review §5.1: decided once per process (createAuth is a lazy singleton) so
  // the posture is recorded, not silently assumed. An E2E claim without an
  // authorized execution identity is refused, logged at error, and the
  // limiter stays ON.
  const rateLimitBypass = isE2ERateLimitBypassAuthorized(env)
  if (rateLimitBypass) {
    getLogger().warn(
      { nodeEnv: env.NODE_ENV },
      'auth.rate_limit_bypass_active: E2E=1 with a test/CI execution identity — better-auth rate limiting is DISABLED',
    )
  } else if (claimsE2ERateLimitBypass(env)) {
    getLogger().error(
      { nodeEnv: env.NODE_ENV },
      'auth.rate_limit_bypass_refused: E2E is set without a test/CI execution identity — better-auth rate limiting stays ENABLED',
    )
  }

  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    // BQC-7.6: origin checks fail closed to the configured app URL — requests
    // whose Origin/Host do not match are rejected (CSRF / cross-origin posting
    // protection for the auth surface). The single trusted origin is the
    // deployment's own BETTER_AUTH_URL.
    trustedOrigins: [env.BETTER_AUTH_URL],
    emailAndPassword: {
      enabled: true,
      // A reset token is an account-recovery credential. Once consumed, all
      // previously issued sessions are invalidated so a stolen session cannot
      // survive the recovery event.
      revokeSessionsOnPasswordReset: true,
      // Enable email verification in production
      // Prerequisites:
      //   1. Verify Resend domain ownership (currently using sandbox)
      //   2. Test sendVerificationEmail flow end-to-end
      //   3. Update login/register UX to show "check your email" state
      // Email verification follows the parsed environment policy. Production
      // defaults to enabled; explicitly disabling it is an operator decision.
      // Before relying on the production default:
      //   1. Run scripts/migrations/verify-existing-emails.sql
      //   2. Confirm Resend domain verification is complete
      requireEmailVerification: env.EMAIL_VERIFICATION_REQUIRED,
      sendResetPassword: async ({ user, url }) => {
        await sendResetPasswordEmail(user.email, url)
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        await sendVerificationEmail(user.email, url)
      },
    },
    advanced: {
      database: {
        // Registration recovery preallocates the exact auth user ID before
        // Better Auth commits. Outside that request-scoped override this
        // preserves Better Auth's normal alphanumeric ID generation.
        generateId: generateBetterAuthDatabaseId,
      },
      defaultCookieAttributes: {
        secure: new URL(env.BETTER_AUTH_URL).protocol === 'https:',
        sameSite: 'lax',
        httpOnly: true,
      },
    },
    rateLimit: {
      // BQC-6.8 / review §5.1: better-auth's own limiter (default /sign-in:
      // 3 per 10s per IP) 429'd the e2e suite once BQC-6.7's accessibility
      // spec added its sign-ins — every spec signs in per test and retries: 0
      // makes a single 429 fatal, and no spec exercises rate-limit behavior.
      // It therefore stands down ONLY for the Playwright-launched stack:
      // E2E=1 exactly, AND the same test/CI execution identity that
      // authorizes the capability override (beta-capabilities.ts). This used
      // to be `!process.env.E2E` — bare truthiness on a variable absent from
      // the env schema — so one stray env var disabled both auth
      // brute-force layers in a real deployment with no signal at all. An
      // unauthorized claim now keeps the limiter ON and is logged.
      enabled: !rateLimitBypass,
      // Process memory multiplies the allowance by the number of web
      // replicas. Share only limiter state through cache Redis; do not set
      // Better Auth's global secondaryStorage because sessions and
      // verification records remain authoritative in Postgres.
      ...(authRateLimitStorage ? { customStorage: authRateLimitStorage } : {}),
    },
    session: {
      expiresIn: SESSION_EXPIRY_SECONDS, // 30 days
      updateAge: SESSION_UPDATE_AGE_SECONDS, // Rolling update every 24 hours
      cookieCache: {
        // Session revocation is an authority boundary. A self-contained cookie
        // cache can outlive sign-out-all, password recovery, or compromise
        // response, so beta requests revalidate the session from the database.
        enabled: false,
      },
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/change-password') return
        // Password change is itself a security event. The client may not opt
        // out of multi-device revocation: delete every prior session, then let
        // Better Auth rotate the authenticated caller onto one fresh session.
        // Password recovery follows the equivalent server-owned option above.
        ctx.body.revokeOtherSessions = true
      }),
    },
    plugins: [
      tanstackStartCookies(),
      organization({
        ac,
        roles: {
          owner,
          admin,
          member: memberRole,
        },
        // Dynamic per-org roles enabled. The `organizationRole` table is
        // provisioned by the better-auth migration (auth:generate / auth:migrate,
        // Drizzle adapter). Custom-role admin UI is still TBD (ADR 0001 Phase 4);
        // until then this makes the infrastructure functional, with the 3 static
        // roles (owner/admin/member) as the built-in fallback.
        dynamicAccessControl: {
          enabled: true,
        },
        invitationExpiresIn: INVITATION_EXPIRY_SECONDS, // 7 days
        // Use the same validated/defaulted policy as password signup. Reading
        // process.env here previously made an unset production variable mean
        // true above but false for invitation acceptance.
        requireEmailVerificationOnInvitation: env.EMAIL_VERIFICATION_REQUIRED,
        // Custom fields on invitation (propertyIds) and supported Organization
        // settings (contact/response target).
        // Shared with auth-cli.ts via ./org-schema so the migration CLI manages
        // the same columns as the runtime (prevents drift).
        schema: organizationSchema,
        // Send invitation emails via Resend
        async sendInvitationEmail(data) {
          const inviteLink = absoluteUrl(env.BETTER_AUTH_URL, '/accept-invitation', {
            id: data.id,
          })
          await sendInvitationEmail({
            email: data.email,
            invitedByUsername: data.inviter.user.name,
            organizationName: data.organization.name,
            inviteLink,
          })
        },
        // Membership and invitation lifecycle writes are app-owned. Keep the
        // provider hooks fail-closed as defense in depth behind the raw-route
        // HTTP refusal; no mutable composition callback lives in this module.
        organizationHooks: {
          beforeAcceptInvitation: denyRawOrganizationLifecycleWrite,
          beforeRemoveMember: denyRawOrganizationLifecycleWrite,
          beforeUpdateMemberRole: denyRawOrganizationLifecycleWrite,
          beforeDeleteOrganization: denyRawOrganizationLifecycleWrite,
        },
      }),
    ],
  })
}

// Lazy singleton — created once, reused across requests
let _auth: ReturnType<typeof createAuth> | undefined

export function getAuth() {
  if (!_auth) {
    _auth = createAuth()
  }
  return _auth
}

/** Type helper — extracts the session user type from better-auth */
export type AuthUser = {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
}
