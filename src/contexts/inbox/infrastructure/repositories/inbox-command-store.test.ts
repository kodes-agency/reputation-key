// BQC-3.4 — inbox command store + rebuild integration tests (real Postgres).
//
// Crash-boundary proofs on the real database:
//   1. applySourceCreatedOnce commits item + created fact + receipt in ONE
//      transaction; a forced outbox failure (unregistered fact type) or a
//      forced receipt failure (missing source event row → FK violation)
//      rolls back EVERYTHING — no item row survives.
//   2. Duplicate delivery: exactly one item, one fact, receipt present.
//   3. legacy review.expired: source-content scrub + receipt are atomic and
//      replay-safe without changing current workflow status.
//   4. rebuildInboxProjection heals a corrupted projection from canonical
//      review/reply data; dryRun writes nothing.

import { GOOGLE_LOCATION_PRIMARY_RESOURCE } from '#/test-fixtures/generated/google-provider-identifiers-v1'
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import { Pool } from 'pg'
import { getDb, type Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { EventBus } from '#/shared/events/event-bus'
import type { DomainEvent } from '#/shared/events/events'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  inboxItemId,
  feedbackId,
  organizationId,
  portalId,
  propertyId,
  reviewId,
  replyId,
  userId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import type { Reply, Review } from '#/contexts/review/domain/types'
import {
  inboxItemAssigned,
  inboxItemBulkStatusChanged,
  inboxItemCreated,
  inboxItemStatusChanged,
} from '../../domain/events'
import {
  reviewCreated,
  reviewExpired,
  reviewSourceTransitioned,
  reviewUpdated,
} from '#/contexts/review/domain/events'
import { guestFeedbackRetracted } from '#/contexts/guest/domain/events'
import { createInboxRepository } from './inbox.repository'
import { createReviewRepository } from '#/contexts/review/infrastructure/repositories/review.repository'
import { createReplyRepository } from '#/contexts/review/infrastructure/repositories/reply.repository'
import {
  createAtomicInboxCommandStore as createProductionInboxCommandStore,
  type InboxCommandAuthority,
} from '../inbox-command-store'
import { createReviewSourceLookupAdapter } from '../adapters/review-source-lookup.adapter'
import { createReplyLookupAdapter } from '../adapters/reply-lookup.adapter'
import { rebuildInboxProjection } from '../../application/use-cases/rebuild-inbox-projection'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '../../application/ports/review-lookup.port'
import type { FeedbackLookupPort } from '../../application/ports/feedback-lookup.port'
import type { PropertyLookupPort } from '../../application/ports/property-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'

const ORG_A = organizationId('org-inbox-cmd-aaaa-1111111111111111')
const ORG_B = organizationId('org-inbox-cmd-bbbb-2222222222222222')
const PROP_A = propertyId('4d000000-0000-0000-0000-000000000001')
const PROP_B = propertyId('4d000000-0000-0000-0000-000000000002')
const PROP_C = propertyId('4d000000-0000-0000-0000-000000000003')
const USER_A = userId('user-inbox-cmd-aaaa-1111111111')
const USER_B = userId('user-inbox-cmd-bbbb-2222222222')
const REVIEW_A = reviewId('4d000000-0000-0000-0000-000000000010')
const ITEM_A = inboxItemId('4d000000-0000-0000-0000-000000000020')
const ITEM_B = inboxItemId('4d000000-0000-0000-0000-000000000021')
const FEEDBACK_A = feedbackId('4d000000-0000-0000-0000-000000000030')
const PORTAL_A = portalId('4d000000-0000-0000-0000-000000000040')
const NOW = new Date('2026-06-01T12:00:00.000Z')
const CONSUMER = 'inbox.on-review-created'

const allowAllCommandAuthority: InboxCommandAuthority = async () => ({
  allowed: true,
})

const createAtomicInboxCommandStore = (db: Database, events: EventBus) =>
  createProductionInboxCommandStore(db, events, allowAllCommandAuthority, () => NOW)

let pool: Pool
const db = getDb()

const silentEvents: EventBus = {
  on: () => {},
  emit: async () => {},
  clear: () => {},
}

const noopLogger: LoggerPort = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => noopLogger,
}

const repositoryRuntime = { clock: () => NOW, logger: noopLogger }

// Stub enrichment ports — inbox repo owns the SQL, these just answer lookups.
const stubPorts = {
  reviewLookup: {
    getReviewSnippetById: async (): Promise<ReviewSnippetResult> => ({
      status: 'not_found',
    }),
    getReviewSnippetsByIds: async () => new Map(),
    findEligibleReviewIds: async () => [] as string[],
  } satisfies ReviewLookupPort,
  feedbackLookup: {
    getFeedbackSnippetById: async () => null,
    getFeedbackSnippetsByIds: async () => new Map(),
    findEligibleFeedbackIds: async () => [],
  } satisfies FeedbackLookupPort,
  propertyLookup: {
    getPropertyNameById: async () => null,
    getPropertyNamesByIds: async () => new Map(),
  } satisfies PropertyLookupPort,
}

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: ITEM_A,
    organizationId: ORG_A,
    propertyId: PROP_A,
    sourceType: 'review',
    sourceId: REVIEW_A,
    status: 'open',
    rating: null,
    sourceDate: NOW,
    platform: 'google',
    snippet: null,
    assignedTo: null,
    reviewerName: null,
    propertyName: null,
    isEscalated: false,
    escalatedAt: null,
    escalatedBy: null,
    escalationResolvedAt: null,
    escalationResolvedBy: null,
    closedAt: null,
    firstReplySubmittedAt: null,
    firstReplyPublishedAt: null,
    commandRevision: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: REVIEW_A,
    organizationId: ORG_A,
    propertyId: PROP_A,
    platform: 'google',
    externalId: `ext-${crypto.randomUUID()}`,
    externalLocationId: GOOGLE_LOCATION_PRIMARY_RESOURCE,
    googleConnectionId: null,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    translatedText: null,
    languageCode: 'en',
    reviewedAt: NOW,
    expiresAt: new Date(NOW.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    sourceCreatedAt: NOW,
    sourceUpdatedAt: null,
    firstFetchedAt: NOW,
    lastFetchedAt: NOW,
    contentExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    contentHash: null,
    sourceSeenGeneration: null,
    sourceEpoch: 0,
    sourceRevision: 0,
    analysisSequence: 0,
    aiSourceByteLength: 1,
    aiSourceDigest: '0'.repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId(crypto.randomUUID()),
    reviewId: REVIEW_A,
    organizationId: ORG_A,
    text: 'Thanks!',
    status: 'published',
    source: 'internal',
    createdBy: USER_A,
    approvedBy: USER_A,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    stateRevision: 1,
    submittedAt: new Date('2026-05-28T10:00:00.000Z'),
    approvedAt: new Date('2026-05-28T11:00:00.000Z'),
    publishedAt: new Date('2026-05-29T10:00:00.000Z'),
    publicationState: 'published',
    publicationAttempts: 0,
    publicationCycle: 1,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  }
}

async function seedOrgAndProperty(p: Pool) {
  const slug = 't-' + ORG_A.replace(/-/g, '').slice(-12)
  const conflictingOrganizations = await p.query<{ id: string }>(
    `SELECT id FROM organization WHERE slug = $1 AND id <> $2`,
    [slug, ORG_A],
  )
  await deleteTestOrganizations(
    p,
    conflictingOrganizations.rows.map(({ id }) => id),
  )
  await p.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET slug = EXCLUDED.slug, name = EXCLUDED.name`,
    [ORG_A, `Test Org ${slug}`, slug],
  )
  await p.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     ON CONFLICT (id) DO NOTHING`,
    [PROP_A, ORG_A, 'Inbox Cmd Property', 'inbox-cmd-prop', 'UTC'],
  )
}

async function truncateAll(p: Pool) {
  await p.query('DELETE FROM inbox_notes WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM replies WHERE organization_id = $1', [ORG_A])
  await p.query('DELETE FROM reviews WHERE organization_id = $1', [ORG_A])
  // Receipts cascade from outbox_events.
  await p.query('DELETE FROM outbox_events WHERE organization_id = $1', [ORG_A])
}

/** Insert the delivered source event row (receipts FK to outbox_events.id). */
async function insertSourceEvent(event: DomainEvent): Promise<void> {
  await createOutboxRepository(db).insert({ ...toOutboxEvent(event), id: event.eventId })
}

async function seedReviewRevisionOne(): Promise<void> {
  await createReviewRepository(db, () => new Date()).upsert(
    makeReview({ sourceRevision: 1, analysisSequence: 1 }),
    NOW,
    'f'.repeat(64),
  )
}

async function restoreReviewSourceContentConstraint(): Promise<void> {
  await pool.query(
    `UPDATE inbox_items
     SET rating = NULL, snippet = NULL, reviewer_name = NULL
     WHERE source_type = 'review'
       AND (rating IS NOT NULL OR snippet IS NOT NULL OR reviewer_name IS NOT NULL)`,
  )
  await pool.query(
    'ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS inbox_items_review_source_content_free',
  )
  await pool.query(
    `ALTER TABLE inbox_items
     ADD CONSTRAINT inbox_items_review_source_content_free
     CHECK (
       source_type <> 'review'
       OR (rating IS NULL AND snippet IS NULL AND reviewer_name IS NULL)
     ) NOT VALID`,
  )
  await pool.query(
    'ALTER TABLE inbox_items VALIDATE CONSTRAINT inbox_items_review_source_content_free',
  )
}

const createdFact = (item: InboxItem) =>
  inboxItemCreated({
    inboxItemId: item.id,
    organizationId: item.organizationId,
    propertyId: item.propertyId,
    sourceType: item.sourceType,
    sourceId: item.sourceId,
    occurredAt: item.createdAt,
  })

beforeAll(async () => {
  const env = getEnv()
  pool = new Pool({ connectionString: env.DATABASE_URL, max: 2 })
  const client = await pool.connect()
  client.release()
  clearEventSchemas()
  registerAllEventSchemas()
})

afterAll(async () => {
  clearEventSchemas()
  await truncateAll(pool)
  await pool.end()
})

beforeEach(async () => {
  await truncateAll(pool)
  await seedOrgAndProperty(pool)
})

describe.sequential('inboxCommandStore applyOnce (integration)', () => {
  it('offboarding releases only the departing user assignments with durable facts', async () => {
    const repo = createInboxRepository(db, stubPorts, repositoryRuntime)
    const first = makeItem({
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000014'),
      assignedTo: USER_A,
    })
    const second = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000025'),
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000015'),
      assignedTo: USER_B,
    })
    const store = createAtomicInboxCommandStore(db, silentEvents)
    await store.createItem(first, null, {
      sourceRevision: 1,
      openedReason: 'legacy_backfill',
      actorType: 'system',
      triggerEventId: null,
      openedAt: NOW,
    })
    await store.createItem(second, null, {
      sourceRevision: 1,
      openedReason: 'legacy_backfill',
      actorType: 'system',
      triggerEventId: null,
      openedAt: NOW,
    })

    const result = await createAtomicInboxCommandStore(
      db,
      silentEvents,
    ).releaseAssignmentsForUser({
      organizationId: ORG_A,
      userId: USER_A,
      actorId: USER_B,
      at: NOW,
    })

    expect(result).toEqual({ released: 1 })
    expect((await repo.findById(first.id, ORG_A))?.assignedTo).toBeNull()
    expect((await repo.findById(second.id, ORG_A))?.assignedTo).toBe(USER_B)
    const facts = await pool.query(
      `SELECT event_type, payload FROM outbox_events
       WHERE organization_id = $1 ORDER BY created_at`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([
      expect.objectContaining({ event_type: 'inbox.inbox_item.unassigned' }),
    ])
    expect(facts.rows[0].payload).toMatchObject({
      previousAssignee: USER_A,
      userId: USER_B,
    })
    const history = await pool.query(
      `SELECT reason, handling_cycle_number
       FROM inbox_assignment_history
       WHERE inbox_item_id = $1`,
      [first.id],
    )
    expect(history.rows).toEqual([
      { reason: 'eligibility_lost', handling_cycle_number: '1' },
    ])
  })

  it('eligibility reconciliation releases only denied Property assignments and is retry-safe', async () => {
    const repo = createInboxRepository(db, stubPorts, repositoryRuntime)
    const denied = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000021'),
      propertyId: PROP_A,
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000031'),
      assignedTo: USER_A,
    })
    const retained = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000022'),
      propertyId: PROP_B,
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000032'),
      assignedTo: USER_A,
    })
    const seedingStore = createAtomicInboxCommandStore(db, silentEvents)
    await seedingStore.createItem(denied, null, {
      sourceRevision: 1,
      openedReason: 'legacy_backfill',
      actorType: 'system',
      triggerEventId: null,
      openedAt: NOW,
    })
    await seedingStore.createItem(retained, null, {
      sourceRevision: 1,
      openedReason: 'legacy_backfill',
      actorType: 'system',
      triggerEventId: null,
      openedAt: NOW,
    })
    const authorize: InboxCommandAuthority = vi.fn(async (_tx, input) =>
      input.requirements[0]?.propertyId === PROP_A
        ? { allowed: false as const, reason: 'assignee_assignment_denied' }
        : { allowed: true as const },
    )
    const store = createProductionInboxCommandStore(
      db,
      silentEvents,
      authorize,
      () => NOW,
    )

    await expect(
      store.releaseIneligibleAssignmentsForUser({
        organizationId: ORG_A,
        userId: USER_A,
        actorId: USER_B,
        at: NOW,
      }),
    ).resolves.toEqual({ released: 1 })
    await expect(
      store.releaseIneligibleAssignmentsForUser({
        organizationId: ORG_A,
        userId: USER_A,
        actorId: USER_B,
        at: NOW,
      }),
    ).resolves.toEqual({ released: 0 })

    expect((await repo.findById(denied.id, ORG_A))?.assignedTo).toBeNull()
    expect((await repo.findById(retained.id, ORG_A))?.assignedTo).toBe(USER_A)
    const history = await pool.query(
      `SELECT inbox_item_id, property_id, reason
       FROM inbox_assignment_history
       WHERE inbox_item_id = ANY($1::uuid[])`,
      [[denied.id, retained.id]],
    )
    expect(history.rows).toEqual([
      {
        inbox_item_id: denied.id,
        property_id: PROP_A,
        reason: 'eligibility_lost',
      },
    ])
  })

  it('releases a quarantined legacy Property assignment without a uuid cast', async () => {
    const repo = createInboxRepository(db, stubPorts, repositoryRuntime)
    const legacyPropertyId = propertyId('legacy-property-key')
    const item = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000023'),
      propertyId: legacyPropertyId,
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000033'),
      assignedTo: USER_A,
    })
    await repo.create(item, ORG_A)
    const authorize: InboxCommandAuthority = vi.fn(async () => ({
      allowed: true as const,
    }))

    await expect(
      createProductionInboxCommandStore(
        db,
        silentEvents,
        authorize,
        () => NOW,
      ).releaseIneligibleAssignmentsForUser({
        organizationId: ORG_A,
        userId: USER_A,
        actorId: USER_B,
        at: NOW,
      }),
    ).resolves.toEqual({ released: 1 })

    expect(authorize).not.toHaveBeenCalled()
    const rawItem = await pool.query(
      'SELECT assigned_to FROM inbox_items WHERE id = $1 AND organization_id = $2',
      [item.id, ORG_A],
    )
    expect(rawItem.rows).toEqual([{ assigned_to: null }])
    const history = await pool.query(
      `SELECT property_id, reason
       FROM inbox_assignment_history WHERE inbox_item_id = $1`,
      [item.id],
    )
    expect(history.rows).toEqual([
      { property_id: 'legacy-property-key', reason: 'eligibility_lost' },
    ])
  })

  it('anchors a human Review assignment to its current Handling Cycle', async () => {
    const reviewRepo = createReviewRepository(db, () => new Date())
    await reviewRepo.upsert(
      makeReview({
        sourceRevision: 1,
        analysisSequence: 1,
      }),
      NOW,
      'a'.repeat(64),
    )
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const item = makeItem()
    await store.createItem(item, null, { materialReviewRevision: 1 })

    const assigned = await store.assign(
      item,
      { assignedTo: USER_A },
      inboxItemAssigned({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        userId: USER_A,
        assignedTo: USER_A,
        source: 'web',
        occurredAt: NOW,
      }),
      NOW,
    )

    expect(assigned.commandRevision).toBe(2)
    const history = await pool.query(
      `SELECT resulting_command_revision::text, handling_cycle_number::text,
              previous_assignee, next_assignee, reason
       FROM inbox_assignment_history
       WHERE inbox_item_id = $1`,
      [item.id],
    )
    expect(history.rows).toEqual([
      {
        resulting_command_revision: '2',
        handling_cycle_number: '1',
        previous_assignee: null,
        next_assignee: USER_A,
        reason: 'claim',
      },
    ])
  })

  it('lets exactly one concurrent governed Review reopen advance the canonical head', async () => {
    const reviewRepo = createReviewRepository(db, () => new Date())
    await reviewRepo.upsert(
      makeReview({ sourceRevision: 1, analysisSequence: 1 }),
      NOW,
      'c'.repeat(64),
    )
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const closed = makeItem({
      status: 'closed',
      closedAt: NOW,
      assignedTo: USER_A,
    })
    await store.createItem(closed, null, { materialReviewRevision: 1 })
    const fact = inboxItemStatusChanged({
      inboxItemId: closed.id,
      organizationId: closed.organizationId,
      propertyId: closed.propertyId,
      oldStatus: 'closed',
      newStatus: 'open',
      userId: USER_B,
      occurredAt: NOW,
    })
    const command = {
      item: closed,
      expected: {
        cycleNumber: 1,
        materialReviewRevision: 1,
        stateRevision: 1,
      },
      reason: 'other' as const,
      explanation: '  A new guest message needs a response.  ',
      fact,
      now: NOW,
    }

    const outcomes = await Promise.allSettled([
      store.reopenReviewCycle(command),
      store.reopenReviewCycle(command),
    ])

    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1)
    const rejected = outcomes.find((outcome) => outcome.status === 'rejected')
    expect(rejected?.status).toBe('rejected')
    if (rejected?.status === 'rejected') {
      expect(rejected.reason).toMatchObject({ code: 'revision_conflict' })
    }
    await expect(store.reopenReviewCycle(command)).rejects.toMatchObject({
      code: 'revision_conflict',
    })

    const proof = await pool.query(
      `SELECT
         item.status AS item_status,
         item.closed_at,
         item.assigned_to,
         item.command_revision::int AS command_revision,
         head.status AS head_status,
         head.current_cycle_number::int AS cycle_number,
         head.state_revision::int AS state_revision,
         cycle.opened_reason,
         cycle.manual_reopen_reason,
         cycle.manual_reopen_explanation,
         cycle.opened_by,
         (SELECT count(*)::int FROM inbox_handling_cycles all_cycles
          WHERE all_cycles.inbox_item_id = item.id) AS cycle_count,
         (SELECT count(*)::int FROM outbox_events event
          WHERE event.organization_id = item.organization_id
            AND event.event_type = 'inbox.inbox_item.status_changed'
            AND event.payload->>'inboxItemId' = item.id::text) AS fact_count
       FROM inbox_items item
       JOIN inbox_handling_cycle_heads head ON head.inbox_item_id = item.id
       JOIN inbox_handling_cycles cycle
         ON cycle.inbox_item_id = head.inbox_item_id
        AND cycle.cycle_number = head.current_cycle_number
       WHERE item.id = $1`,
      [closed.id],
    )
    expect(proof.rows).toEqual([
      {
        item_status: 'open',
        closed_at: null,
        assigned_to: USER_A,
        command_revision: 2,
        head_status: 'open',
        cycle_number: 2,
        state_revision: 2,
        opened_reason: 'manual_reopen',
        manual_reopen_reason: 'other',
        manual_reopen_explanation: 'A new guest message needs a response.',
        opened_by: USER_B,
        cycle_count: 2,
        fact_count: 1,
      },
    ])
  })

  it('bulk reopen reports a stale row and emits a fact only for the landed CAS', async () => {
    const first = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000026'),
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000016'),
      platform: null,
      status: 'closed',
      closedAt: NOW,
    })
    const second = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000027'),
      sourceType: 'feedback',
      sourceId: feedbackId('4d000000-0000-0000-0000-000000000017'),
      platform: null,
      status: 'closed',
      closedAt: NOW,
    })
    const store = createAtomicInboxCommandStore(db, silentEvents)
    for (const item of [first, second]) {
      await store.createItem(item, null, {
        sourceRevision: 1,
        openedReason: 'legacy_backfill',
        actorType: 'system',
        triggerEventId: null,
        openedAt: NOW,
      })
    }

    // Represents a writer that won after the client loaded revision 1 while
    // preserving the same visible status.
    await pool.query(`UPDATE inbox_items SET command_revision = 2 WHERE id = $1`, [
      second.id,
    ])
    const events = [first, second].map((item) =>
      inboxItemBulkStatusChanged({
        inboxItemId: item.id,
        organizationId: item.organizationId,
        propertyId: item.propertyId,
        oldStatus: 'closed',
        newStatus: 'open',
        bulkId: 'bulk-stale-row',
        userId: USER_A,
        occurredAt: NOW,
      }),
    )

    const result = await store.bulkUpdateStatus([first, second], events, {
      reason: 'new_information',
      explanation: null,
    })

    expect(result).toEqual({
      updated: 1,
      results: [
        { inboxItemId: first.id, outcome: 'reopened' },
        { inboxItemId: second.id, outcome: 'revision_conflict' },
      ],
    })
    const rows = await pool.query(
      `SELECT id, status, command_revision::text
       FROM inbox_items WHERE id = ANY($1::uuid[]) ORDER BY id`,
      [[first.id, second.id]],
    )
    expect(rows.rows).toEqual([
      { id: first.id, status: 'open', command_revision: '2' },
      { id: second.id, status: 'closed', command_revision: '2' },
    ])
    const facts = await pool.query(
      `SELECT payload->>'inboxItemId' AS inbox_item_id
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.inbox_item.bulk_status_changed'`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([{ inbox_item_id: first.id }])
  })

  it('serializes opposite-order bulk reopen batches without a row-lock cycle', async () => {
    const reviewRepo = createReviewRepository(db, () => new Date())
    const firstReviewId = reviewId('4d000000-0000-0000-0000-000000000018')
    const secondReviewId = reviewId('4d000000-0000-0000-0000-000000000019')
    await reviewRepo.upsert(
      makeReview({ id: firstReviewId, sourceRevision: 1, analysisSequence: 1 }),
      NOW,
      'd'.repeat(64),
    )
    await reviewRepo.upsert(
      makeReview({ id: secondReviewId, sourceRevision: 1, analysisSequence: 1 }),
      NOW,
      'e'.repeat(64),
    )
    const first = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000028'),
      sourceId: firstReviewId,
      status: 'closed',
      closedAt: NOW,
    })
    const second = makeItem({
      id: inboxItemId('4d000000-0000-0000-0000-000000000029'),
      sourceId: secondReviewId,
      status: 'closed',
      closedAt: NOW,
    })
    const store = createAtomicInboxCommandStore(db, silentEvents)
    await store.createItem(first, null, { materialReviewRevision: 1 })
    await store.createItem(second, null, { materialReviewRevision: 1 })
    const command = (items: readonly InboxItem[], bulkId: string) =>
      store.bulkUpdateStatus(
        items,
        items.map((item) =>
          inboxItemBulkStatusChanged({
            inboxItemId: item.id,
            organizationId: item.organizationId,
            propertyId: item.propertyId,
            oldStatus: 'closed',
            newStatus: 'open',
            bulkId,
            userId: USER_A,
            occurredAt: NOW,
          }),
        ),
        { reason: 'new_information', explanation: null },
      )

    const [forward, reverse] = await Promise.all([
      command([first, second], 'bulk-forward'),
      command([second, first], 'bulk-reverse'),
    ])

    expect(forward.updated + reverse.updated).toBe(2)
    expect(forward.results.map((result) => result.inboxItemId)).toEqual([
      first.id,
      second.id,
    ])
    expect(reverse.results.map((result) => result.inboxItemId)).toEqual([
      second.id,
      first.id,
    ])
    const rows = await pool.query(
      `SELECT item.id, item.status, item.command_revision::int,
              head.status AS head_status,
              head.current_cycle_number::int AS cycle_number,
              head.state_revision::int AS state_revision,
              cycle.opened_reason,
              cycle.manual_reopen_reason
       FROM inbox_items item
       JOIN inbox_handling_cycle_heads head ON head.inbox_item_id = item.id
       JOIN inbox_handling_cycles cycle
         ON cycle.inbox_item_id = head.inbox_item_id
        AND cycle.cycle_number = head.current_cycle_number
       WHERE item.id = ANY($1::uuid[]) ORDER BY item.id`,
      [[first.id, second.id]],
    )
    expect(rows.rows).toEqual([
      {
        id: first.id,
        status: 'open',
        command_revision: 2,
        head_status: 'open',
        cycle_number: 2,
        state_revision: 2,
        opened_reason: 'manual_reopen',
        manual_reopen_reason: 'new_information',
      },
      {
        id: second.id,
        status: 'open',
        command_revision: 2,
        head_status: 'open',
        cycle_number: 2,
        state_revision: 2,
        opened_reason: 'manual_reopen',
        manual_reopen_reason: 'new_information',
      },
    ])
    const facts = await pool.query(
      `SELECT payload->>'inboxItemId' AS inbox_item_id
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type = 'inbox.inbox_item.bulk_status_changed'
       ORDER BY payload->>'inboxItemId'`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([
      { inbox_item_id: first.id },
      { inbox_item_id: second.id },
    ])
  })

  it('applySourceCreatedOnce commits item + fact + receipt in one transaction', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const item = makeItem()
    const fact = createdFact(item)
    const outcome = await store.applySourceCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item,
      fact,
    })

    expect(outcome).toBe('applied')
    const items = await pool.query(
      'SELECT * FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(1)
    const facts = await pool.query(
      `SELECT id, event_type, payload FROM outbox_events
       WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(1)
    expect(facts.rows[0].id).toBe(fact.eventId)
    const receipts = await pool.query(
      `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
      [source.eventId],
    )
    expect(receipts.rows).toEqual([{ consumer_name: CONSUMER, status: 'applied' }])
  })

  it('rolls back the item insert when the fact insert fails (unregistered type)', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const ghost = {
      ...createdFact(makeItem()),
      _tag: 'inbox.inbox_item.ghost',
    } as unknown as Parameters<typeof store.applySourceCreatedOnce>[0]['fact']

    await expect(
      store.applySourceCreatedOnce({
        eventId: source.eventId,
        consumerName: CONSUMER,
        item: makeItem(),
        fact: ghost,
      }),
    ).rejects.toThrow(
      /Event type inbox\.inbox_item\.ghost:v1 is not registered for the outbox/,
    )

    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(0)
    const receipts = await pool.query(
      'SELECT event_id FROM event_consumer_receipts WHERE event_id = $1',
      [source.eventId],
    )
    expect(receipts.rows).toHaveLength(0)
  })

  it('rolls back item + fact when the receipt insert fails (source event row missing)', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db, silentEvents)
    // No source outbox row — the receipt FK to outbox_events.id fails inside
    // the transaction, proving state+fact+receipt are one commit.
    const ghostEventId = crypto.randomUUID()

    await expect(
      store.applySourceCreatedOnce({
        eventId: ghostEventId,
        consumerName: CONSUMER,
        item: makeItem(),
        fact: createdFact(makeItem()),
      }),
    ).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.cause instanceof Error &&
        /insert or update on table "event_consumer_receipts" violates foreign key constraint "event_consumer_receipts_event_id_fkey"/.test(
          e.cause.message,
        ),
    )

    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(0)
    const facts = await pool.query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(0)
  })

  it('duplicate delivery: exactly one item, one fact, receipt present', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const source = reviewCreated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 1,
      occurredAt: NOW,
    })
    await insertSourceEvent(source)

    const item = makeItem()
    const first = await store.applySourceCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item,
      fact: createdFact(item),
    })
    // Same delivered event again (replay after the receipt pre-check raced).
    const second = await store.applySourceCreatedOnce({
      eventId: source.eventId,
      consumerName: CONSUMER,
      item: makeItem({ id: inboxItemId(crypto.randomUUID()) }),
      fact: createdFact(item),
    })

    expect(first).toBe('applied')
    expect(second).toBe('duplicate')
    const items = await pool.query(
      'SELECT id FROM inbox_items WHERE organization_id = $1',
      [ORG_A],
    )
    expect(items.rows).toHaveLength(1)
    const facts = await pool.query(
      `SELECT id FROM outbox_events WHERE organization_id = $1 AND event_type = 'inbox.inbox_item.created'`,
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(1)
    const receipts = await pool.query(
      'SELECT event_id FROM event_consumer_receipts WHERE event_id = $1',
      [source.eventId],
    )
    expect(receipts.rows).toHaveLength(1)
  })

  it('co-commits a genuine material Review cycle and makes replay inert', async () => {
    await seedReviewRevisionOne()
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const item = makeItem()
    await store.createItem(item, null, { materialReviewRevision: 1 })

    await createReviewRepository(db, () => new Date()).upsert(
      makeReview({
        sourceRevision: 2,
        analysisSequence: 2,
        text: 'Materially revised review',
        updatedAt: new Date(NOW.getTime() + 1_000),
      }),
      new Date(NOW.getTime() + 1_000),
      '2'.repeat(64),
    )
    const source = reviewUpdated({
      reviewId: REVIEW_A,
      propertyId: PROP_A,
      organizationId: ORG_A,
      platform: 'google',
      sourceEpoch: 0,
      sourceRevision: 2,
      analysisSequence: 2,
      occurredAt: new Date(NOW.getTime() + 1_000),
    })
    await insertSourceEvent(source)

    const command = {
      eventId: source.eventId,
      consumerName: 'inbox.on-review-updated',
      item,
      sourceDate: source.occurredAt,
      platform: 'google',
      materialReviewRevision: 2,
      now: source.occurredAt,
    } as const
    await expect(store.applyReviewUpdatedOnce(command)).resolves.toBe('applied')
    await expect(store.applyReviewUpdatedOnce(command)).resolves.toBe('applied')

    const lifecycle = await pool.query(
      `SELECT state_revision::int, cycle_number::int, kind, transition_reason,
              source_revision::int, trigger_event_id::text
       FROM inbox_handling_cycle_transitions
       WHERE inbox_item_id = $1
       ORDER BY state_revision`,
      [ITEM_A],
    )
    expect(lifecycle.rows).toEqual([
      {
        state_revision: 1,
        cycle_number: 1,
        kind: 'opened',
        transition_reason: 'review_observed',
        source_revision: 1,
        trigger_event_id: null,
      },
      {
        state_revision: 2,
        cycle_number: 1,
        kind: 'closed',
        transition_reason: 'superseded_by_source_revision',
        source_revision: 1,
        trigger_event_id: source.eventId,
      },
      {
        state_revision: 3,
        cycle_number: 2,
        kind: 'opened',
        transition_reason: 'material_revision_changed',
        source_revision: 2,
        trigger_event_id: source.eventId,
      },
    ])
    const facts = await pool.query<{
      event_type: string
      payload: Record<string, unknown>
    }>(
      `SELECT event_type, payload
       FROM outbox_events
       WHERE organization_id = $1
         AND event_type IN (
           'inbox.handling_cycle.closed',
           'inbox.handling_cycle.opened'
         )
       ORDER BY payload->>'stateRevision'`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([
      expect.objectContaining({
        event_type: 'inbox.handling_cycle.closed',
        payload: expect.objectContaining({
          cycleNumber: 1,
          stateRevision: 2,
          closeReason: 'superseded_by_source_revision',
          sourceRevision: 1,
          triggerEventId: source.eventId,
        }),
      }),
      expect.objectContaining({
        event_type: 'inbox.handling_cycle.opened',
        payload: expect.objectContaining({
          cycleNumber: 2,
          stateRevision: 3,
          openReason: 'material_revision_changed',
          sourceRevision: 2,
          triggerEventId: source.eventId,
        }),
      }),
    ])
    const receipt = await pool.query(
      `SELECT count(*)::int AS count
       FROM event_consumer_receipts
       WHERE event_id = $1 AND consumer_name = 'inbox.on-review-updated'`,
      [source.eventId],
    )
    expect(receipt.rows).toEqual([{ count: 1 }])
  })

  it('scrubs a seeded legacy Review projection once while preserving identity and notes', async () => {
    await pool.query(
      'ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS inbox_items_review_source_content_free',
    )
    try {
      await seedReviewRevisionOne()
      const legacy = makeItem({
        rating: 1,
        snippet: 'legacy provider-controlled review text',
        reviewerName: 'Legacy guest',
        assignedTo: USER_A,
        commandRevision: Number.MAX_SAFE_INTEGER,
      })
      const store = createAtomicInboxCommandStore(db, silentEvents)
      await store.createItem(legacy, null, { materialReviewRevision: 1 })
      const noteId = '4d000000-0000-0000-0000-000000000099'
      await pool.query(
        `INSERT INTO inbox_notes (
           id, inbox_item_id, organization_id, author_user_id, text, created_at
         ) VALUES ($1, $2, $3, $4, 'Manager-owned history', $5)`,
        [noteId, legacy.id, ORG_A, USER_A, NOW],
      )

      const source = reviewSourceTransitioned({
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG_A,
        sourceEpoch: 1,
        sourceRevision: 2,
        analysisSequence: 2,
        change: 'source_expired',
        occurredAt: NOW,
      })
      await insertSourceEvent(source)
      const command = {
        eventId: source.eventId,
        consumerName: 'inbox.on-review-source-transitioned',
        item: legacy,
        transitionedAt: NOW,
        closeIfOpen: true,
        closeFact: inboxItemStatusChanged({
          inboxItemId: legacy.id,
          organizationId: legacy.organizationId,
          propertyId: legacy.propertyId,
          oldStatus: 'open',
          newStatus: 'closed',
          occurredAt: NOW,
        }),
      } as const
      await expect(store.applyReviewSourceTransitionedOnce(command)).resolves.toBe(
        'applied',
      )
      await expect(store.applyReviewSourceTransitionedOnce(command)).resolves.toBe(
        'applied',
      )

      const proof = await pool.query(
        `SELECT
           item.id,
           item.source_id,
           item.status,
           item.rating,
           item.snippet,
           item.reviewer_name,
           item.assigned_to,
           item.command_revision::text AS command_revision,
           (SELECT count(*)::int FROM inbox_notes note
            WHERE note.inbox_item_id = item.id) AS note_count,
           (SELECT count(*)::int FROM event_consumer_receipts receipt
            WHERE receipt.event_id = $2
              AND receipt.consumer_name = 'inbox.on-review-source-transitioned')
             AS receipt_count,
           (SELECT count(*)::int FROM outbox_events fact
            WHERE fact.organization_id = $3
              AND fact.event_type = 'inbox.inbox_item.status_changed'
              AND fact.payload->>'inboxItemId' = item.id::text) AS status_fact_count
         FROM inbox_items item
         WHERE item.id = $1`,
        [legacy.id, source.eventId, ORG_A],
      )
      expect(proof.rows).toEqual([
        {
          id: legacy.id,
          source_id: REVIEW_A,
          status: 'closed',
          rating: null,
          snippet: null,
          reviewer_name: null,
          assigned_to: USER_A,
          command_revision: String(Number.MAX_SAFE_INTEGER),
          note_count: 1,
          receipt_count: 1,
          status_fact_count: 1,
        },
      ])
    } finally {
      await restoreReviewSourceContentConstraint()
    }
  })

  it('legacy expiry replay scrubs content without stale-closing the current Handling Cycle', async () => {
    await pool.query(
      'ALTER TABLE inbox_items DROP CONSTRAINT IF EXISTS inbox_items_review_source_content_free',
    )
    try {
      const reviewRepo = createReviewRepository(db, () => new Date())
      await reviewRepo.upsert(
        makeReview({ sourceRevision: 1, analysisSequence: 1 }),
        NOW,
        'b'.repeat(64),
      )
      const legacy = makeItem({
        rating: 2,
        snippet: 'delayed legacy provider text',
        reviewerName: 'Delayed legacy guest',
        assignedTo: USER_A,
        commandRevision: Number.MAX_SAFE_INTEGER,
      })
      const store = createAtomicInboxCommandStore(db, silentEvents)
      await store.createItem(legacy, null, { materialReviewRevision: 1 })
      const noteId = '4d000000-0000-0000-0000-000000000098'
      await pool.query(
        `INSERT INTO inbox_notes (
           id, inbox_item_id, organization_id, author_user_id, text, created_at
         ) VALUES ($1, $2, $3, $4, 'Current manager history', $5)`,
        [noteId, legacy.id, ORG_A, USER_A, NOW],
      )

      const source = reviewExpired({
        reviewId: REVIEW_A,
        propertyId: PROP_A,
        organizationId: ORG_A,
        occurredAt: new Date('2026-06-01T12:05:00.000Z'),
      })
      await insertSourceEvent(source)
      const command = {
        eventId: source.eventId,
        consumerName: 'inbox.on-review-expired',
        item: legacy,
        transitionedAt: source.occurredAt,
        closeIfOpen: false,
        closeFact: inboxItemStatusChanged({
          inboxItemId: legacy.id,
          organizationId: legacy.organizationId,
          propertyId: legacy.propertyId,
          oldStatus: 'open',
          newStatus: 'closed',
          occurredAt: source.occurredAt,
        }),
      } as const

      await expect(store.applyReviewSourceTransitionedOnce(command)).resolves.toBe(
        'applied',
      )
      await expect(store.applyReviewSourceTransitionedOnce(command)).resolves.toBe(
        'applied',
      )

      const proof = await pool.query(
        `SELECT
           item.id,
           item.source_id,
           item.status AS item_status,
           head.status AS cycle_status,
           head.current_cycle_number::int AS cycle_number,
           item.rating,
           item.snippet,
           item.reviewer_name,
           item.assigned_to,
           item.command_revision::text AS command_revision,
           (SELECT count(*)::int FROM inbox_notes note
            WHERE note.inbox_item_id = item.id) AS note_count,
           (SELECT count(*)::int FROM event_consumer_receipts receipt
            WHERE receipt.event_id = $2
              AND receipt.consumer_name = 'inbox.on-review-expired') AS receipt_count,
           (SELECT count(*)::int FROM outbox_events fact
            WHERE fact.organization_id = $3
              AND fact.event_type = 'inbox.inbox_item.status_changed'
              AND fact.payload->>'inboxItemId' = item.id::text) AS status_fact_count
         FROM inbox_items item
         JOIN inbox_handling_cycle_heads head ON head.inbox_item_id = item.id
         WHERE item.id = $1`,
        [legacy.id, source.eventId, ORG_A],
      )
      expect(proof.rows).toEqual([
        {
          id: legacy.id,
          source_id: REVIEW_A,
          item_status: 'open',
          cycle_status: 'open',
          cycle_number: 1,
          rating: null,
          snippet: null,
          reviewer_name: null,
          assigned_to: USER_A,
          command_revision: String(Number.MAX_SAFE_INTEGER),
          note_count: 1,
          receipt_count: 1,
          status_fact_count: 0,
        },
      ])
    } finally {
      await restoreReviewSourceContentConstraint()
    }
  })

  it('applySourceWithdrawnOnce closes feedback work with fact + receipt atomically', async () => {
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: FEEDBACK_A,
      platform: null,
    })
    await store.createItem(item, null, {
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: null,
      openedAt: NOW,
    })
    const source = guestFeedbackRetracted({
      feedbackId: FEEDBACK_A,
      organizationId: ORG_A,
      propertyId: PROP_A,
      portalId: PORTAL_A,
      supersedesSourceEventId: crypto.randomUUID(),
      occurredAt: NOW,
    })
    await insertSourceEvent(source)
    const fact = inboxItemStatusChanged({
      inboxItemId: ITEM_A,
      organizationId: ORG_A,
      propertyId: PROP_A,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: NOW,
    })

    await expect(
      store.applySourceWithdrawnOnce({
        eventId: source.eventId,
        consumerName: 'inbox.on-guest-feedback-retracted',
        item,
        sourceRevision: 1,
        now: NOW,
        fact,
      }),
    ).resolves.toBe('applied')

    const rows = await pool.query(
      'SELECT status, closed_at FROM inbox_items WHERE id = $1',
      [ITEM_A],
    )
    expect(rows.rows).toEqual([{ status: 'closed', closed_at: NOW }])
    const facts = await pool.query(`SELECT id FROM outbox_events WHERE id = $1`, [
      fact.eventId,
    ])
    expect(facts.rows).toHaveLength(1)
    const receipts = await pool.query(
      `SELECT consumer_name, status FROM event_consumer_receipts WHERE event_id = $1`,
      [source.eventId],
    )
    expect(receipts.rows).toEqual([
      { consumer_name: 'inbox.on-guest-feedback-retracted', status: 'applied' },
    ])
    const lifecycle = await pool.query(
      `SELECT state_revision::int, cycle_number::int, kind, transition_reason,
              actor_type
       FROM inbox_handling_cycle_transitions
       WHERE inbox_item_id = $1
       ORDER BY state_revision`,
      [ITEM_A],
    )
    expect(lifecycle.rows).toEqual([
      {
        state_revision: 1,
        cycle_number: 1,
        kind: 'opened',
        transition_reason: 'feedback_submitted',
        actor_type: 'guest',
      },
      {
        state_revision: 2,
        cycle_number: 1,
        kind: 'closed',
        transition_reason: 'guest_withdrawn',
        actor_type: 'guest',
      },
    ])
  })

  it('applySourceWithdrawnOnce repairs a closed compatibility row under an open cycle head', async () => {
    const store = createAtomicInboxCommandStore(db, silentEvents)
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: FEEDBACK_A,
      platform: null,
    })
    await store.createItem(item, null, {
      sourceRevision: 1,
      openedReason: 'feedback_submitted',
      actorType: 'guest',
      triggerEventId: null,
      openedAt: NOW,
    })
    const driftedClosedAt = new Date('2026-05-31T12:00:00.000Z')
    await pool.query(
      `UPDATE inbox_items SET status = 'closed', closed_at = $2
       WHERE id = $1`,
      [item.id, driftedClosedAt],
    )
    const source = guestFeedbackRetracted({
      feedbackId: FEEDBACK_A,
      organizationId: ORG_A,
      propertyId: PROP_A,
      portalId: PORTAL_A,
      supersedesSourceEventId: crypto.randomUUID(),
      occurredAt: NOW,
    })
    await insertSourceEvent(source)
    const fact = inboxItemStatusChanged({
      inboxItemId: item.id,
      organizationId: item.organizationId,
      propertyId: item.propertyId,
      oldStatus: 'open',
      newStatus: 'closed',
      occurredAt: NOW,
    })

    await expect(
      store.applySourceWithdrawnOnce({
        eventId: source.eventId,
        consumerName: 'inbox.on-guest-feedback-retracted',
        item: { ...item, status: 'closed', closedAt: driftedClosedAt },
        sourceRevision: 1,
        now: NOW,
        fact,
      }),
    ).resolves.toBe('applied')

    const proof = await pool.query(
      `SELECT item.status AS item_status, item.closed_at,
              head.status AS head_status, head.state_revision::int,
              (SELECT count(*)::int FROM outbox_events WHERE id = $2) AS fact_count,
              (SELECT count(*)::int FROM event_consumer_receipts
               WHERE event_id = $3
                 AND consumer_name = 'inbox.on-guest-feedback-retracted') AS receipt_count
       FROM inbox_items item
       JOIN inbox_handling_cycle_heads head ON head.inbox_item_id = item.id
       WHERE item.id = $1`,
      [item.id, fact.eventId, source.eventId],
    )
    expect(proof.rows).toEqual([
      {
        item_status: 'closed',
        closed_at: NOW,
        head_status: 'closed',
        state_revision: 2,
        fact_count: 1,
        receipt_count: 1,
      },
    ])
  })

  it('isolates the same feedback source identity and lifecycle by tenant', async () => {
    await pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Other Inbox Cycle Org', 'other-inbox-cycle-org', NOW())`,
      [ORG_B],
    )
    await pool.query(
      `INSERT INTO properties (
         id, organization_id, name, slug, timezone, created_at, updated_at
       ) VALUES ($1, $2, 'Other Cycle Property', 'other-cycle-property',
                 'UTC', NOW(), NOW())`,
      [PROP_C, ORG_B],
    )
    try {
      const store = createAtomicInboxCommandStore(db, silentEvents)
      const first = makeItem({
        sourceType: 'feedback',
        sourceId: FEEDBACK_A,
        platform: null,
      })
      const second = makeItem({
        id: ITEM_B,
        organizationId: ORG_B,
        propertyId: PROP_C,
        sourceType: 'feedback',
        sourceId: FEEDBACK_A,
        platform: null,
      })
      const anchor = {
        sourceRevision: 1,
        openedReason: 'feedback_submitted' as const,
        actorType: 'guest' as const,
        triggerEventId: null,
        openedAt: NOW,
      }
      await store.createItem(first, null, anchor)
      await store.createItem(second, null, anchor)

      await store.updateStatus(
        first,
        { status: 'closed', timestampFields: { closedAt: NOW } },
        inboxItemStatusChanged({
          inboxItemId: first.id,
          organizationId: first.organizationId,
          propertyId: first.propertyId,
          oldStatus: 'open',
          newStatus: 'closed',
          userId: USER_A,
          occurredAt: NOW,
        }),
        NOW,
      )

      const heads = await pool.query(
        `SELECT organization_id, inbox_item_id::text, status, state_revision::int
         FROM inbox_handling_cycle_heads
         WHERE source_type = 'feedback' AND source_id = $1
         ORDER BY organization_id`,
        [FEEDBACK_A],
      )
      expect(heads.rows).toEqual([
        {
          organization_id: ORG_A,
          inbox_item_id: ITEM_A,
          status: 'closed',
          state_revision: 2,
        },
        {
          organization_id: ORG_B,
          inbox_item_id: ITEM_B,
          status: 'open',
          state_revision: 1,
        },
      ])
      const otherTransitions = await pool.query(
        `SELECT kind, transition_reason
         FROM inbox_handling_cycle_transitions
         WHERE inbox_item_id = $1 ORDER BY state_revision`,
        [ITEM_B],
      )
      expect(otherTransitions.rows).toEqual([
        { kind: 'opened', transition_reason: 'feedback_submitted' },
      ])
    } finally {
      await pool.query('DELETE FROM inbox_items WHERE organization_id = $1', [ORG_B])
      await pool.query('DELETE FROM properties WHERE organization_id = $1', [ORG_B])
      await deleteTestOrganizations(pool, [ORG_B])
    }
  })
})

describe.sequential('rebuildInboxProjection (integration)', () => {
  function makeRebuild() {
    const reviewRepo = createReviewRepository(db, () => new Date())
    const replyRepo = createReplyRepository(db, () => new Date())
    const repo = createInboxRepository(db, stubPorts, repositoryRuntime)
    const commandStore = createAtomicInboxCommandStore(db, silentEvents)
    const useCase = rebuildInboxProjection({
      repo,
      commandStore,
      reviewSourceLookup: createReviewSourceLookupAdapter({
        findById: (id, orgId) => reviewRepo.findById(id, orgId),
        findByIds: (ids, orgId) => reviewRepo.findByIds(ids, orgId),
        findByOrganizationId: (orgId) => reviewRepo.findByOrganizationId(orgId),
        findByPropertyId: (pid, orgId) => reviewRepo.findByPropertyId(pid, orgId),
      }),
      replyLookup: createReplyLookupAdapter({
        findByReviewId: (id, orgId) => replyRepo.findByReviewId(id, orgId),
        findMilestonesByReviewIds: (ids, orgId) =>
          replyRepo.findMilestonesByReviewIds(ids, orgId),
      }),
      idGen: () => inboxItemId(crypto.randomUUID()),
      clock: () => NOW,
      logger: noopLogger,
    })
    return { useCase, repo, reviewRepo, replyRepo, commandStore }
  }

  async function seedCanonicalState() {
    const { reviewRepo, replyRepo, repo, commandStore } = makeRebuild()
    // LIVE-PUBLISHED: historical publish metadata is stamped, but rebuild is
    // not exact-current Reply authority and therefore cannot close the cycle.
    const livePublished = makeReview({
      id: reviewId('4d000000-0000-0000-0000-000000000011'),
    })
    const storedLivePublished = await reviewRepo.upsert(livePublished)
    await replyRepo.upsert(makeReply({ reviewId: livePublished.id }))
    await commandStore.createItem(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000021'),
        sourceId: livePublished.id,
      }),
      null,
      { materialReviewRevision: storedLivePublished.sourceRevision },
    )
    // MISSING: review live, no item — heal = create (no created fact).
    const missing = makeReview({ id: reviewId('4d000000-0000-0000-0000-000000000012') })
    await reviewRepo.upsert(missing)
    // EXPIRED: content clock alone is not Handling Cycle close authority.
    const expired = makeReview({
      id: reviewId('4d000000-0000-0000-0000-000000000013'),
      contentExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    })
    const storedExpired = await reviewRepo.upsert(expired)
    await commandStore.createItem(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000022'),
        sourceId: expired.id,
      }),
      null,
      { materialReviewRevision: storedExpired.sourceRevision },
    )
    // PURGED/ORPHAN: deliberately raw repair fixture. It remains hidden from
    // active reads and rebuild must not guess a status transition.
    await repo.create(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000023'),
        sourceId: reviewId('4d000000-0000-0000-0000-000000000099'),
      }),
      ORG_A,
    )
    // HEALTHY: live review, item closed with milestones — no change.
    const healthy = makeReview({ id: reviewId('4d000000-0000-0000-0000-000000000014') })
    const storedHealthy = await reviewRepo.upsert(healthy)
    await commandStore.createItem(
      makeItem({
        id: inboxItemId('4d000000-0000-0000-0000-000000000024'),
        sourceId: healthy.id,
        status: 'closed',
        closedAt: NOW,
        firstReplyPublishedAt: NOW,
        assignedTo: USER_A,
        isEscalated: true,
        escalatedAt: NOW,
        escalatedBy: USER_A,
      }),
      null,
      { materialReviewRevision: storedHealthy.sourceRevision },
    )
  }

  it('heals a corrupted projection from canonical data and reports it', async () => {
    const { useCase, repo } = makeRebuild()
    await seedCanonicalState()

    const report = await useCase({ organizationId: ORG_A, dryRun: false })

    expect(report.dryRun).toBe(false)
    expect(report.created).toBe(1)
    expect(report.closed).toBe(0)
    expect(report.milestones).toBe(1)
    expect(report.scanned).toBe(8) // 4 items + 4 canonical reviews

    // Historical milestones are repaired, while the canonical head stays open.
    const healed = await repo.findById(
      inboxItemId('4d000000-0000-0000-0000-000000000021'),
      ORG_A,
    )
    expect(healed?.status).toBe('open')
    expect(healed?.firstReplySubmittedAt).toEqual(new Date('2026-05-28T10:00:00.000Z'))
    expect(healed?.firstReplyPublishedAt).toEqual(new Date('2026-05-29T10:00:00.000Z'))

    // created for the missing review (source metadata from canonical data)
    const created = await repo.findBySource(
      'review',
      '4d000000-0000-0000-0000-000000000012',
      ORG_A,
    )
    expect(created).not.toBeNull()
    expect(created?.status).toBe('open')
    expect(created?.sourceDate).toEqual(NOW)

    // Expiry does not close the exact current cycle.
    expect(
      (await repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000022'), ORG_A))
        ?.status,
    ).toBe('open')
    // The orphan remains non-actionable and its raw compatibility status is
    // unchanged rather than being promoted to a guessed close.
    await expect(
      repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000023'), ORG_A),
    ).resolves.toBeNull()
    const orphan = await pool.query(
      'SELECT status FROM inbox_items WHERE id = $1 AND organization_id = $2',
      ['4d000000-0000-0000-0000-000000000023', ORG_A],
    )
    expect(orphan.rows).toEqual([{ status: 'open' }])

    // healthy item untouched — inbox-owned fields preserved
    const healthy = await repo.findById(
      inboxItemId('4d000000-0000-0000-0000-000000000024'),
      ORG_A,
    )
    expect(healthy?.assignedTo).toBe(USER_A)
    expect(healthy?.isEscalated).toBe(true)

    // Repair records no inferred status facts and no synthetic created fact.
    const facts = await pool.query(
      `SELECT event_type, COUNT(*)::int AS n FROM outbox_events
       WHERE organization_id = $1 GROUP BY event_type ORDER BY event_type`,
      [ORG_A],
    )
    expect(facts.rows).toEqual([])

    // idempotent: a second run reconciles nothing
    const second = await useCase({ organizationId: ORG_A, dryRun: false })
    expect(second).toMatchObject({ created: 0, closed: 0, milestones: 0 })
  })

  it('dryRun reports the same counts but writes nothing', async () => {
    const { useCase, repo } = makeRebuild()
    await seedCanonicalState()

    const report = await useCase({ organizationId: ORG_A, dryRun: true })

    expect(report).toMatchObject({ created: 1, closed: 0, milestones: 1, dryRun: true })
    const items = await pool.query(
      `SELECT COUNT(*)::int AS n FROM inbox_items WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(items.rows[0].n).toBe(4) // nothing created
    expect(
      (await repo.findById(inboxItemId('4d000000-0000-0000-0000-000000000021'), ORG_A))
        ?.status,
    ).toBe('open') // nothing closed
    const facts = await pool.query(
      'SELECT id FROM outbox_events WHERE organization_id = $1',
      [ORG_A],
    )
    expect(facts.rows).toHaveLength(0)
  })
})
