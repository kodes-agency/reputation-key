// Shared wiring for Inbox use-case tests that run against a real PostgreSQL
// database: deterministic UUIDs from readable labels, an Inbox item builder,
// the production repository and stores, and a reader for recorded outbox facts.

import { createHash } from 'node:crypto'
import type { Pool } from 'pg'
import { getDb } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  feedbackId,
  inboxItemId,
  reviewId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { InboxItem, InboxStatus, SourceType } from '../domain/types'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createInboxRepository } from './repositories/inbox.repository'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'
import { seedInboxItem, seedInboxOrganization } from './inbox-database-fixtures'

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

/** Stable UUID for a readable label, so assertions can still name `ii-1`. */
export const fixtureUuid = (scope: string, label: string): string => {
  const hex = createHash('sha1').update(`${scope}:${label}`).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `8${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

export type InboxFixtureItemInput = Readonly<{
  organizationId: OrganizationId
  scope: string
  label: string
  status: InboxStatus
  propertyId: PropertyId
  sourceType: SourceType
  at: Date
  overrides?: Partial<InboxItem>
}>

export const buildFixtureItem = (input: InboxFixtureItemInput): InboxItem => ({
  id: inboxItemId(fixtureUuid(input.scope, input.label)),
  organizationId: input.organizationId,
  propertyId: input.propertyId,
  sourceType: input.sourceType,
  sourceId:
    input.sourceType === 'review'
      ? reviewId(fixtureUuid(input.scope, `review:${input.label}`))
      : feedbackId(fixtureUuid(input.scope, `feedback:${input.label}`)),
  status: input.status,
  rating: 4,
  sourceDate: new Date('2026-04-10T00:00:00.000Z'),
  platform: input.sourceType === 'review' ? 'google' : 'direct',
  snippet: 'Great!',
  assignedTo: null,
  reviewerName: null,
  propertyName: null,
  isEscalated: false,
  escalatedAt: null,
  escalatedBy: null,
  escalationResolvedAt: null,
  escalationResolvedBy: null,
  closedAt: input.status === 'closed' ? input.at : null,
  firstReplySubmittedAt: null,
  firstReplyPublishedAt: null,
  commandRevision: 1,
  createdAt: input.at,
  updatedAt: input.at,
  ...input.overrides,
})

const emptyLookups = {
  reviewLookup: {
    getReviewSnippetById: async () => ({ status: 'not_found' as const }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [],
  },
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  },
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  },
}

/** Production Inbox repository and stores over the test database. */
export const createInboxDatabaseStores = (clock: () => Date, logger: LoggerPort) => {
  const db = getDb()
  return {
    db,
    repo: createInboxRepository(db, emptyLookups, {
      clock,
      logger,
    }),
    commandStore: createAtomicInboxCommandStore(db, allowAllCommandAuthority, clock),
    cycleStore: createReviewHandlingCycleStore(db),
  }
}

/** Seed the organization, its properties and any items, in order. */
export const seedInboxScope = async (
  pool: Pool,
  organizationId: OrganizationId,
  propertyIds: ReadonlyArray<PropertyId>,
  items: ReadonlyArray<InboxItem>,
  at: Date,
): Promise<void> => {
  const db = getDb()
  await seedInboxOrganization(pool, organizationId, propertyIds)
  for (const item of items) await seedInboxItem(pool, db, item, () => at)
}

/** Remove everything a scope seeded, children first. */
export const clearInboxScope = async (
  pool: Pool,
  organizationId: OrganizationId,
): Promise<void> => {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    organizationId,
  ])
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [organizationId])
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [organizationId])
}

/** Recorded outbox facts of one event type for the organization, oldest first. */
export const readOutboxFacts = async (
  pool: Pool,
  organizationId: OrganizationId,
  eventType: string,
): Promise<ReadonlyArray<Record<string, unknown>>> => {
  const { rows } = await pool.query<{ payload: Record<string, unknown> }>(
    `SELECT payload FROM outbox_events
      WHERE organization_id = $1 AND event_type = $2
      ORDER BY created_at, id`,
    [organizationId, eventType],
  )
  return rows.map((row) => row.payload)
}
