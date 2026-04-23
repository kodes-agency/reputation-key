/**
 * Better Auth CLI configuration.
 *
 * Used exclusively by `@better-auth/cli` (generate, migrate).
 * Reuses the same options as auth.ts but avoids Vite path aliases.
 */
import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { Pool } from 'pg'

import {
  SESSION_EXPIRY_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  INVITATION_EXPIRY_SECONDS,
} from './auth'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER ?? process.env.DATABASE_URL,
})

if (!process.env.BETTER_AUTH_SECRET) {
  // Startup-time assertion for the CLI config (not domain/application logic).
  // Plain Error is acceptable here — the auth CLI runs before any context is initialized.
  throw new Error('BETTER_AUTH_SECRET environment variable is required')
}

export const auth = betterAuth({
  database: pool,
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL,
  emailAndPassword: {
    enabled: true,
  },
  session: {
    expiresIn: SESSION_EXPIRY_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  plugins: [
    organization({
      invitationExpiresIn: INVITATION_EXPIRY_SECONDS,
      async sendInvitationEmail() {
        // CLI config doesn't send real emails
      },
    }),
  ],
})

export default auth
