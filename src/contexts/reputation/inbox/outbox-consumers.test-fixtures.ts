// Shared harness for the Inbox outbox consumer integration suites: random
// per-run ids, event and item builders, and makeDeps, which seeds the database
// and builds the consumer dependencies over three separate authority fakes.

import { randomUUID as freshUuid } from 'node:crypto'
import { Pool } from 'pg'
import { vi, expect, beforeAll, afterAll, afterEach } from 'vitest'
import type { InboxConsumerDeps } from './outbox-consumers.server'
import type { ConsumerEvent } from '#/shared/outbox/consumer-registry'
import { getDb } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import type {
  ReviewLookupPort,
  ReviewSnippetResult,
} from '#/contexts/reputation/inbox/review-lookup.port.server'
import type {
  ReviewSourceLookupPort,
  ReviewSourceMeta,
} from '#/contexts/reputation/inbox/review-source-lookup.port.server'
import type { ApplyReceiptStatus } from '#/contexts/reputation/inbox/command-store.port.server'
import type { ReviewReplyObservationAuthority } from '#/contexts/reputation/reviews/reply-observation-authority.port.server'
import type { ReviewSourceTransitionAuthority } from '#/contexts/reputation/reviews/source-transition-authority.port.server'
import type {
  ReviewResponseTargetAuthority,
  ReviewResponseTargetExpectation,
} from '#/contexts/reputation/reviews/response-target-authority.port.server'
import { noLentReviewTransaction } from '#/contexts/reputation/reviews/open-transaction.test-fixtures'
import { createReviewHandlingCycleStore } from '#/contexts/reputation/inbox/review-handling-cycle-store.server'
import {
  createInboxDatabaseStores,
  dropInboxOrganization,
  readOutboxFacts,
  seedInboxItem,
  seedInboxOrganization,
  seedReviewSource,
} from '#/contexts/reputation/inbox/inbox-database.test-fixtures'
import {
  feedbackId,
  inboxItemId,
  organizationId,
  propertyId,
  reviewId,
} from '#/shared/domain/ids'
import type { InboxItem } from '#/contexts/reputation/domain/inbox-types'
import type {
  FeedbackLookupPort,
  FeedbackSnippet,
} from '#/contexts/reputation/inbox/feedback-lookup.port.server'
import { createMockLogger } from '#/shared/testing/mock-logger'

export const NOW = new Date('2026-06-15T12:00:00Z')
// Every id is random per run: the integration files share one database.
export const ORG = organizationId(`org-outbox-consumers-${freshUuid()}`)
export const PROP = propertyId(freshUuid())
export const PROP2 = propertyId(freshUuid())
export const REV = reviewId(freshUuid())
export const FEEDBACK = feedbackId(freshUuid())
export const INBOX = inboxItemId(freshUuid())
export const EVENT_ID = freshUuid()

export function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
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

/** A private-feedback item for the run's feedback id. */
export const makeFeedbackItem = (overrides: Partial<InboxItem> = {}): InboxItem =>
  makeItem({ sourceType: 'feedback', sourceId: FEEDBACK, platform: null, ...overrides })

export function makeEvent(
  eventType: string,
  payload: Record<string, unknown>,
): ConsumerEvent {
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

/** A Review event for the run's review, organization and Property. */
export const reviewEvent = (eventType: string, extra: Record<string, unknown> = {}) =>
  makeEvent(eventType, { reviewId: REV, organizationId: ORG, propertyId: PROP, ...extra })

/** A guest feedback event for the run's feedback, organization and Property. */
export const guestFeedbackEvent = (
  eventType: string,
  extra: Record<string, unknown> = {},
) =>
  makeEvent(eventType, {
    feedbackId: FEEDBACK,
    organizationId: ORG,
    propertyId: PROP,
    portalId: 'portal-1',
    ...extra,
  })

export const AVAILABLE_SNIPPET: ReviewSnippetResult = {
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

export const SOURCE_META: ReviewSourceMeta = {
  id: REV,
  propertyId: PROP,
  platform: 'google',
  sourceEpoch: 1,
  sourceDate: new Date('2026-06-10'),
  contentExpiresAt: null,
  materialReviewRevision: 1,
}

export const AVAILABLE_FEEDBACK: FeedbackSnippet = {
  comment: 'Private feedback',
  ratingValue: 2,
}

type ReceiptRow = Readonly<{
  eventId: string
  consumerName: string
  status: ApplyReceiptStatus
}>

export let pool: Pool

/** Opens the pool, registers the event schemas and drops the organization after each test. */
export const useOutboxConsumersDatabase = (): void => {
  beforeAll(() => {
    pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  })

  afterEach(async () => {
    await dropInboxOrganization(pool, ORG)
  })

  afterAll(async () => {
    await pool.end()
  })
}

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
  await pool.query('UPDATE inbox_items SET current_source_revision = $2 WHERE id = $1', [
    item.id,
    revision,
  ])
}

/** Facts the Inbox itself committed; the delivered source event is not one. */
const readInboxFacts = async () =>
  (await readOutboxFacts(pool, ORG)).filter((fact) => fact.eventType.startsWith('inbox.'))

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

export async function makeDeps(overrides: {
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
      await pool.query(
        `UPDATE inbox_items
            SET current_cycle_number = NULL, current_source_revision = NULL,
                state_revision = NULL
          WHERE id = $1`,
        [item.id],
      )
    } else if (overrides.handlingCycleMaterialReviewRevision !== undefined) {
      await advanceHeadRevision(item, overrides.handlingCycleMaterialReviewRevision)
    }
  }
  const { repo, commandStore } = createInboxDatabaseStores(() => NOW, createMockLogger())
  const events = {
    facts: readInboxFacts,
    byTag: async (tag: string) =>
      (await readInboxFacts())
        .filter((fact) => fact.eventType === tag)
        .map((f) => f.payload),
  }
  const receipts = readReceipts
  const expectReceipt = async (consumerName: string, status: ApplyReceiptStatus) =>
    expect(await receipts()).toEqual([{ eventId: EVENT_ID, consumerName, status }])
  const expectNoReceipts = async () => expect(await receipts()).toEqual([])
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
        value: await apply(
          {
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
          },
          noLentReviewTransaction,
        ),
      }
    }),
  } satisfies ReviewReplyObservationAuthority

  const sourceTransitionAuthority = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (overrides.sourceTransitionCurrent === false) {
        return { status: 'obsolete' as const }
      }
      return {
        status: 'current' as const,
        value: await apply(
          {
            ...expectation,
            authority: 'review.current-source-transition.v1',
          },
          noLentReviewTransaction,
        ),
      }
    }),
  } satisfies ReviewSourceTransitionAuthority

  const responseTargetAuthority = {
    withExactCurrent: vi.fn(async (expectation, apply) => {
      if (overrides.responseTargetCurrent === false) {
        return { status: 'obsolete' as const }
      }
      const meta = overrides.sourceMeta === undefined ? SOURCE_META : overrides.sourceMeta
      return {
        status: 'current' as const,
        value: await apply(
          {
            ...expectation,
            authority: 'review.current-response-target.v1',
            materialReviewRevision: meta?.materialReviewRevision ?? 1,
            eligibility: 'measured',
            responseTargetStartAt: meta?.sourceDate ?? NOW,
          },
          noLentReviewTransaction,
        ),
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
          noLentReviewTransaction,
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
        value: await apply(
          {
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
          },
          noLentReviewTransaction,
        ),
      }
    }),
  } satisfies ReviewResponseTargetAuthority

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
    repo: { items: readItems, first: async () => (await readItems())[0]! },
    seedItem,
    events,
    receipts,
    expectReceipt,
    expectNoReceipts,
    handlingCycleStore,
    replyObservationAuthority,
    sourceTransitionAuthority,
  }
}
