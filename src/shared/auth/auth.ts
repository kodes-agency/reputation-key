// Better Auth server configuration

/** Session expiry: 30 days in seconds */
export const SESSION_EXPIRY_SECONDS = 60 * 60 * 24 * 30

/** Rolling session update age: 24 hours in seconds */
export const SESSION_UPDATE_AGE_SECONDS = 60 * 60 * 24

/** Invitation expiry: 7 days in seconds */
export const INVITATION_EXPIRY_SECONDS = 60 * 60 * 24 * 7

import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { getEnv } from '#/shared/config/env'
import { getPool } from '#/shared/db/pool'
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

// ── Post-acceptance property-access hook ───────────────────────────
// Property IDs selected explicitly during invitation become access grants.
// Because auth.ts cannot import the composition root, the grant provisioner
// is injected via setOnAcceptInvitation(). Staff participation is independent.

type AcceptInvitationContext = Readonly<{
  userId: string
  organizationId: string
  propertyIds: ReadonlyArray<string>
}>

type AcceptInvitationHandler = (ctx: AcceptInvitationContext) => Promise<void>

let _onAcceptInvitation: AcceptInvitationHandler | undefined

/** Set the handler called after an invitation is accepted.
 * Called from composition.ts at startup. Injects the access-grant
 * provisioner so auth.ts does not import from the composition root. */
export function setOnAcceptInvitation(handler: AcceptInvitationHandler): void {
  _onAcceptInvitation = handler
}

/** The currently-registered post-acceptance handler (or undefined). The app-owned
 * acceptInvitation txn calls this directly since it bypasses BA's afterAcceptInvitation hook. */
export function getOnAcceptInvitation(): AcceptInvitationHandler | undefined {
  return _onAcceptInvitation
}

type MembershipRemovalLifecycle = Readonly<{
  beforeRemoveMember: (organizationId: string, userId: string) => Promise<void>
  beforeDeleteOrganization: (organizationId: string) => Promise<void>
}>

let _membershipRemovalLifecycle: MembershipRemovalLifecycle | undefined

export function setMembershipRemovalLifecycle(
  lifecycle: MembershipRemovalLifecycle,
): void {
  _membershipRemovalLifecycle = lifecycle
}

function membershipRemovalLifecycle(): MembershipRemovalLifecycle {
  if (!_membershipRemovalLifecycle) {
    throw new Error('membership removal lifecycle is not initialized')
  }
  return _membershipRemovalLifecycle
}

export function createAuth() {
  const env = getEnv()
  const pool = getPool()

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
        // Custom fields on invitation (propertyIds) and organization (billing/SLA).
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
        // After an invitation is accepted, auto-create staff assignments
        // for the properties specified in the invitation.
        organizationHooks: {
          beforeRemoveMember: ({ member, organization }) =>
            membershipRemovalLifecycle().beforeRemoveMember(
              organization.id,
              member.userId,
            ),
          beforeDeleteOrganization: ({ organization }) =>
            membershipRemovalLifecycle().beforeDeleteOrganization(organization.id),
          afterAcceptInvitation: async ({ invitation, member, organization }) => {
            if (!_onAcceptInvitation) return

            // propertyIds is stored as a JSON string in the invitation
            const raw = (invitation as Record<string, unknown>).propertyIds
            if (!raw || typeof raw !== 'string') return

            let propertyIds: string[]
            try {
              propertyIds = JSON.parse(raw)
            } catch (err) {
              // F168 FIX: Log parse failure instead of silently returning
              getLogger().error(
                { err },
                '[auth] Failed to parse propertyIds from invitation',
              )
              return
            }
            if (!Array.isArray(propertyIds) || propertyIds.length === 0) return

            await _onAcceptInvitation({
              userId: member.userId,
              organizationId: organization.id,
              propertyIds,
            })
          },
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
