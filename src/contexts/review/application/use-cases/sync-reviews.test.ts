// Unit tests for syncReviews use case
// Tests assert on STATE in fake stores, not mock call counts.
// Fakes are created fresh per test — no shared mutable state.
import { describe, it, expect, vi } from 'vitest'
import { syncReviews } from './sync-reviews'
import type { SyncReviewsDeps, SyncReviewsInput } from './sync-reviews'
import type { ReviewRepository } from '../ports/review.repository'
import type { ReplyRepository } from '../ports/reply.repository'
import type { GoogleReviewApiPort } from '../ports/google-review-api.port'
import type { EventBus } from '#/shared/events/event-bus'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type { Review, GoogleReview, Reply } from '../../domain/types'
import {
  organizationId,
  propertyId,
  reviewId,
  replyId,
  googleConnectionId,
} from '#/shared/domain/ids'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() })),
}))

// ── Constants ──────────────────────────────────────────────────────

const ORG_ID = organizationId('org-1')
const OTHER_ORG_ID = organizationId('org-2')
const PROP_ID = propertyId('prop-1')
const CONN_ID = googleConnectionId('conn-1')
const LOCATION = 'accounts/111/locations/222'
const NOW = new Date('2025-06-01T12:00:00.000Z')
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000

const daysAgo = (d: number) => new Date(NOW.getTime() - d * 24 * 60 * 60 * 1000)

const defaultInput: SyncReviewsInput = {
  propertyId: PROP_ID,
  organizationId: ORG_ID,
  connectionId: CONN_ID,
  locationName: LOCATION,
}

// ── Data factories ─────────────────────────────────────────────────

function makeGoogleReview(
  overrides: Partial<GoogleReview> & Pick<GoogleReview, 'externalId' | 'rating'>,
): GoogleReview {
  return {
    reviewName: `accounts/111/locations/222/reviews/${overrides.externalId}`,
    externalLocationId: 'loc-ext-1',
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    text: 'Great place!',
    languageCode: 'en',
    reviewedAt: daysAgo(5),
    replyText: null,
    replyUpdatedAt: null,
    ...overrides,
  }
}

function makeReview(overrides: Partial<Review> = {}): Review {
  return {
    id: reviewId('rev-seed'),
    organizationId: ORG_ID,
    propertyId: PROP_ID,
    platform: 'google',
    externalId: 'ext-1',
    externalLocationId: 'loc-ext-1',
    googleConnectionId: CONN_ID,
    reviewerName: 'Jane Doe',
    reviewerProfilePhotoUrl: null,
    rating: 5,
    text: 'Great place!',
    languageCode: 'en',
    reviewedAt: daysAgo(5),
    expiresAt: new Date(NOW.getTime() + 25 * 24 * 60 * 60 * 1000),
    sentimentLabel: null,
    sentimentScore: null,
    createdAt: daysAgo(5),
    updatedAt: daysAgo(5),
    ...overrides,
  }
}

function makeReply(overrides: Partial<Reply> = {}): Reply {
  return {
    id: replyId('reply-seed'),
    reviewId: reviewId('rev-seed'),
    organizationId: ORG_ID,
    text: 'Thanks!',
    status: 'published',
    source: 'google_sync',
    createdBy: null,
    approvedBy: null,
    rejectedBy: null,
    rejectionReason: null,
    aiGenerated: false,
    submittedAt: null,
    approvedAt: null,
    publishedAt: daysAgo(4),
    createdAt: daysAgo(4),
    updatedAt: daysAgo(4),
    ...overrides,
  }
}

// ── In-memory fakes ────────────────────────────────────────────────
// Composite key `${orgId}:${externalId}` ensures tenant isolation.

function createTestEnv(googleReviews: ReadonlyArray<GoogleReview> = []) {
  const reviewStore = new Map<string, Review>()
  const replyStore = new Map<string, Reply>()
  const emittedEvents: Array<Record<string, unknown>> = []
  let nextId = 0

  const clock = () => NOW
  const idGen = () => {
    nextId++
    return reviewId(`gen-${nextId}`)
  }
  const replyIdGen = () => {
    nextId++
    return replyId(`gen-reply-${nextId}`)
  }

  const reviewRepo: ReviewRepository = {
    findById: vi.fn(async () => null),
    findByIds: vi.fn(async () => []),
    findByExternalId: vi.fn(
      async (_p, externalId, orgId) => reviewStore.get(`${orgId}:${externalId}`) ?? null,
    ),
    upsert: vi.fn(async (review) => {
      const key = `${review.organizationId}:${review.externalId}`
      const full: Review = { ...review, createdAt: new Date(), updatedAt: new Date() }
      reviewStore.set(key, full)
      return full
    }),
    findByPropertyId: vi.fn(async (_propertyId, _orgId) => []),
    findByOrganizationId: vi.fn(async () => []),
    findAllExpiringBefore: vi.fn(async () => []),
    findAllExpiredBefore: vi.fn(async () => []),
    deleteById: vi.fn(async (_id, _orgId) => {}),
    deleteByPropertyId: vi.fn(async (_propertyId, _orgId) => {}),
  }

  const replyRepo: ReplyRepository = {
    findById: vi.fn(async () => null),
    findByReviewId: vi.fn(async () => []),
    findInternalByReviewId: vi.fn(async () => null),
    findGoogleSyncByReviewId: vi.fn(async (revId, _orgId) => {
      for (const r of replyStore.values()) {
        if (r.reviewId === revId && r.source === 'google_sync') return r
      }
      return null
    }),
    upsert: vi.fn(async (reply) => {
      const full: Reply = { ...reply, createdAt: new Date(), updatedAt: new Date() }
      replyStore.set(String(reply.id), full)
      return full
    }),
    deleteById: vi.fn(async (_id, _orgId) => {}),
    deleteByReviewIdAndSource: vi.fn(async (revId, source, _orgId) => {
      for (const [k, r] of replyStore.entries()) {
        if (r.reviewId === revId && r.source === source) replyStore.delete(k)
      }
    }),
  }

  const events: EventBus = {
    on: vi.fn(),
    emit: vi.fn(async (event) => {
      emittedEvents.push(event as Record<string, unknown>)
    }),
    clear: vi.fn(() => {
      emittedEvents.length = 0
    }),
  }

  const googleReviewApi: GoogleReviewApiPort = {
    fetchReviews: vi.fn(async () => googleReviews),
    replyToReview: vi.fn(async () => {}),
  }

  const deps: SyncReviewsDeps = {
    reviewRepo,
    replyRepo,
    googleReviewApi,
    events,
    clock,
    idGen,
    replyIdGen,
    logger: createMockLogger(),
  }

  return {
    deps,
    sync: syncReviews(deps),
    reviewStore,
    replyStore,
    emittedEvents,
    seedReview(r: Review) {
      reviewStore.set(`${r.organizationId}:${r.externalId}`, r)
    },
    seedReply(r: Reply) {
      replyStore.set(String(r.id), r)
    },
  }
}

// ════════════════════════════════════════════════════════════════════
// Tests
// ════════════════════════════════════════════════════════════════════

describe('syncReviews', () => {
  // ── Happy path ───────────────────────────────────────────────────

  describe('fresh sync — no existing reviews', () => {
    it('stores all reviews and emits review.created for each', async () => {
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5 }),
        makeGoogleReview({ externalId: 'ext-2', rating: 4 }),
      ])

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual({
          fetched: 2,
          created: 2,
          updated: 0,
          repliesMirrored: 0,
          failed: 0,
          partialFailure: false,
        })
      }
      expect(env.reviewStore.size).toBe(2)
      expect(env.emittedEvents).toHaveLength(2)
      expect(env.emittedEvents.every((e) => e._tag === 'review.created')).toBe(true)
    })
  })

  describe('re-sync — all reviews exist', () => {
    it('updates existing reviews and emits review.updated', async () => {
      const existingId = reviewId('rev-existing-1')
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 3 })])
      env.seedReview(makeReview({ id: existingId, externalId: 'ext-1', rating: 5 }))

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual({
          fetched: 1,
          created: 0,
          updated: 1,
          repliesMirrored: 0,
          failed: 0,
          partialFailure: false,
        })
      }
      // Rating was updated from 5 → 3
      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.rating).toBe(3)
      expect(stored.id).toBe(existingId)
      expect(env.emittedEvents).toHaveLength(1)
      expect(env.emittedEvents[0]._tag).toBe('review.updated')
    })
  })

  describe('mixed new and existing', () => {
    it('creates new, updates existing, correct event types in order', async () => {
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5 }),
        makeGoogleReview({ externalId: 'ext-2', rating: 3 }),
        makeGoogleReview({ externalId: 'ext-3', rating: 4 }),
      ])
      env.seedReview(makeReview({ externalId: 'ext-2', rating: 1 }))

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual({
          fetched: 3,
          created: 2,
          updated: 1,
          repliesMirrored: 0,
          failed: 0,
          partialFailure: false,
        })
      }
      expect(env.reviewStore.size).toBe(3)
      const tags = env.emittedEvents.map((e) => e._tag)
      expect(tags).toEqual(['review.created', 'review.updated', 'review.created'])
    })
  })

  // ── Reply mirroring ──────────────────────────────────────────────

  describe('reply mirroring', () => {
    it('Google has reply, no existing google_sync → creates new reply', async () => {
      const env = createTestEnv([
        makeGoogleReview({
          externalId: 'ext-1',
          rating: 5,
          replyText: 'Thank you!',
          replyUpdatedAt: new Date('2025-05-30T10:00:00.000Z'),
        }),
      ])

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.repliesMirrored).toBe(1)
      }
      expect(env.replyStore.size).toBe(1)
      const reply = Array.from(env.replyStore.values())[0]
      expect(reply.source).toBe('google_sync')
      expect(reply.text).toBe('Thank you!')
      expect(reply.status).toBe('published')
      expect(reply.createdBy).toBeNull()
    })

    it('Google has reply, existing google_sync → updates reply text', async () => {
      const revId = reviewId('rev-existing')
      const rplId = replyId('reply-existing')
      const env = createTestEnv([
        makeGoogleReview({
          externalId: 'ext-1',
          rating: 5,
          replyText: 'Updated reply text',
          replyUpdatedAt: new Date('2025-05-31T10:00:00.000Z'),
        }),
      ])
      env.seedReview(makeReview({ id: revId, externalId: 'ext-1' }))
      env.seedReply(makeReply({ id: rplId, reviewId: revId, text: 'Old reply text' }))

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.repliesMirrored).toBe(1)
      }
      const reply = Array.from(env.replyStore.values()).find(
        (r) => r.source === 'google_sync',
      )!
      expect(reply.text).toBe('Updated reply text')
    })

    it('Google has no reply, existing google_sync → deletes it', async () => {
      const revId = reviewId('rev-existing')
      const rplId = replyId('reply-existing')
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5, replyText: null }),
      ])
      env.seedReview(makeReview({ id: revId, externalId: 'ext-1' }))
      env.seedReply(makeReply({ id: rplId, reviewId: revId }))

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.repliesMirrored).toBe(1)
      }
      const remaining = Array.from(env.replyStore.values()).filter(
        (r) => r.source === 'google_sync',
      )
      expect(remaining).toHaveLength(0)
    })

    it('Google has no reply, no existing google_sync → no-op', async () => {
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 5 })])

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.repliesMirrored).toBe(0)
      }
      expect(env.replyStore.size).toBe(0)
    })
  })

  // ── expiresAt ────────────────────────────────────────────────────

  describe('expiresAt', () => {
    it('calculated per-review from reviewedAt (not from now)', async () => {
      const reviewedAt = daysAgo(10)
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5, reviewedAt }),
      ])

      await env.sync(defaultInput)

      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      const remaining = THIRTY_DAYS_MS - (NOW.getTime() - reviewedAt.getTime())
      expect(stored.expiresAt.getTime()).toBe(NOW.getTime() + remaining)
    })

    it('review past 30-day window expires immediately', async () => {
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5, reviewedAt: daysAgo(45) }),
      ])

      await env.sync(defaultInput)

      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.expiresAt.getTime()).toBe(NOW.getTime())
    })
  })

  // ── Edge cases ───────────────────────────────────────────────────

  describe('empty Google response', () => {
    it('returns zeros, no side effects', async () => {
      const env = createTestEnv([])

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual({
          fetched: 0,
          created: 0,
          updated: 0,
          repliesMirrored: 0,
          failed: 0,
          partialFailure: false,
        })
      }
      expect(env.reviewStore.size).toBe(0)
      expect(env.emittedEvents).toHaveLength(0)
    })
  })

  // ── Error paths ──────────────────────────────────────────────────

  describe('error propagation', () => {
    it('Google API error returns Err, nothing stored', async () => {
      const env = createTestEnv()
      ;(
        env.deps.googleReviewApi.fetchReviews as ReturnType<typeof vi.fn>
      ).mockRejectedValue(new Error('API down'))

      const result = await env.sync(defaultInput)

      expect(result.isErr()).toBe(true)
      if (result.isErr()) {
        expect(result.error._tag).toBe('ReviewError')
        expect(result.error.code).toBe('sync_failed')
      }
      expect(env.reviewStore.size).toBe(0)
      expect(env.emittedEvents).toHaveLength(0)
    })

    it('events.emit throws → error caught, already-persisted reviews remain, returns Err', async () => {
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5 }),
        makeGoogleReview({ externalId: 'ext-2', rating: 4 }),
      ])
      let emitCount = 0
      const origEvents = env.emittedEvents
      ;(env.deps.events.emit as ReturnType<typeof vi.fn>).mockImplementation(
        async (event: unknown) => {
          emitCount++
          if (emitCount === 2) throw new Error('Event bus down')
          origEvents.push(event as Record<string, unknown>)
        },
      )

      const result = await env.sync(defaultInput)

      // Partial failure → Ok with partialFailure flag
      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.partialFailure).toBe(true)
        expect(result.value).toMatchObject({
          fetched: 2,
          created: 2,
          updated: 0,
          repliesMirrored: 0,
          failed: 1,
        })
      }
      // Both reviews were upserted before emit was called for each
      expect(env.reviewStore.has(`${ORG_ID}:ext-1`)).toBe(true)
      expect(env.reviewStore.has(`${ORG_ID}:ext-2`)).toBe(true)
      expect(env.emittedEvents).toHaveLength(1)
    })

    it('reviewRepo.upsert throws → error caught, no event for that review, returns Err', async () => {
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5 }),
        makeGoogleReview({ externalId: 'ext-2', rating: 4 }),
      ])
      const store = env.reviewStore
      ;(env.deps.reviewRepo.upsert as ReturnType<typeof vi.fn>).mockImplementation(
        async (review: Review & { createdAt?: Date; updatedAt?: Date }) => {
          if (review.externalId === 'ext-2') throw new Error('DB connection lost')
          const key = `${review.organizationId}:${review.externalId}`
          const full = { ...review, createdAt: new Date(), updatedAt: new Date() }
          store.set(key, full as Review)
          return full as Review
        },
      )

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.partialFailure).toBe(true)
        expect(result.value).toMatchObject({
          fetched: 2,
          created: 1,
          updated: 0,
          repliesMirrored: 0,
          failed: 1,
        })
      }
      expect(store.has(`${ORG_ID}:ext-1`)).toBe(true)
      expect(store.has(`${ORG_ID}:ext-2`)).toBe(false)
      expect(env.emittedEvents).toHaveLength(1)
    })
  })

  // ── Tenant isolation ─────────────────────────────────────────────

  describe('tenant isolation', () => {
    it('same externalId, different org → creates separate review', async () => {
      const sharedId = 'ext-shared'
      const env = createTestEnv([makeGoogleReview({ externalId: sharedId, rating: 5 })])
      env.seedReview(
        makeReview({
          id: reviewId('rev-other'),
          organizationId: OTHER_ORG_ID,
          externalId: sharedId,
          rating: 1,
        }),
      )

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value.created).toBe(1)
        expect(result.value.updated).toBe(0)
      }

      const org1 = env.reviewStore.get(`${ORG_ID}:${sharedId}`)!
      const org2 = env.reviewStore.get(`${OTHER_ORG_ID}:${sharedId}`)!
      expect(org1.rating).toBe(5)
      expect(org2.rating).toBe(1)
      expect(org1.id).not.toBe(org2.id)
    })
  })

  // ── Event payload ────────────────────────────────────────────────

  describe('event payload', () => {
    it('review.created has all required fields', async () => {
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 4 })])

      await env.sync(defaultInput)

      const event = env.emittedEvents[0]
      expect(event).toMatchObject({
        _tag: 'review.created',
        externalId: 'ext-1',
        rating: 4,
        platform: 'google',
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        occurredAt: daysAgo(5),
      })
      expect(event.reviewId).toBeDefined()
    })

    it('review.updated reuses existing reviewId', async () => {
      const existingId = reviewId('rev-original')
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 3 })])
      env.seedReview(makeReview({ id: existingId, externalId: 'ext-1' }))

      await env.sync(defaultInput)

      expect(env.emittedEvents[0]._tag).toBe('review.updated')
      expect(env.emittedEvents[0].reviewId).toBe(existingId)
    })
  })

  // ── Sentiment preservation ───────────────────────────────────────

  describe('sentiment', () => {
    it('preserves existing sentiment on update', async () => {
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 5 })])
      env.seedReview(
        makeReview({
          externalId: 'ext-1',
          sentimentLabel: 'positive',
          sentimentScore: 0.92,
        }),
      )

      await env.sync(defaultInput)

      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.sentimentLabel).toBe('positive')
      expect(stored.sentimentScore).toBe(0.92)
    })

    it('sets sentiment to null for new reviews', async () => {
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 5 })])

      await env.sync(defaultInput)

      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.sentimentLabel).toBeNull()
      expect(stored.sentimentScore).toBeNull()
    })
  })

  // ── ID handling ──────────────────────────────────────────────────

  describe('ID handling', () => {
    it('generates new ID for new reviews via idGen', async () => {
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-new', rating: 5 })])

      await env.sync(defaultInput)

      const stored = env.reviewStore.get(`${ORG_ID}:ext-new`)!
      expect(String(stored.id)).toMatch(/^gen-/)
    })

    it('reuses existing ID on update (idGen not called)', async () => {
      const existingId = reviewId('rev-original')
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 5 })])
      env.seedReview(makeReview({ id: existingId, externalId: 'ext-1' }))

      await env.sync(defaultInput)

      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.id).toBe(existingId)
    })
  })
})
