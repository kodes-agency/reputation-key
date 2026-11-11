// The append-only lifecycle event ledger. Backup erasure hold releases are its
// only writers; the ledger outlives any Organization row it names.

import { sql, desc } from 'drizzle-orm'
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core'

const timestamptz = (name: string) => timestamp(name, { withTimezone: true })
export const ORGANIZATION_LIFECYCLE_EVENT_CONTEXTS = [
  'activity',
  'ai',
  'dashboard',
  'goal',
  'guest',
  'identity',
  'inbox',
  'integration',
  'metric',
  'notification',
  'portal',
  'property',
  'review',
  'staff',
] as const

export type OrganizationLifecycleEventContext =
  (typeof ORGANIZATION_LIFECYCLE_EVENT_CONTEXTS)[number]

const lifecycleEventContextList = ORGANIZATION_LIFECYCLE_EVENT_CONTEXTS.map(
  (context) => `'${context}'`,
).join(', ')

/**
 * Every content-free lifecycle receipt shares one append-only event ledger.
 *
 * `kind` is a namespaced idempotency identity derived from the former
 * receipt's primary key. The unique index therefore preserves at-most-once
 * behavior across retries without coupling durable evidence to a row that may
 * later be erased.
 */
export const organizationLifecycleEvents = pgTable(
  'organization_lifecycle_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: text('organization_id').notNull(),
    context: text('context').$type<OrganizationLifecycleEventContext>().notNull(),
    phase: text('phase').notNull(),
    kind: text('kind').notNull(),
    payload: jsonb('payload')
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    recordedAt: timestamptz('recorded_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('organization_lifecycle_events_idempotency_unique').on(
      t.context,
      t.phase,
      t.kind,
    ),
    index('organization_lifecycle_events_org_time_idx').on(
      t.organizationId,
      desc(t.recordedAt),
    ),
    check(
      'organization_lifecycle_events_identity_valid',
      sql.raw(
        `"organization_lifecycle_events"."context" IN (${lifecycleEventContextList})
          AND length("organization_lifecycle_events"."phase") BETWEEN 1 AND 32
          AND length("organization_lifecycle_events"."kind") BETWEEN 1 AND 160`,
      ),
    ),
    check(
      'organization_lifecycle_events_payload_object',
      sql`jsonb_typeof(${t.payload}) = 'object'`,
    ),
  ],
)
