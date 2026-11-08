import { pgTable, varchar, timestamp, text } from 'drizzle-orm/pg-core'

// Integration owns this account-level control state. Only a one-way account key,
// attempt times and the desired configuration are retained, never credentials or
// Google content. Keep it across disconnects so retries and reconnects preserve
// ordering; an unsubscribe invalidates verification before touching Google.
export const googleNotificationAccounts = pgTable('google_notification_accounts', {
  accountKey: varchar('account_key', { length: 64 }).primaryKey(),
  attemptedAt: timestamp('attempted_at', { withTimezone: true }),
  verifiedAt: timestamp('verified_at', { withTimezone: true }),
  configuration: text('configuration'),
})
