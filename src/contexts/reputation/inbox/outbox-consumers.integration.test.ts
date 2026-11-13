// BQC-3.4 — durable inbox consumers apply projections via applyOnce:
// state change, outbox facts, and the receipt co-commit through the inbox
// command store. Duplicate deliveries record receipts without second facts;
// missing items/reviews are applied no-ops (rebuild heals).

import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import {
  describe,
  it,
  expect,
  vi,
  beforeAll,
  afterAll,
  afterEach,
  beforeEach,
} from 'vitest'
import {
  handleInboxReviewCreated,
  handleInboxReviewExpired,
  handleInboxReviewSourceTransitioned,
  handleInboxReviewUpdated,
  handleInboxReplyObserved,
  handleInboxReplyPublished,
  handleInboxReplySubmitted,
  type InboxConsumerDeps,
} from './outbox-consumers.server'
import {
  handleInboxGuestFeedbackRetracted,
  handleInboxGuestFeedbackSubmitted,
} from '#/contexts/inbox/infrastructure/guest-feedback-outbox-consumers'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '#/contexts/inbox/application/ports/review-lookup.port'
import type {
  ReviewSourceLookupPort,
  ReviewSourceMeta,
} from '#/contexts/inbox/application/ports/review-source-lookup.port'
import type { ApplyReceiptStatus } from '#/contexts/inbox/application/ports/inbox-command-store.port'
import type { ReplyObservationAuthorityPort } from '#/contexts/inbox/application/ports/reply-observation-authority.port'
import type { SourceTransitionAuthorityPort } from '#/contexts/inbox/application/ports/source-transition-authority.port'
import type {
  ReviewResponseTargetAuthorityPort,
  ReviewResponseTargetExpectation,
} from '#/contexts/inbox/application/ports/review-response-target-authority.port'
import { createAtomicInboxCommandStore } from '#/contexts/reputation/inbox/command-store.server'
import { createReviewHandlingCycleStore } from '#/contexts/inbox/infrastructure/review-handling-cycle.store'
import { createInboxRepository } from '#/contexts/reputation/inbox/inbox-repository.server'
import {
  dropInboxUseCaseTenant,
  seedInboxItem,
  seedInboxOrganization,
  seedReviewSource,
} from '#/contexts/inbox/infrastructure/inbox-database-fixtures'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/inbox/domain/types'
import type {
  FeedbackLookupPort,
  FeedbackSnippet,
} from '#/contexts/inbox/application/ports/feedback-lookup.port'
import { createMockLogger } from '#/shared/testing/mock-logger'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}))

const NOW = new Date('2026-06-15T12:00:00Z')
// Every id is random per run: the integration files share one database.
const ORG = organizationId(`org-outbox-consumers-${randomUUID()}`)
const PROP = propertyId(randomUUID())
const PROP2 = propertyId(randomUUID())
const REV = reviewId(randomUUID())
const FEEDBACK = feedbackId(randomUUID())
const INBOX = inboxItemId(randomUUID())
const EVENT_ID = randomUUID()

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: INBOX,
    organizationId: ORG,
    propertyId: PROP,
    sourceType: 'review',
    sourceId: REV,
    status: 'open',
    rating: null,
    sourceDate: new Date('2026-06-01'),
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

function makeEvent(eventType: string, payload: Record<string, unknown>): ConsumerEvent {
  const versionedPayload =
    eventType === 'review.created' || eventType === 'review.updated'
      ? { sourceEpoch: 1, sourceRevision: 1, ...payload }
      : payload
  return {
    eventId: EVENT_ID,
    eventType,
    eventVersion: 1,
    payload: versionedPayload,
    organizationId: ORG,
    propertyId: PROP,
    sourceContext: 'review',
    sourceAggregateId: REV,
  }
}

const AVAILABLE_SNIPPET: ReviewSnippetResult = {
  status: 'available',
  snippet: {
    text: 'Fresh text',
    translatedText: null,
    reviewerName: 'Jane',
    reviewerProfilePhotoUrl: null,
    googleReviewUrl: null,
    rating: 4,
    languageCode: 'en',
  },
}

const SOURCE_META: ReviewSourceMeta = {
  id: REV,
  propertyId: PROP,
  platform: 'google',
  sourceEpoch: 1,
  sourceDate: new Date('2026-06-10'),
  contentExpiresAt: null,
  materialReviewRevision: 1,
}

const AVAILABLE_FEEDBACK: FeedbackSnippet = {
  comment: 'Private feedback',
  ratingValue: 2,
}

type ReceiptRow = Readonly<{
  eventId: string
  consumerName: string
  status: ApplyReceiptStatus
}>

let pool: Pool

const seedOrganization = () => seedInboxOrganization(pool, ORG, [PROP, PROP2])

const seedItem = async (item: InboxItem): Promise<void> => {
  await seedInboxItem(pool, getDb(), item, () => NOW)
  await pool.query(
    'UPDATE inbox_handling_cycle_heads SET status = $2 WHERE inbox_item_id = $1',
    [item.id, item.status],
  )
  await pool.query(
    `UPDATE inbox_items
        SET first_reply_submitted_at = $2, first_reply_published_at = $3
      WHERE id = $1`,
    [item.id, item.firstReplySubmittedAt, item.firstReplyPublishedAt],
  )
}

const seedMaterialRevision = (revision: number) =>
  pool.query(
    `INSERT INTO material_review_revisions (
       review_id, revision, organization_id, property_id, source_epoch,
       normalization_version, source_digest, normalized_digest, rating,
       normalized_text, content_state, created_at, updated_at
     ) VALUES ($1, $2, $3, $4, 0, 'review-material-v1', repeat('b', 64),
       repeat('b', 64), 4, 'fixture', 'active', $5, $5)
     ON CONFLICT (review_id, revision) DO NOTHING`,
    [REV, revision, ORG, PROP, NOW],
  )

/** Moves the Handling Cycle head onto a later Material Review Revision. */
const advanceHeadRevision = async (item: InboxItem, revision: number): Promise<void> => {
  await seedMaterialRevision(revision)
  await pool.query(
    `UPDATE inbox_handling_cycle_heads
        SET current_material_review_revision = $2, current_source_revision = $2
      WHERE inbox_item_id = $1`,
    [item.id, revision],
  )
}

const silentLogger = createMockLogger()

const createDatabaseStores = () => {
  const db = getDb()
  return {
    repo: createInboxRepository(
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
      },
      { clock: () => NOW, logger: silentLogger },
    ),
    commandStore: createAtomicInboxCommandStore(
      db,
      async () => ({ allowed: true }),
      () => NOW,
    ),
  }
}

/** Facts the Inbox itself committed; the delivered source event is not one. */
const readInboxFacts = async (): Promise<
  ReadonlyArray<{ eventType: string; payload: Record<string, unknown> }>
> => {
  const { rows } = await pool.query<{
    event_type: string
    payload: Record<string, unknown>
  }>(
    `SELECT event_type, payload FROM outbox_events
      WHERE organization_id = $1 AND event_type LIKE 'inbox.%'
      ORDER BY created_at, id`,
    [ORG],
  )
  return rows.map((row) => ({ eventType: row.event_type, payload: row.payload }))
}

const readReceipts = async (): Promise<ReadonlyArray<ReceiptRow>> => {
  const { rows } = await pool.query<{
    event_id: string
    consumer_name: string
    status: ApplyReceiptStatus
  }>(
    `SELECT event_id, consumer_name, status FROM event_consumer_receipts
      WHERE event_id = $1 ORDER BY created_at, consumer_name`,
    [EVENT_ID],
  )
  return rows.map((row) => ({
    eventId: row.event_id,
    consumerName: row.consumer_name,
    status: row.status,
  }))
}

beforeAll(() => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  clearEventSchemas()
  registerAllEventSchemas()
})

afterEach(async () => {
  await dropInboxUseCaseTenant(pool, ORG, [PROP, PROP2])
})

afterAll(async () => {
  clearEventSchemas()
  await pool.end()
})

async function makeDeps(overrides: {
  item?: InboxItem | null
  snippetResult?: ReviewSnippetResult
  sourceMeta?: ReviewSourceMeta | null
  feedback?: FeedbackSnippet | null
  observationCurrent?: boolean
  sourceEpochCarryFromMaterialReviewRevision?: number | null
  providerReplyUpdatedAt?: Date | null
  sourceTransitionCurrent?: boolean
  responseTargetCurrent?: boolean
  handlingCycleMissing?: boolean
  handlingCycleMaterialReviewRevision?: number
}) {
  const item = overrides.item === undefined ? makeItem() : overrides.item
  await seedOrganization()
  await pool.query(
    `INSERT INTO outbox_events (id, event_type, payload, organization_id, property_id,
                                source_context, source_aggregate_id)
     VALUES ($1, 'test.consumer-source', '{}'::jsonb, $2, $3, 'review', $4)
     ON CONFLICT (id) DO NOTHING`,
    [EVENT_ID, ORG, PROP, REV],
  )
  if (item) await seedItem(item)
  else if (overrides.sourceMeta !== null) {
    await seedReviewSource(pool, {
      id: REV,
      organizationId: ORG,
      propertyId: PROP,
      sourceDate: SOURCE_META.sourceDate,
    })
  }
  // Later Material Review Revisions the Review side has already recorded.
  if (item === null ? overrides.sourceMeta !== null : item.sourceType === 'review') {
    await seedMaterialRevision(2)
  }
  if (item?.sourceType === 'review') {
    if (overrides.handlingCycleMissing === true) {
      await pool.query(
        'DELETE FROM inbox_handling_cycle_heads WHERE inbox_item_id = $1',
        [item.id],
      )
    } else if (overrides.handlingCycleMaterialReviewRevision !== undefined) {
      await advanceHeadRevision(item, overrides.handlingCycleMaterialReviewRevision)
    }
  }
  const stores = createDatabaseStores()
  const repo = stores.repo
  const commandStore = stores.commandStore
  const events = {
    facts: readInboxFacts,
    byTag: async (tag: string) =>
      (await readInboxFacts())
        .filter((fact) => fact.eventType === tag)
        .map((f) => f.payload),
  }
  const receipts = readReceipts
  const readItems = async (): Promise<InboxItem[]> => {
    const { rows } = await pool.query<{ id: string }>(
      'SELECT id FROM inbox_items WHERE organization_id = $1 ORDER BY created_at, id',
      [ORG],
    )
    const found = await Promise.all(
      rows.map((row) => repo.findById(inboxItemId(row.id), ORG)),
    )
    return found.filter((row): row is InboxItem => row !== null)
  }

  const reviewLookup = {
    getReviewSnippetById: vi.fn(async () =>
      overrides.snippetResult === undefined ? AVAILABLE_SNIPPET : overrides.snippetResult,
    ),
    getReviewSnippetsByIds: vi.fn(async () => new Map()),
    findEligibleReviewIds: vi.fn(async () => []),
  } satisfies ReviewLookupPort

  const reviewSourceLookup = {
    getReviewSourceMetaById: vi.fn(async () =>
      overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta,
    ),
    getReviewSourceMetaByIds: vi.fn(async () => {
      const source =
        overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta
      return source ? [source] : []
    }),
    listReviewSources: vi.fn(async () => []),
  } satisfies ReviewSourceLookupPort

  const feedbackLookup = {
    getFeedbackSnippetById: vi.fn(async () =>
      overrides.feedback === undefined ? AVAILABLE_FEEDBACK : overrides.feedback,
    ),
    getFeedbackSnippetsByIds: vi.fn(async () => new Map()),
    findEligibleFeedbackIds: vi.fn(async () => []),
  } satisfies FeedbackLookupPort

  const handlingCycleStore = createReviewHandlingCycleStore(getDb())

  const replyObservationAuthority = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (overrides.observationCurrent === false) {
        return { status: 'obsolete' as const }
      }
      return {
        status: 'current' as const,
        value: await apply({
          ...expectation,
          state: expectation.resolution === 'absent' ? 'absent' : 'live',
          observedAt: expectation.occurredAt,
          providerReplyUpdatedAt: overrides.providerReplyUpdatedAt ?? null,
          authority: 'review.current-google-reply-observation.v1',
          sourceEpochCarryFromMaterialReviewRevision:
            overrides.sourceEpochCarryFromMaterialReviewRevision ?? null,
          reviewSourceContentState: 'active',
          responseTargetEligibility: 'measured',
          responseTargetStartAt: SOURCE_META.sourceDate,
        }),
      }
    }),
  } satisfies ReplyObservationAuthorityPort

  const sourceTransitionAuthority = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (overrides.sourceTransitionCurrent === false) {
        return { status: 'obsolete' as const }
      }
      return {
        status: 'current' as const,
        value: await apply({
          ...expectation,
          authority: 'review.current-source-transition.v1',
        }),
      }
    }),
  } satisfies SourceTransitionAuthorityPort

  const responseTargetAuthority = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (overrides.responseTargetCurrent === false) {
        return { status: 'obsolete' as const }
      }
      const meta = overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta
      return {
        status: 'current' as const,
        value: await apply({
          ...expectation,
          authority: 'review.current-response-target.v1',
          materialReviewRevision: meta?.materialReviewRevision ?? 1,
          eligibility: 'measured',
          responseTargetStartAt: meta?.sourceDate ?? NOW,
        }),
      }
    }),
    withExactCurrentBatch: vi.fn(async (expectations, apply) => {
      if (overrides.responseTargetCurrent === false) {
        return { status: 'obsolete' as const }
      }
      const meta = overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta
      return {
        status: 'current' as const,
        value: await apply(
          expectations.map((expectation: ReviewResponseTargetExpectation) => ({
            ...expectation,
            authority: 'review.current-response-target.v1' as const,
            materialReviewRevision: meta?.materialReviewRevision ?? 1,
            eligibility: 'measured' as const,
            responseTargetStartAt: meta?.sourceDate ?? NOW,
          })),
        ),
      }
    }),
    withInboxProjection: vi.fn(async (expectation, apply) => {
      if (
        overrides.responseTargetCurrent === false ||
        overrides.sourceMeta === null ||
        overrides.snippetResult?.status === 'not_found'
      ) {
        return { status: 'obsolete' as const }
      }
      const meta = overrides.sourceMeta ?? SOURCE_META
      const revisionCount = meta.materialReviewRevision ?? 1
      return {
        status: 'current' as const,
        value: await apply({
          authority: 'review.current-inbox-projection.v1',
          organizationId: expectation.organizationId,
          propertyId: expectation.propertyId,
          reviewId: expectation.reviewId,
          sourceEpoch: expectation.sourceEpoch,
          platform: 'google',
          sourceDate: meta.sourceDate,
          sourceContentState: 'active',
          sourceContentErasedAt: null,
          currentMaterialReviewRevision: revisionCount,
          revisions: Array.from({ length: revisionCount }, (_, index) => ({
            authority: 'review.inbox-projection-revision.v1' as const,
            organizationId: expectation.organizationId,
            propertyId: expectation.propertyId,
            reviewId: expectation.reviewId,
            sourceEpoch: expectation.sourceEpoch,
            materialReviewRevision: index + 1,
            eligibility: 'measured' as const,
            responseTargetStartAt: meta.sourceDate,
            observedAt: new Date(NOW.getTime() + index),
            sourceEpochCarry: false,
          })) as [
            {
              authority: 'review.inbox-projection-revision.v1'
              organizationId: string
              propertyId: string
              reviewId: string
              sourceEpoch: number
              materialReviewRevision: number
              eligibility: 'measured'
              responseTargetStartAt: Date
              observedAt: Date
              sourceEpochCarry: boolean
            },
          ],
        }),
      }
    }),
  } satisfies ReviewResponseTargetAuthorityPort

  const deps: InboxConsumerDeps = {
    commandStore,
    handlingCycleStore,
    replyObservationAuthority,
    responseTargetAuthority,
    sourceTransitionAuthority,
    reviewLookup,
    reviewSourceLookup,
    inboxRepo: repo,
    idGen: () => INBOX,
    clock: () => NOW,
    logger: createMockLogger(),
  }
  const guestDeps = {
    commandStore,
    feedbackLookup,
    inboxRepo: repo,
    idGen: () => INBOX,
    clock: () => NOW,
  }
  return {
    deps,
    guestDeps,
    repo: { items: readItems },
    seedItem,
    events,
    receipts,
    handlingCycleStore,
    replyObservationAuthority,
    sourceTransitionAuthority,
  }
}

describe('handleInboxGuestFeedbackSubmitted (durable private feedback)', () => {
  it('creates a metadata-only feedback item and co-commits its receipt', async () => {
    const { guestDeps, repo, events, receipts } = await makeDeps({ item: null })

    const result = await handleInboxGuestFeedbackSubmitted(
      guestDeps,
      makeEvent('guest.feedback.submitted', {
        feedbackId: FEEDBACK,
        ratingId: 'rating-1',
        organizationId: ORG,
        propertyId: PROP,
        portalId: 'portal-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(guestDeps.feedbackLookup.getFeedbackSnippetById).toHaveBeenCalledWith(
      FEEDBACK,
      ORG,
    )
    expect(await repo.items()).toHaveLength(1)
    expect((await repo.items())[0]).toMatchObject({
      sourceType: 'feedback',
      sourceId: FEEDBACK,
      propertyId: PROP,
      sourceDate: NOW,
      platform: null,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(await events.byTag('inbox.inbox_item.created')).toHaveLength(1)
    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-guest-feedback-submitted',
        status: 'applied',
      },
    ])
  })

  it('records an obsolete receipt when feedback was withdrawn before delivery', async () => {
    const { guestDeps, repo, receipts } = await makeDeps({ item: null, feedback: null })

    const result = await handleInboxGuestFeedbackSubmitted(
      guestDeps,
      makeEvent('guest.feedback.submitted', {
        feedbackId: FEEDBACK,
        ratingId: null,
        organizationId: ORG,
        propertyId: PROP,
        portalId: 'portal-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(await repo.items()).toHaveLength(0)
    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-guest-feedback-submitted',
        status: 'obsolete',
      },
    ])
  })

  it('does not create work when retention already removed the private text', async () => {
    const { guestDeps, repo, receipts } = await makeDeps({
      item: null,
      feedback: { comment: null, ratingValue: 2 },
    })

    await expect(
      handleInboxGuestFeedbackSubmitted(
        guestDeps,
        makeEvent('guest.feedback.submitted', {
          feedbackId: FEEDBACK,
          ratingId: 'rating-1',
          organizationId: ORG,
          propertyId: PROP,
          portalId: 'portal-1',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).resolves.toEqual({ status: 'obsolete' })
    expect(await repo.items()).toHaveLength(0)
    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-guest-feedback-submitted',
        status: 'obsolete',
      },
    ])
  })

  it('rejects cross-tenant envelope attribution before reading feedback', async () => {
    const { guestDeps } = await makeDeps({ item: null })
    const event = makeEvent('guest.feedback.submitted', {
      feedbackId: FEEDBACK,
      ratingId: null,
      organizationId: 'other-org',
      propertyId: PROP,
      portalId: 'portal-1',
      occurredAt: NOW.toISOString(),
    })

    await expect(handleInboxGuestFeedbackSubmitted(guestDeps, event)).rejects.toThrow(
      'attribution',
    )
    expect(guestDeps.feedbackLookup.getFeedbackSnippetById).not.toHaveBeenCalled()
  })
})

describe('handleInboxGuestFeedbackRetracted (durable private feedback)', () => {
  it('closes an open feedback item and co-commits the status fact and receipt', async () => {
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: FEEDBACK,
      platform: null,
    })
    const { guestDeps, repo, events, receipts } = await makeDeps({ item })

    const result = await handleInboxGuestFeedbackRetracted(
      guestDeps,
      makeEvent('guest.feedback.retracted', {
        feedbackId: FEEDBACK,
        organizationId: ORG,
        propertyId: PROP,
        portalId: 'portal-1',
        supersedesSourceEventId: 'source-event-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]).toMatchObject({ status: 'closed', closedAt: NOW })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toMatchObject([
      { oldStatus: 'open', newStatus: 'closed' },
    ])
    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-guest-feedback-retracted',
        status: 'applied',
      },
    ])
  })

  it('records an applied no-op when the item was never projected', async () => {
    const { guestDeps, receipts } = await makeDeps({ item: null })

    await expect(
      handleInboxGuestFeedbackRetracted(
        guestDeps,
        makeEvent('guest.feedback.retracted', {
          feedbackId: FEEDBACK,
          organizationId: ORG,
          propertyId: PROP,
          portalId: 'portal-1',
          supersedesSourceEventId: 'source-event-1',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).resolves.toEqual({ status: 'applied' })
    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-guest-feedback-retracted',
        status: 'applied',
      },
    ])
  })

  it('lets the cycle store decide closure when the compatibility row is already closed', async () => {
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: FEEDBACK,
      platform: null,
      status: 'closed',
      closedAt: new Date('2026-06-14T12:00:00Z'),
    })
    const { guestDeps, repo } = await makeDeps({ item })
    const [stored] = await repo.items()
    const apply = vi
      .spyOn(guestDeps.commandStore, 'applySourceWithdrawnOnce')
      .mockResolvedValue('applied')

    await handleInboxGuestFeedbackRetracted(
      guestDeps,
      makeEvent('guest.feedback.retracted', {
        feedbackId: FEEDBACK,
        organizationId: ORG,
        propertyId: PROP,
        portalId: 'portal-1',
        supersedesSourceEventId: 'source-event-1',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        item: stored,
        fact: expect.objectContaining({ oldStatus: 'open', newStatus: 'closed' }),
      }),
    )
  })

  it('fails closed when the projected item belongs to a different Property', async () => {
    const item = makeItem({
      sourceType: 'feedback',
      sourceId: FEEDBACK,
      propertyId: PROP2,
      platform: null,
    })
    const { guestDeps, receipts } = await makeDeps({ item })

    await expect(
      handleInboxGuestFeedbackRetracted(
        guestDeps,
        makeEvent('guest.feedback.retracted', {
          feedbackId: FEEDBACK,
          organizationId: ORG,
          propertyId: PROP,
          portalId: 'portal-1',
          supersedesSourceEventId: 'source-event-1',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).rejects.toThrow('scope does not match')
    expect(await receipts()).toEqual([])
  })
})

describe('handleInboxReviewCreated (BQC-3.4 applyOnce)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks obsolete when the review does not exist', async () => {
    const { deps, receipts } = await makeDeps({ snippetResult: { status: 'not_found' } })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-review-created', status: 'obsolete' },
    ])
  })

  it('creates a metadata-only item + created fact + applied receipt in one apply', async () => {
    const { deps, repo, events, receipts } = await makeDeps({
      item: null,
      snippetResult: AVAILABLE_SNIPPET,
    })
    const apply = vi.spyOn(deps.commandStore, 'applyReviewProjectionOnce')
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
        occurredAt: NOW.toISOString(),
        platform: 'google',
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(deps.reviewLookup.getReviewSnippetById).not.toHaveBeenCalled()
    // BQC-1.2: metadata only — no rating/snippet/reviewerName copied.
    expect(await repo.items()).toHaveLength(1)
    expect((await repo.items())[0]!.sourceDate).toEqual(SOURCE_META.sourceDate)
    expect((await repo.items())[0]!.platform).toBe('google')
    expect((await repo.items())[0]!.rating).toBeNull()
    expect((await repo.items())[0]!.snippet).toBeNull()
    expect(await events.byTag('inbox.inbox_item.created')).toHaveLength(1)
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 'created',
        projection: expect.objectContaining({
          authority: 'review.current-inbox-projection.v1',
          currentMaterialReviewRevision: 1,
          revisions: [
            expect.objectContaining({
              authority: 'review.inbox-projection-revision.v1',
              materialReviewRevision: 1,
              eligibility: 'measured',
              responseTargetStartAt: SOURCE_META.sourceDate,
            }),
          ],
        }),
      }),
    )
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-review-created', status: 'applied' },
    ])
  })

  it('still creates a metadata-only item when content is expired', async () => {
    const { deps, repo } = await makeDeps({
      item: null,
      snippetResult: { status: 'expired' },
    })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(await repo.items()).toHaveLength(1)
  })

  it('duplicate delivery: duplicate receipt, no second item, no second fact', async () => {
    const { deps, repo, events, receipts } = await makeDeps({ item: makeItem() })
    const result = await handleInboxReviewCreated(
      deps,
      makeEvent('review.created', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'duplicate' })
    expect(await repo.items()).toHaveLength(1)
    expect(await events.byTag('inbox.inbox_item.created')).toHaveLength(0)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-review-created', status: 'duplicate' },
    ])
  })
})

describe('handleInboxReviewExpired (BQC-3.4 applyOnce)', () => {
  it('the database refuses provider text on a review item, so none can be restored', async () => {
    await makeDeps({})

    await expect(
      pool.query(
        `UPDATE inbox_items SET rating = 2, snippet = 'restored provider review text',
                reviewer_name = 'Restored guest' WHERE id = $1`,
        [INBOX],
      ),
    ).rejects.toMatchObject({ constraint: 'inbox_items_review_source_content_free' })
  })

  it('scrubs legacy content but never stale-closes current work', async () => {
    const { deps, repo, events, receipts } = await makeDeps({
      item: makeItem(),
    })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]).toMatchObject({
      status: 'open',
      closedAt: null,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-review-expired', status: 'applied' },
    ])
  })

  it('already closed: scrubs restored legacy content without a false status fact', async () => {
    const { deps, repo, events, receipts } = await makeDeps({
      item: makeItem({ status: 'closed' }),
    })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]).toMatchObject({
      id: INBOX,
      status: 'closed',
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-review-expired', status: 'applied' },
    ])
  })

  it('applies when no inbox item exists', async () => {
    const { deps, receipts } = await makeDeps({ item: null })
    const result = await handleInboxReviewExpired(
      deps,
      makeEvent('review.expired', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(await receipts()).toHaveLength(1)
  })
})

describe('handleInboxReviewSourceTransitioned (REV-01 content-free handoff)', () => {
  it('preserves the Inbox identity while closing and scrubbing a legacy Review projection', async () => {
    const { deps, repo, events, receipts, sourceTransitionAuthority } = await makeDeps({
      item: makeItem(),
    })

    const result = await handleInboxReviewSourceTransitioned(
      deps,
      makeEvent('review.source_transitioned', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
        sourceEpoch: 1,
        sourceRevision: 2,
        analysisSequence: 2,
        change: 'source_expired',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(sourceTransitionAuthority.withExactCurrent).toHaveBeenCalledWith(
      {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
        sourceEpoch: 1,
        sourceRevision: 2,
        analysisSequence: 2,
        change: 'source_expired',
        occurredAt: NOW,
      },
      expect.any(Function),
    )
    expect(await repo.items()).toHaveLength(1)
    expect((await repo.items())[0]).toMatchObject({
      id: INBOX,
      sourceId: REV,
      status: 'closed',
      closedAt: NOW,
      rating: null,
      snippet: null,
      reviewerName: null,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(1)
    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-review-source-transitioned',
        status: 'applied',
      },
    ])
  })

  it('receipts a stale transition as obsolete without changing a re-observed Inbox item', async () => {
    const { deps, repo, events, receipts } = await makeDeps({
      sourceTransitionCurrent: false,
      item: makeItem({
        rating: null,
        snippet: null,
        reviewerName: null,
      }),
    })

    const result = await handleInboxReviewSourceTransitioned(
      deps,
      makeEvent('review.source_transitioned', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
        sourceEpoch: 1,
        sourceRevision: 2,
        analysisSequence: 2,
        change: 'source_expired',
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect((await repo.items())[0]).toMatchObject({
      id: INBOX,
      status: 'open',
      closedAt: null,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-review-source-transitioned',
        status: 'obsolete',
      },
    ])
  })

  it('stays retryable when it overtakes creation of the stable Inbox identity', async () => {
    const { deps, receipts } = await makeDeps({ item: null })

    await expect(
      handleInboxReviewSourceTransitioned(
        deps,
        makeEvent('review.source_transitioned', {
          reviewId: REV,
          organizationId: ORG,
          propertyId: PROP,
          sourceEpoch: 1,
          sourceRevision: 2,
          analysisSequence: 2,
          change: 'provider_deleted',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(await receipts()).toEqual([])
  })

  it('marks obsolete when both the Inbox item and stable Review identity are gone', async () => {
    const { deps, receipts } = await makeDeps({
      item: null,
      sourceTransitionCurrent: false,
    })

    await expect(
      handleInboxReviewSourceTransitioned(
        deps,
        makeEvent('review.source_transitioned', {
          reviewId: REV,
          organizationId: ORG,
          propertyId: PROP,
          sourceEpoch: 1,
          sourceRevision: 2,
          analysisSequence: 2,
          change: 'provider_deleted',
          occurredAt: NOW.toISOString(),
        }),
      ),
    ).resolves.toEqual({ status: 'obsolete' })

    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-review-source-transitioned',
        status: 'obsolete',
      },
    ])
  })

  it('rejects cross-Property envelope attribution before any Inbox mutation', async () => {
    const { deps, repo, receipts } = await makeDeps({
      item: makeItem(),
    })
    const event = makeEvent('review.source_transitioned', {
      reviewId: REV,
      organizationId: ORG,
      propertyId: 'different-property',
      sourceEpoch: 1,
      sourceRevision: 2,
      analysisSequence: 2,
      change: 'source_expired',
      occurredAt: NOW.toISOString(),
    })

    await expect(handleInboxReviewSourceTransitioned(deps, event)).rejects.toThrow(
      'envelope attribution',
    )
    expect((await repo.items())[0]).toMatchObject({
      status: 'open',
      closedAt: null,
      commandRevision: 1,
    })
    expect(await receipts()).toEqual([])
  })
})

describe('handleInboxReviewUpdated (BQC-3.4 — BQC-3.1 orphan resolved)', () => {
  it('delegates a Material Review Revision advance to the atomic command', async () => {
    const { deps } = await makeDeps({
      sourceMeta: { ...SOURCE_META, materialReviewRevision: 2 },
    })
    const apply = vi.spyOn(deps.commandStore, 'applyReviewProjectionOnce')
    const event = makeEvent('review.updated', {
      reviewId: REV,
      organizationId: ORG,
      propertyId: PROP,
      sourceRevision: 2,
    })

    await handleInboxReviewUpdated(deps, event)

    expect(apply).toHaveBeenCalledTimes(1)
    expect(apply).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: EVENT_ID,
        consumerName: 'inbox.on-review-updated',
        eventKind: 'updated',
        item: expect.objectContaining({ id: INBOX, sourceId: REV }),
        projection: expect.objectContaining({
          currentMaterialReviewRevision: 2,
          revisions: [
            expect.objectContaining({ materialReviewRevision: 1 }),
            expect.objectContaining({ materialReviewRevision: 2 }),
          ],
        }),
        now: NOW,
      }),
    )
  })

  it('refreshes sourceDate/platform metadata and records the receipt', async () => {
    const { deps, repo, receipts } = await makeDeps({})
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]!.sourceDate).toEqual(SOURCE_META.sourceDate)
    expect((await repo.items())[0]!.platform).toBe('google')
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-review-updated', status: 'applied' },
    ])
  })

  it('missing item: bootstraps the stable item and records the update receipt', async () => {
    const { deps, repo, receipts, events } = await makeDeps({ item: null })
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(await repo.items()).toHaveLength(1)
    expect((await repo.items())[0]).toMatchObject({ sourceType: 'review', sourceId: REV })
    expect(await events.byTag('inbox.inbox_item.created')).toHaveLength(1)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-review-updated', status: 'applied' },
    ])
  })

  it('missing Review authority: records an obsolete receipt', async () => {
    const { deps, repo, receipts } = await makeDeps({ sourceMeta: null })
    const result = await handleInboxReviewUpdated(
      deps,
      makeEvent('review.updated', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect((await repo.items())[0]!.sourceDate).toEqual(new Date('2026-06-01'))
    expect(await receipts()).toEqual([
      {
        eventId: EVENT_ID,
        consumerName: 'inbox.on-review-updated',
        status: 'obsolete',
      },
    ])
  })
})

describe('handleInboxReplySubmitted (first-reply milestone)', () => {
  const submitted = (occurredAt: string = '2026-06-15T13:00:00.000Z') => ({
    ...makeEvent('review.reply.submitted', {
      reviewId: REV,
      organizationId: ORG,
      propertyId: PROP,
    }),
    occurredAt,
  })

  it('stamps firstReplySubmittedAt from the envelope time without touching status', async () => {
    const { deps, repo, events, receipts } = await makeDeps({})

    const result = await handleInboxReplySubmitted(deps, submitted())

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]!.firstReplySubmittedAt).toEqual(
      new Date('2026-06-15T13:00:00.000Z'),
    )
    expect((await repo.items())[0]!.status).toBe('open')
    expect(await events.facts()).toHaveLength(0)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-submitted', status: 'applied' },
    ])
  })

  it('never overwrites an existing milestone on redelivery or a later reply', async () => {
    const first = new Date('2026-06-15T13:00:00.000Z')
    const { deps, repo, receipts } = await makeDeps({
      item: makeItem({ firstReplySubmittedAt: first }),
    })

    await handleInboxReplySubmitted(deps, submitted('2026-06-16T09:00:00.000Z'))

    expect((await repo.items())[0]!.firstReplySubmittedAt).toEqual(first)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-submitted', status: 'applied' },
    ])
  })

  it('keeps the earliest time when two submissions are consumed newest first', async () => {
    const { deps, repo } = await makeDeps({})

    await handleInboxReplySubmitted(deps, submitted('2026-06-16T09:00:00.000Z'))
    await handleInboxReplySubmitted(deps, submitted('2026-06-15T13:00:00.000Z'))

    expect((await repo.items())[0]!.firstReplySubmittedAt).toEqual(
      new Date('2026-06-15T13:00:00.000Z'),
    )
  })

  it('leaves the time and commandRevision alone for a duplicate or later event', async () => {
    const { deps, repo } = await makeDeps({})
    await handleInboxReplySubmitted(deps, submitted('2026-06-15T13:00:00.000Z'))
    const before = (await repo.items())[0]!

    await handleInboxReplySubmitted(deps, submitted('2026-06-15T13:00:00.000Z'))
    await handleInboxReplySubmitted(deps, submitted('2026-06-16T09:00:00.000Z'))

    const after = (await repo.items())[0]!
    expect(after.firstReplySubmittedAt).toEqual(before.firstReplySubmittedAt)
    expect(after.commandRevision).toBe(before.commandRevision)
    expect(after.updatedAt).toEqual(before.updatedAt)
  })

  it('does not move the time later when the repository is asked directly', async () => {
    const first = new Date('2026-06-15T13:00:00.000Z')
    const { deps, repo } = await makeDeps({
      item: makeItem({ firstReplySubmittedAt: first }),
    })
    const before = (await repo.items())[0]!

    const result = await deps.inboxRepo.stampReplyMilestones(
      before.id,
      before.organizationId,
      { firstReplySubmittedAt: new Date('2026-06-17T00:00:00.000Z') },
    )

    expect(result).toBeNull()
    expect((await repo.items())[0]!.commandRevision).toBe(before.commandRevision)
  })

  it('records an applied receipt when no inbox item exists for the review', async () => {
    const { deps, receipts } = await makeDeps({ item: null })

    await expect(handleInboxReplySubmitted(deps, submitted())).resolves.toEqual({
      status: 'applied',
    })
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-submitted', status: 'applied' },
    ])
  })
})

describe('handleInboxReplyPublished (compatibility receipt only)', () => {
  it('does not let an internal workflow fact close the Inbox item', async () => {
    const { deps, repo, events, receipts } = await makeDeps({})
    const result = await handleInboxReplyPublished(
      deps,
      makeEvent('review.reply.published', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
        occurredAt: NOW.toISOString(),
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]!.status).toBe('open')
    expect((await repo.items())[0]!.closedAt).toBeNull()
    expect((await repo.items())[0]!.firstReplyPublishedAt).toBeNull()
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-published', status: 'applied' },
    ])
  })

  it('does not backfill a milestone without current provider observation', async () => {
    const { deps, repo, events, receipts } = await makeDeps({
      item: makeItem({ status: 'closed', closedAt: NOW }),
    })
    const result = await handleInboxReplyPublished(
      deps,
      makeEvent('review.reply.published', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]!.firstReplyPublishedAt).toBeNull()
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(await receipts()).toHaveLength(1)
  })

  it('already closed and stamped: receipt only', async () => {
    const stamped = new Date('2026-06-12')
    const { deps, repo, events, receipts } = await makeDeps({
      item: makeItem({
        status: 'closed',
        closedAt: stamped,
        firstReplyPublishedAt: stamped,
      }),
    })
    const result = await handleInboxReplyPublished(
      deps,
      makeEvent('review.reply.published', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]!.firstReplyPublishedAt).toEqual(stamped)
    expect(await events.facts()).toHaveLength(0)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-published', status: 'applied' },
    ])
  })

  it('missing item: applied no-op with a receipt', async () => {
    const { deps, receipts } = await makeDeps({ item: null })
    const result = await handleInboxReplyPublished(
      deps,
      makeEvent('review.reply.published', {
        reviewId: REV,
        organizationId: ORG,
        propertyId: PROP,
      }),
    )

    expect(result).toEqual({ status: 'applied' })
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-published', status: 'applied' },
    ])
  })
})

describe('handleInboxReplyObserved (provider-observation authority)', () => {
  const observationPayload = (overrides: Record<string, unknown> = {}) => ({
    reviewId: REV,
    organizationId: ORG,
    propertyId: PROP,
    observationRevision: 1,
    sourceEpoch: 0,
    materialReviewRevision: 1,
    change: 'added',
    resolution: 'confirmed_on_google',
    provenance: 'repkey_confirmed',
    matchedReplyId: 'reply-1',
    matchedPublicationCycle: 1,
    occurredAt: NOW.toISOString(),
    ...overrides,
  })

  it('closes and stamps once from an exact observed confirmation', async () => {
    const { deps, repo, events, receipts } = await makeDeps({})

    const result = await handleInboxReplyObserved(
      deps,
      makeEvent('review.reply.observed', observationPayload()),
    )

    expect(result).toEqual({ status: 'applied' })
    expect((await repo.items())[0]).toMatchObject({
      status: 'closed',
      closedAt: NOW,
      firstReplyPublishedAt: NOW,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(1)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-observed', status: 'applied' },
    ])
  })

  it('stamps the first reply at the time Google gave, and closes at the time RepKey saw it', async () => {
    const repliedAt = new Date(NOW.getTime() - 3 * 60 * 60_000)
    const { deps, repo } = await makeDeps({ providerReplyUpdatedAt: repliedAt })

    await handleInboxReplyObserved(
      deps,
      makeEvent('review.reply.observed', observationPayload()),
    )

    expect((await repo.items())[0]).toMatchObject({
      status: 'closed',
      closedAt: NOW,
      firstReplyPublishedAt: repliedAt,
    })
  })

  it('closes and receipts an unchanged external-live head for a newer attempt', async () => {
    const { deps, repo, receipts } = await makeDeps({})

    await handleInboxReplyObserved(
      deps,
      makeEvent(
        'review.reply.observed',
        observationPayload({
          change: 'unchanged',
          resolution: 'external_current_live',
          provenance: 'external_or_unknown',
          matchedReplyId: null,
          matchedPublicationCycle: null,
        }),
      ),
    )

    expect((await repo.items())[0]!.status).toBe('closed')
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-observed', status: 'applied' },
    ])
  })

  it('records an obsolete observation even when no Inbox item exists', async () => {
    const { deps, repo, receipts, replyObservationAuthority } = await makeDeps({
      item: null,
      observationCurrent: false,
    })

    const result = await handleInboxReplyObserved(
      deps,
      makeEvent('review.reply.observed', observationPayload()),
    )

    expect(result).toEqual({ status: 'obsolete' })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    expect(await repo.items()).toEqual([])
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-observed', status: 'obsolete' },
    ])
  })

  it('refuses a genuinely stale material projection without a receipt', async () => {
    const { deps, repo, receipts } = await makeDeps({})

    await expect(
      handleInboxReplyObserved(
        deps,
        makeEvent(
          'review.reply.observed',
          observationPayload({ materialReviewRevision: 2 }),
        ),
      ),
    ).rejects.toMatchObject({
      code: 'revision_conflict',
      message: 'Current reply observation is waiting for the Inbox material revision',
    })
    expect((await repo.items())[0]!.status).toBe('open')
    expect(await receipts()).toEqual([])
  })
  it('applies an epoch carry without reopening a closed item', async () => {
    const closedAt = new Date('2026-06-12T12:00:00Z')
    const { deps, repo, events, receipts } = await makeDeps({
      item: makeItem({ status: 'closed', closedAt }),
      sourceEpochCarryFromMaterialReviewRevision: 1,
    })

    await expect(
      handleInboxReplyObserved(
        deps,
        makeEvent(
          'review.reply.observed',
          observationPayload({
            sourceEpoch: 1,
            materialReviewRevision: 2,
            resolution: 'external_current_live',
            provenance: 'external_or_unknown',
            matchedReplyId: null,
            matchedPublicationCycle: null,
          }),
        ),
      ),
    ).resolves.toEqual({ status: 'applied' })
    expect((await repo.items())[0]).toMatchObject({ status: 'closed', closedAt })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-observed', status: 'applied' },
    ])
  })

  it('receipts an observation as obsolete when the Inbox Handling Cycle is newer', async () => {
    const { deps, repo, receipts } = await makeDeps({
      handlingCycleMaterialReviewRevision: 2,
    })

    await expect(
      handleInboxReplyObserved(
        deps,
        makeEvent('review.reply.observed', observationPayload()),
      ),
    ).resolves.toEqual({ status: 'obsolete' })
    expect((await repo.items())[0]!.status).toBe('open')
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-observed', status: 'obsolete' },
    ])
  })

  it('reopens a closed item after an observed provider deletion', async () => {
    const first = new Date('2026-06-12T12:00:00Z')
    const { deps, repo, events } = await makeDeps({
      item: makeItem({
        status: 'closed',
        closedAt: first,
        firstReplyPublishedAt: first,
      }),
    })

    await handleInboxReplyObserved(
      deps,
      makeEvent(
        'review.reply.observed',
        observationPayload({
          observationRevision: 2,
          matchedReplyId: null,
          matchedPublicationCycle: null,
          change: 'deleted',
          resolution: 'absent',
          provenance: 'none',
        }),
      ),
    )

    expect((await repo.items())[0]).toMatchObject({
      status: 'open',
      closedAt: null,
      firstReplyPublishedAt: first,
    })
    expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(1)
  })

  it.each([
    ['external edit', 'external_current_live'],
    ['legacy divergence', 'diverged'],
  ] as const)(
    'does not reopen closed work for a live %s observation',
    async (_name, resolution) => {
      const first = new Date('2026-06-12T12:00:00Z')
      const { deps, repo, events } = await makeDeps({
        item: makeItem({
          status: 'closed',
          closedAt: first,
          firstReplyPublishedAt: first,
        }),
      })

      await handleInboxReplyObserved(
        deps,
        makeEvent(
          'review.reply.observed',
          observationPayload({
            observationRevision: 2,
            change: 'edited',
            resolution,
            provenance: 'external_or_unknown',
            matchedReplyId: null,
            matchedPublicationCycle: null,
          }),
        ),
      )

      expect((await repo.items())[0]).toMatchObject({
        status: 'closed',
        closedAt: first,
        firstReplyPublishedAt: first,
      })
      expect(await events.byTag('inbox.inbox_item.status_changed')).toHaveLength(0)
    },
  )

  it('retries a current observation that arrives before its Inbox item', async () => {
    const { deps, repo, receipts, replyObservationAuthority, seedItem } = await makeDeps({
      item: null,
    })
    const event = makeEvent('review.reply.observed', observationPayload())

    await expect(handleInboxReplyObserved(deps, event)).rejects.toMatchObject({
      code: 'not_found',
    })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    expect(await receipts()).toEqual([])

    await seedItem(makeItem())
    await expect(handleInboxReplyObserved(deps, event)).resolves.toEqual({
      status: 'applied',
    })
    expect((await repo.items())[0]).toMatchObject({
      status: 'closed',
      firstReplyPublishedAt: NOW,
    })
    expect(await receipts()).toEqual([
      { eventId: EVENT_ID, consumerName: 'inbox.on-reply-observed', status: 'applied' },
    ])
  })

  it('retries without a receipt while the Inbox Handling Cycle is missing', async () => {
    const { deps, receipts, replyObservationAuthority } = await makeDeps({
      handlingCycleMissing: true,
    })

    await expect(
      handleInboxReplyObserved(
        deps,
        makeEvent('review.reply.observed', observationPayload()),
      ),
    ).rejects.toMatchObject({ code: 'not_found' })
    expect(replyObservationAuthority.withExactCurrent).toHaveBeenCalledOnce()
    expect(await receipts()).toEqual([])
  })
})
