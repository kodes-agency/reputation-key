import { sql } from 'drizzle-orm'
import {
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from 'drizzle-orm/pg-core'
import { organization, user } from './auth'

export const merchantAiNoticeUpdateReceipts = pgTable(
  'merchant_ai_notice_update_receipts',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    noticeVersion: varchar('notice_version', { length: 100 }).notNull(),
    noticeDigest: varchar('notice_digest', { length: 64 }).notNull(),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({
      columns: [t.userId, t.organizationId, t.noticeVersion, t.noticeDigest],
    }),
    index('merchant_ai_notice_update_receipts_org_idx').on(t.organizationId),
    check(
      'merchant_ai_notice_update_receipts_digest_valid',
      sql`${t.noticeDigest} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
)
