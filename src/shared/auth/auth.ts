// Better Auth server configuration
import { betterAuth } from 'better-auth'
import { tanstackStartCookies } from 'better-auth/tanstack-start'
import { Pool } from 'pg'
import { getEnv } from '#/shared/config/env'
import { sendResetPasswordEmail } from './emails'
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
      expiresIn: 60 * 60 * 24 * 30, // 30 days
      updateAge: 60 * 60 * 24, // Update session every 24 hours (rolling)
    },
    plugins: [tanstackStartCookies()],
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
