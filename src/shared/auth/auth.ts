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
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { sendResetPasswordEmail, sendInvitationEmail } from './emails'
import { ac, owner, admin, memberRole } from './permissions'
// import { sendVerificationEmail } from './emails' // TODO: re-enable with email verification

export function createAuth() {
  const env = getEnv()
  const pool = new Pool({
    connectionString: env.DATABASE_URL_POOLER ?? env.DATABASE_URL,
  })

  return betterAuth({
    database: pool,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    emailAndPassword: {
      enabled: true,
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
        invitationExpiresIn: INVITATION_EXPIRY_SECONDS, // 7 days
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
