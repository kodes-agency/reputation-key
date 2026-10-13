/**
 * Better Auth schema-management configuration.
 *
 * Used exclusively by the repository-pinned schema runner (generate,
 * migrate). Reuses the same options as auth.ts but avoids Vite path aliases.
 */
import { betterAuth } from 'better-auth'
import { organization } from 'better-auth/plugins'
import { Pool } from 'pg'

import { boundMigrationLockWait } from '../db/migration-lock-timeout'
import {
  SESSION_EXPIRY_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  INVITATION_EXPIRY_SECONDS,
} from './auth'
import { organizationSchema } from './org-schema'
import { ac } from './permissions'
import { generateBetterAuthDatabaseId } from './registration-user-id'

// This pool only manages schema. Better Auth runs its statements on
// connections it takes from here, not on the deploy runner's session, so the
// lock wait is bounded per connection: an upgrade that adds a column sends
// `ALTER TABLE` on a table every request reads, and one that waited without
// bound would hold the application's statements on that table in the queue
// behind it. pg-pool awaits the hook before it hands the connection out.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL_POOLER ?? process.env.DATABASE_URL,
  onConnect: (client) => boundMigrationLockWait(client),
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
  advanced: {
    // Match runtime ID semantics. The schema runner has no registration
    // context, so this produces Better Auth-compatible random text IDs.
    database: { generateId: generateBetterAuthDatabaseId },
  },
  session: {
    expiresIn: SESSION_EXPIRY_SECONDS,
    updateAge: SESSION_UPDATE_AGE_SECONDS,
  },
  plugins: [
    organization({
      ac,
      // MUST mirror auth.ts so auth:migrate manages the same
      // additionalFields (propertyIds, Organization contact/response target)
      // as the runtime.
      schema: organizationSchema,
      dynamicAccessControl: { enabled: true },
      invitationExpiresIn: INVITATION_EXPIRY_SECONDS,
    }),
  ],
})

export { auth }
