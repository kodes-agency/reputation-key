/**
 * Better Auth schema-management configuration.
 *
 * Used exclusively by the repository-pinned schema runner (generate,
 * migrate). Reuses the same options as auth.ts but avoids Vite path aliases.
 */
import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { Pool } from 'pg'

import {
  SESSION_EXPIRY_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  INVITATION_EXPIRY_SECONDS,
} from './auth'
import { organizationSchema } from './org-schema'
import { ac } from './permissions'

const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER ?? process.env.DATABASE_URL,
})

if (!process.env.BETTER_AUTH_SECRET) {
  // Startup-time assertion for the schema config (not domain/application
  // logic). Plain Error is acceptable here — schema management runs before
  // any context is initialized.
  throw new Error('BETTER_AUTH_SECRET environment variable is required')
}

const auth = betterAuth({
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
      ac,
      // MUST mirror auth.ts so auth:generate/auth:migrate manage the same
      // additionalFields (propertyIds, Organization contact/response target)
      // as the runtime.
      schema: organizationSchema,
      dynamicAccessControl: { enabled: true },
      invitationExpiresIn: INVITATION_EXPIRY_SECONDS,
      async sendInvitationEmail() {
        // Schema-management config doesn't send real emails.
      },
    }),
  ],
})

export { auth }
