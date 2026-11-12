// Real PostgreSQL wiring for the Inbox tests that run on a database: seeded
// organizations, properties, Review sources and Inbox items (through the same
// atomic item + initial Handling Cycle path production uses), the production
// repository and command stores over stubbed cross-context lookups, readers
// for the facts a command committed, and tenant cleanup.

import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  feedbackId,
  inboxItemId,
  reviewId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type { AiReviewInsightsPort } from '../application/ports/ai-review-insights.port'
import type { InboxCommandStore } from '../application/ports/inbox-command-store.port'
import type { InboxNoteRepository } from '../application/ports/inbox-note.repository'
import type { InboxRepository } from '../application/ports/inbox.repository'
import type { InboxItem, InboxStatus, SourceType } from '../domain/types'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from './inbox-command-store'
import { createInboxRepository } from './repositories/inbox.repository'
import { createInboxNoteRepository } from './repositories/inbox-note.repository'
import { createReviewHandlingCycleStore } from './review-handling-cycle.store'

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({ allowed: true })

const silentLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => silentLogger,
}

export async function seedInboxOrganization(
  pool: Pool,
  organizationId: string,
  propertyIds: ReadonlyArray<string>,
): Promise<void> {
  const slug = `t-${organizationId.replace(/-/g, '')}`
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [organizationId, `Test Org ${slug}`, slug],
  )
  for (const propertyId of propertyIds) {
    const propertySlug = `p-${propertyId.replace(/-/g, '')}`
    await pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [propertyId, organizationId, `Test Property ${propertySlug}`, propertySlug],
    )
  }
}

export async function seedInboxItem(
  pool: Pool,
  database: Database,
  item: InboxItem,
  now: () => Date,
): Promise<InboxItem> {
  const store = createAtomicInboxCommandStore(database, allowAllCommandAuthority, now)
  if (item.sourceType === 'feedback') {
    return (
      await store.createItem(item, null, {
        sourceRevision: 1,
        openedReason: 'feedback_submitted',
        actorType: 'guest',
        triggerEventId: null,
        openedAt: item.createdAt,
      })
    ).item
  }

  await seedReviewSource(pool, {
    id: item.sourceId,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    sourceDate: item.sourceDate,
  })
  return (await store.createItem(item, null, { materialReviewRevision: 1 })).item
}

// ── review sources ──────────────────────────────────────────────────

/** Seeds the Review source rows an Inbox item anchors to, without an Inbox item. */
export type ReviewSourceSeed = Readonly<{
  id: string
  organizationId: string
  propertyId: string
  sourceDate: Date
}>

export async function seedReviewSource(
  pool: Pool,
  source: ReviewSourceSeed,
): Promise<void> {
  await pool.query(
    `WITH identity AS (
       INSERT INTO reviews (
         id, organization_id, property_id, platform, external_id,
         external_location_id, expires_at, first_fetched_at,
         source_epoch, source_revision, source_observation_sequence,
         analysis_sequence, source_content_state, created_at, updated_at
       ) VALUES (
         $1, $2, $3, 'google', $4, 'locations/inbox-fixture',
         $5::timestamptz + INTERVAL '1 year', $5::timestamptz,
         0, 1, 0, 1, 'active', $5::timestamptz, $5::timestamptz
       ) ON CONFLICT (id) DO NOTHING
       RETURNING id
     ) INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, reviewed_at, content_expires_at,
       first_fetched_at, last_fetched_at, source_epoch, source_revision,
       ai_source_byte_length, ai_source_digest
     ) SELECT id, $2, $3, 'google', $4, 'locations/inbox-fixture',
       4, $5::timestamptz, $5::timestamptz + INTERVAL '1 year',
       $5::timestamptz, $5::timestamptz, 0, 1, 1, repeat('a', 64)
       FROM identity`,
    [
      source.id,
      source.organizationId,
      source.propertyId,
      `inbox-fixture-${source.id}`,
      source.sourceDate,
    ],
  )
  await pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES (
       $1, 1, $2, $3, 0, 'review-material-v1', repeat('b', 64),
       repeat('b', 64), 4, 'fixture', 'active', $4, $4
     ) ON CONFLICT (review_id, revision) DO NOTHING`,
    [source.id, source.organizationId, source.propertyId, source.sourceDate],
  )
}

// ── ids ─────────────────────────────────────────────────────────────

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

const RUN_PREFIX = randomUUID().slice(0, 8)

/** Keeps a readable id literal but swaps its first block for one random per test file run. */
export const runScopedId = (literal: string): string => RUN_PREFIX + literal.slice(8)

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

// ── stores ──────────────────────────────────────────────────────────

export const openFixturePool = (): Pool =>
  new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })

export const createUseCaseDatabase = (): Database => getDb()

/** The production repository over lookups that know nothing of other contexts. */
const createStubbedInboxRepository = (
  db: Database,
  clock: () => Date,
  logger: LoggerPort,
  aiInsights?: AiReviewInsightsPort,
): InboxRepository =>
  createInboxRepository(
    db,
    {
      reviewLookup: {
        getReviewSnippetById: async () => ({ status: 'not_found' }),
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
      ...(aiInsights ? { aiInsights } : {}),
    },
    { clock, logger },
  )

export const createUseCaseInboxRepository = (
  db: Database,
  clock: () => Date,
): InboxRepository => createStubbedInboxRepository(db, clock, silentLogger)

export const createUseCaseCommandStore = (
  db: Database,
  clock: () => Date,
): InboxCommandStore => createAtomicInboxCommandStore(db, allowAllCommandAuthority, clock)

/** Production Inbox repository and stores over the test database. */
export const createInboxDatabaseStores = (clock: () => Date, logger: LoggerPort) => {
  const db = getDb()
  return {
    db,
    repo: createStubbedInboxRepository(db, clock, logger),
    commandStore: createAtomicInboxCommandStore(db, allowAllCommandAuthority, clock),
    cycleStore: createReviewHandlingCycleStore(db),
  }
}

export type InboxUseCaseDatabase = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  noteRepo: InboxNoteRepository
  seed: (...items: InboxItem[]) => Promise<void>
}>

export function createInboxUseCaseDatabase(
  pool: Pool,
  now: () => Date,
  aiInsights?: AiReviewInsightsPort,
): InboxUseCaseDatabase {
  const db = getDb()
  return {
    repo: createStubbedInboxRepository(db, now, silentLogger, aiInsights),
    commandStore: createAtomicInboxCommandStore(db, allowAllCommandAuthority, now),
    noteRepo: createInboxNoteRepository(db),
    seed: async (...items) => {
      for (const item of items) await seedInboxItem(pool, db, item, now)
    },
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

/** The level a manager set, written as the command store writes it. */
export async function setStoredManagerPriority(
  pool: Pool,
  id: InboxItem['id'],
  level: 'urgent' | 'high' | 'medium' | 'low',
  setBy: string,
  setAt: Date,
): Promise<void> {
  await pool.query(
    `UPDATE inbox_items
        SET manager_priority = $2, manager_priority_set_by = $3,
            manager_priority_set_at = $4
      WHERE id = $1`,
    [id, level, setBy, setAt],
  )
}

// ── readers and cleanup ─────────────────────────────────────────────

export type StoredOutboxFact = Readonly<{
  eventType: string
  payload: Record<string, unknown>
}>

/** Recorded outbox facts for the organization, oldest first; one event type gives its payloads. */
export async function readOutboxFacts(
  pool: Pool,
  organizationId: string,
): Promise<ReadonlyArray<StoredOutboxFact>>
export async function readOutboxFacts(
  pool: Pool,
  organizationId: string,
  eventType: string,
): Promise<ReadonlyArray<Record<string, unknown>>>
export async function readOutboxFacts(
  pool: Pool,
  organizationId: string,
  eventType?: string,
): Promise<ReadonlyArray<StoredOutboxFact | Record<string, unknown>>> {
  const { rows } = await pool.query<{
    event_type: string
    payload: Record<string, unknown>
  }>(
    `SELECT event_type, payload FROM outbox_events
      WHERE organization_id = $1 AND ($2::text IS NULL OR event_type = $2)
      ORDER BY created_at, id`,
    [organizationId, eventType ?? null],
  )
  return eventType === undefined
    ? rows.map((row) => ({ eventType: row.event_type, payload: row.payload }))
    : rows.map((row) => row.payload)
}

/** Removes the items and outbox facts of one organization, keeping its Review sources. */
export async function clearInboxOrganization(
  pool: Pool,
  organizationId: string,
): Promise<void> {
  await pool.query('DELETE FROM outbox_events WHERE organization_id = $1', [
    organizationId,
  ])
  await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [organizationId])
}

/** Removes everything a test seeded for one organization, children first, including its Review sources. */
export async function dropInboxOrganization(
  pool: Pool,
  organizationId: string,
): Promise<void> {
  await clearInboxOrganization(pool, organizationId)
  await pool.query('DELETE FROM reviews WHERE organization_id = $1', [organizationId])
}

/** Removes everything a test seeded, including its properties and organization. */
export async function dropInboxUseCaseTenant(
  pool: Pool,
  organizationId: string,
  propertyIds: ReadonlyArray<string>,
): Promise<void> {
  await dropInboxOrganization(pool, organizationId)
  await pool.query('DELETE FROM properties WHERE organization_id = $1 AND id = ANY($2)', [
    organizationId,
    propertyIds,
  ])
  await pool.query('DELETE FROM organization WHERE id = $1', [organizationId])
}
