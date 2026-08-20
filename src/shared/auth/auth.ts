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
import {
  sendResetPasswordEmail,
  sendInvitationEmail,
  sendVerificationEmail,
} from './emails'
import { organizationSchema } from './org-schema'
import { ac, owner, admin, memberRole } from './permissions'

// ── Post-acceptance staff assignment hook ──────────────────────────
// The afterAcceptInvitation hook creates staff_assignments for the
// properties specified during invitation. Because auth.ts can't import
// from the composition root (circular dependency), the assignment creator
// function is injected via setOnAcceptInvitation() from composition.ts.

type AcceptInvitationContext = Readonly<{
  userId: string
  organizationId: string
  propertyIds: ReadonlyArray<string>
  displayName?: string
}>

type AcceptInvitationHandler = (ctx: AcceptInvitationContext) => Promise<void>

let _onAcceptInvitation: AcceptInvitationHandler | undefined

/** Set the handler called after an invitation is accepted.
 * Called from composition.ts at startup. Injects the staff assignment
 * creator so auth.ts doesn't need to import from the composition root. */
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
      // Enable email verification in production
      // Prerequisites:
      //   1. Verify Resend domain ownership (currently using sandbox)
      //   2. Test sendVerificationEmail flow end-to-end
      //   3. Update login/register UX to show "check your email" state
      // Email verification: gated behind env var. Enable in production after:
      //   1. Run scripts/migrations/verify-existing-emails.sql
      //   2. Confirm Resend domain verification is complete
      //   3. Set EMAIL_VERIFICATION_REQUIRED=true in env
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
      // BQC-6.8: disabled on Playwright-launched dev servers only (E2E=1 —
      // the same discriminator vite.config.ts uses for the console pipe).
      // better-auth's default /sign-in rule (3 per 10s per IP) 429'd the e2e
      // suite once BQC-6.8's accessibility spec added its sign-ins: every
      // spec signs in per test, and retries: 0 makes a single 429 fatal. No
      // spec exercises rate-limit behavior. Production and local-dev
      // limiting are unchanged.
      enabled: !process.env.E2E,
    },
    session: {
      expiresIn: SESSION_EXPIRY_SECONDS, // 30 days
      updateAge: SESSION_UPDATE_AGE_SECONDS, // Rolling update every 24 hours
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes — session revalidated from DB at most every 5 min
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
        requireEmailVerificationOnInvitation:
          process.env.EMAIL_VERIFICATION_REQUIRED === 'true',
        // Custom fields on invitation (propertyIds) and organization (billing/SLA).
        // Shared with auth-cli.ts via ./org-schema so the migration CLI manages
        // the same columns as the runtime (prevents drift).
        schema: organizationSchema,
        // Send invitation emails via Resend
        async sendInvitationEmail(data) {
          const inviteLink = `${env.BETTER_AUTH_URL}/accept-invitation?id=${data.id}`
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
