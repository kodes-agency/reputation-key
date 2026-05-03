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
import { sendResetPasswordEmail, sendInvitationEmail } from './emails'
import { ac, owner, admin, memberRole } from './permissions'
// import { sendVerificationEmail } from './emails' // TODO: re-enable with email verification

// ── Post-acceptance staff assignment hook ──────────────────────────
// The afterAcceptInvitation hook creates staff_assignments for the
// properties specified during invitation. Because auth.ts can't import
// from the composition root (circular dependency), the assignment creator
// function is injected via setOnAcceptInvitation() from composition.ts.

type AcceptInvitationContext = Readonly<{
  userId: string
  organizationId: string
  propertyIds: ReadonlyArray<string>
}>

type AcceptInvitationHandler = (ctx: AcceptInvitationContext) => Promise<void>

let _onAcceptInvitation: AcceptInvitationHandler | undefined

/** Set the handler called after an invitation is accepted.
 * Called from composition.ts at startup. Injects the staff assignment
 * creator so auth.ts doesn't need to import from the composition root. */
export function setOnAcceptInvitation(handler: AcceptInvitationHandler): void {
  _onAcceptInvitation = handler
}

export function createAuth() {
  const env = getEnv()
  const pool = getPool()

  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
      // TODO: Enable email verification in production
      // Prerequisites:
      //   1. Verify Resend domain ownership (currently using sandbox)
      //   2. Test sendVerificationEmail flow end-to-end
      //   3. Update login/register UX to show "check your email" state
      //   4. Add email verification reminder UI for unverified users
      // Once ready, flip to: requireEmailVerification: true
      requireEmailVerification: false,
      sendResetPassword: async ({ user, url }) => {
        await sendResetPasswordEmail(user.email, url)
      },
    },
    // TODO: Re-enable email verification once email sending is set up
    // emailVerification: {
    //   sendOnSignUp: true,
    //   sendVerificationEmail: async ({ user, url }) => {
    //     await sendVerificationEmail(user.email, url)
    //   },
    // },
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
        dynamicAccessControl: {
          enabled: true,
        },
        invitationExpiresIn: INVITATION_EXPIRY_SECONDS, // 7 days
        // Custom fields on the invitation table — stores which properties
        // the invitee should be assigned to upon acceptance.
        // Custom fields on the organization table — billing and contact info.

        schema: {
          invitation: {
            additionalFields: {
              propertyIds: {
                type: 'string' as const,
                input: true,
                required: false,
              },
            },
          },
          organization: {
            additionalFields: {
              contactEmail: {
                type: 'string' as const,
                input: true,
                required: false,
              },
              billingCompanyName: {
                type: 'string' as const,
                input: true,
                required: false,
              },
              billingAddress: {
                type: 'string' as const,
                input: true,
                required: false,
              },
              billingCity: {
                type: 'string' as const,
                input: true,
                required: false,
              },
              billingPostalCode: {
                type: 'string' as const,
                input: true,
                required: false,
              },
              billingCountry: {
                type: 'string' as const,
                input: true,
                required: false,
              },
            },
          },
        },
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
          afterAcceptInvitation: async ({ invitation, member, organization }) => {
            if (!_onAcceptInvitation) return

            // propertyIds is stored as a JSON string in the invitation
            const raw = (invitation as Record<string, unknown>).propertyIds
            if (!raw || typeof raw !== 'string') return

            let propertyIds: string[]
            try {
              propertyIds = JSON.parse(raw)
            } catch {
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
