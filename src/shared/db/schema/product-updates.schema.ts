import { boolean, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'
import { organization, user } from './auth'

const personColumns = () => ({
  userId: text('user_id')
    .notNull()
    .references(() => user.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
})
const instant = (name: string) => timestamp(name, { withTimezone: true })

export const productUpdateSettings = pgTable(
  'product_update_settings',
  {
    ...personColumns(),
    autoShow: boolean('auto_show').notNull().default(true),
    lastAutoOpenedAt: instant('last_auto_opened_at'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.organizationId] })],
)

export const productUpdateReceipts = pgTable(
  'product_update_receipts',
  {
    ...personColumns(),
    entryId: text('entry_id').notNull(),
    seenAt: instant('seen_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.organizationId, t.entryId] })],
)
