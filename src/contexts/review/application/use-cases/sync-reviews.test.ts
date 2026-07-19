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
import type { ReviewCommandStore } from '../ports/review-command-store.port'
import type { ReplyCommandStore } from '../ports/reply-command-store.port'
import type { Review, GoogleReview, Reply } from '../../domain/types'
import { computeReviewContentHash, MAX_REPLY_LENGTH } from '../../domain/rules'
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
    sourceCreatedAt: daysAgo(5),
    sourceUpdatedAt: null,
    firstFetchedAt: daysAgo(5),
    lastFetchedAt: daysAgo(5),
    contentExpiresAt: null,
    contentHash: null,
    sourceSeenGeneration: null,
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
    publicationState: 'published',
    publicationAttempts: 0,
    publicationLastErrorClass: null,
    reconcileDueAt: null,
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
  // BQC-4.1: region lookup backing the fail-closed assertion at sync entry.
  // Default 'us' — the only approved beta cell (ADR 0048).
  let propertyRegion: string | null = 'us'

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
    findRecentEligibleByPropertyId: vi.fn(async () => []),
    findExpiringBatchAcrossTenants: vi.fn(async () => []),
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
    findByConnection: vi.fn(async () => []),
    findIdsByContentFilter: vi.fn(async () => []),
    findAllExpiringBeforeAcrossTenants: vi.fn(async () => []),
    findAllExpiredBeforeAcrossTenants: vi.fn(async () => []),
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
    conditionalUpdate: vi.fn(async () => null),
    findAmbiguousPublicationBatch: vi.fn(async () => []),
    findPublicationActiveByReviewIds: vi.fn(async () => []),
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

  // In-process fake of ReviewCommandStore (application zone must not import infra).
  const commandStore: ReviewCommandStore = {
    upsertAndRecord: async (review, event, now) => {
      const saved = await reviewRepo.upsert(review, now)
      try {
        await events.emit(event)
      } catch {
        // Best-effort bus (matches production post-commit semantics)
      }
      return saved
    },
  }

  // In-process fake of ReplyCommandStore (application zone must not import
  // infra). Only mirrorSyncedReply is exercised by syncReviews; the other
  // commands throw to surface accidental use.
  const replyCommandStore: ReplyCommandStore = {
    submitReply: vi.fn(async () => {
      throw new Error('submitReply is not used by syncReviews')
    }),
    rejectReply: vi.fn(async () => {
      throw new Error('rejectReply is not used by syncReviews')
    }),
    markPublished: vi.fn(async () => {
      throw new Error('markPublished is not used by syncReviews')
    }),
    markPublicationAuthorized: vi.fn(async () => {
      throw new Error('markPublicationAuthorized is not used by syncReviews')
    }),
    editPublishedReply: vi.fn(async () => {
      throw new Error('editPublishedReply is not used by syncReviews')
    }),
    markPublicationSending: vi.fn(async () => {
      throw new Error('markPublicationSending is not used by syncReviews')
    }),
    markPublicationTerminal: vi.fn(async () => {
      throw new Error('markPublicationTerminal is not used by syncReviews')
    }),
    markPublicationAmbiguous: vi.fn(async () => {
      throw new Error('markPublicationAmbiguous is not used by syncReviews')
    }),
    markPublicationRetryQueued: vi.fn(async () => {
      throw new Error('markPublicationRetryQueued is not used by syncReviews')
    }),
    cancelPublications: vi.fn(async () => {
      throw new Error('cancelPublications is not used by syncReviews')
    }),
    mirrorSyncedReply: async (command) => {
      if (!command.reply) {
        await replyRepo.deleteByReviewIdAndSource(
          command.reviewId,
          'google_sync',
          command.organizationId,
        )
        return null
      }
      const saved = await replyRepo.upsert(command.reply, command.now)
      if (command.event) await events.emit(command.event)
      return saved
    },
    purgeExpiredReview: vi.fn(async () => {
      throw new Error('purgeExpiredReview is not used by syncReviews')
    }),
  }

  const deps: SyncReviewsDeps = {
    reviewRepo,
    replyRepo,
    googleReviewApi,
    clock,
    idGen,
    replyIdGen,
    logger: createMockLogger(),
    commandStore,
    replyCommandStore,
    propertyRouting: {
      getProcessingRegion: vi.fn(async () => propertyRegion),
    },
  }

  return {
    deps,
    sync: syncReviews(deps),
    reviewStore,
    replyStore,
    emittedEvents,
    events,
    googleReviewApi,
    setPropertyRegion(region: string | null) {
      propertyRegion = region
    },
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
  // ── BQC-4.1: fail-closed region gate (ADR 0048) ───────────────────
  // Every sync path (webhook / sweep / consumer / manual enqueue) funnels
  // through this use case, so the region assertion lives at entry. Only the
  // approved 'us' cell may process; unresolved/europe/global fail closed and
  // no Google fetch is attempted.

  describe('region gate (BQC-4.1)', () => {
    it.each(['unresolved', 'global', 'europe'])(
      'refuses to sync when the property region is %s',
      async (region) => {
        const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 5 })])
        env.setPropertyRegion(region)

        await expect(env.sync(defaultInput)).rejects.toSatisfy(
          (e: unknown) =>
            typeof e === 'object' &&
            e !== null &&
            (e as { _tag?: string })._tag === 'PropertyError' &&
            (e as { code?: string }).code === 'region_unresolved',
        )

        // Fail closed BEFORE any external effect: no Google fetch, no writes.
        expect(env.googleReviewApi.fetchReviews).not.toHaveBeenCalled()
        expect(env.reviewStore.size).toBe(0)
        expect(env.emittedEvents).toHaveLength(0)
      },
    )

    it('refuses to sync when the property row is missing (region null)', async () => {
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 5 })])
      env.setPropertyRegion(null)

      await expect(env.sync(defaultInput)).rejects.toSatisfy(
        (e: unknown) =>
          typeof e === 'object' &&
          e !== null &&
          (e as { code?: string }).code === 'region_unresolved',
      )
      expect(env.googleReviewApi.fetchReviews).not.toHaveBeenCalled()
    })

    it('syncs normally when the property is in the approved us cell', async () => {
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 5 })])
      env.setPropertyRegion('us')

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      expect(env.googleReviewApi.fetchReviews).toHaveBeenCalledTimes(1)
      expect(env.reviewStore.size).toBe(1)
    })
  })

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
          refreshed: 0,
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
    it('updates existing reviews and emits review.updated when content changes', async () => {
      const existingId = reviewId('rev-existing-1')
      const env = createTestEnv([makeGoogleReview({ externalId: 'ext-1', rating: 3 })])
      env.seedReview(
        makeReview({
          id: existingId,
          externalId: 'ext-1',
          rating: 5,
          contentHash: computeReviewContentHash({
            rating: 5,
            text: 'Great place!',
            reviewerName: 'Jane Doe',
            languageCode: 'en',
          }),
        }),
      )

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual({
          fetched: 1,
          created: 0,
          updated: 1,
          refreshed: 0,
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

    it('extends lifecycle without review.updated when content hash is unchanged (BQR-3.4)', async () => {
      const existingId = reviewId('rev-existing-1')
      const firstFetch = daysAgo(10)
      const google = makeGoogleReview({
        externalId: 'ext-1',
        rating: 5,
        text: 'Great place!',
        reviewerName: 'Jane Doe',
        languageCode: 'en',
      })
      const hash = computeReviewContentHash({
        rating: google.rating,
        text: google.text,
        reviewerName: google.reviewerName,
        languageCode: google.languageCode,
      })
      const env = createTestEnv([google])
      env.seedReview(
        makeReview({
          id: existingId,
          externalId: 'ext-1',
          rating: 5,
          text: 'Great place!',
          reviewerName: 'Jane Doe',
          languageCode: 'en',
          firstFetchedAt: firstFetch,
          lastFetchedAt: firstFetch,
          contentExpiresAt: new Date(firstFetch.getTime() + THIRTY_DAYS_MS),
          contentHash: hash,
        }),
      )

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toEqual({
          fetched: 1,
          created: 0,
          updated: 0, // lifecycle refresh only — not a content change
          refreshed: 1, // BQC-1.3: content-free refresh fact — clock advanced, no event
          repliesMirrored: 0,
          failed: 0,
          partialFailure: false,
        })
      }
      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.id).toBe(existingId)
      expect(stored.firstFetchedAt?.getTime()).toBe(firstFetch.getTime())
      expect(stored.lastFetchedAt?.getTime()).toBe(NOW.getTime())
      expect(stored.contentExpiresAt?.getTime()).toBe(NOW.getTime() + THIRTY_DAYS_MS)
      expect(stored.contentHash).toBe(hash)
      expect(env.emittedEvents).toHaveLength(0)
    })

    it('emits review.updated when existing contentHash is null (establish baseline)', async () => {
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5, text: 'Great place!' }),
      ])
      env.seedReview(
        makeReview({
          externalId: 'ext-1',
          rating: 5,
          text: 'Great place!',
          contentHash: null,
        }),
      )

      await env.sync(defaultInput)

      expect(env.emittedEvents).toHaveLength(1)
      expect(env.emittedEvents[0]._tag).toBe('review.updated')
      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.contentHash).toMatch(/^[a-f0-9]{64}$/)
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
          refreshed: 0,
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

    it('clamps mirrored reply text to MAX_REPLY_LENGTH (new reply)', async () => {
      const longText = 'A'.repeat(MAX_REPLY_LENGTH + 100)
      const env = createTestEnv([
        makeGoogleReview({
          externalId: 'ext-1',
          rating: 5,
          replyText: longText,
          replyUpdatedAt: new Date('2025-05-30T10:00:00.000Z'),
        }),
      ])

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      const reply = Array.from(env.replyStore.values())[0]
      expect(reply.text.length).toBe(MAX_REPLY_LENGTH)
    })

    it('clamps mirrored reply text to MAX_REPLY_LENGTH (existing reply update)', async () => {
      const revId = reviewId('rev-existing')
      const rplId = replyId('reply-existing')
      const longText = 'B'.repeat(MAX_REPLY_LENGTH + 50)
      const env = createTestEnv([
        makeGoogleReview({
          externalId: 'ext-1',
          rating: 5,
          replyText: longText,
          replyUpdatedAt: new Date('2025-05-31T10:00:00.000Z'),
        }),
      ])
      env.seedReview(makeReview({ id: revId, externalId: 'ext-1' }))
      env.seedReply(makeReply({ id: rplId, reviewId: revId, text: 'Short' }))

      const result = await env.sync(defaultInput)

      expect(result.isOk()).toBe(true)
      const reply = Array.from(env.replyStore.values()).find(
        (r) => r.source === 'google_sync',
      )!
      expect(reply.text.length).toBe(MAX_REPLY_LENGTH)
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

  // ── expiresAt (legacy publication clock — dual path until BQR-3.2) ──

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

  // ── BQR-3.1 content lifecycle (fetch-based clock + hash) ──────────

  describe('content lifecycle (BQR-3.1)', () => {
    it('sets contentExpiresAt from fetch time, not publication time', async () => {
      const env = createTestEnv([
        makeGoogleReview({
          externalId: 'ext-1',
          rating: 5,
          reviewedAt: daysAgo(45), // publication long ago
        }),
      ])

      await env.sync(defaultInput)

      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.lastFetchedAt?.getTime()).toBe(NOW.getTime())
      expect(stored.contentExpiresAt?.getTime()).toBe(NOW.getTime() + THIRTY_DAYS_MS)
      expect(stored.contentHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('extends contentExpiresAt and preserves firstFetchedAt on re-sync', async () => {
      const firstFetch = daysAgo(10)
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5, text: 'Great place!' }),
      ])
      env.seedReview(
        makeReview({
          externalId: 'ext-1',
          firstFetchedAt: firstFetch,
          lastFetchedAt: firstFetch,
          contentExpiresAt: new Date(firstFetch.getTime() + THIRTY_DAYS_MS),
          contentHash: 'old-hash',
        }),
      )

      await env.sync(defaultInput)

      const stored = env.reviewStore.get(`${ORG_ID}:ext-1`)!
      expect(stored.firstFetchedAt?.getTime()).toBe(firstFetch.getTime())
      expect(stored.lastFetchedAt?.getTime()).toBe(NOW.getTime())
      expect(stored.contentExpiresAt?.getTime()).toBe(NOW.getTime() + THIRTY_DAYS_MS)
      expect(stored.contentHash).not.toBe('old-hash')
      expect(stored.contentHash).toMatch(/^[a-f0-9]{64}$/)
    })

    it('produces the same contentHash for identical source fields', async () => {
      const env1 = createTestEnv([
        makeGoogleReview({
          externalId: 'ext-1',
          rating: 4,
          text: 'Solid',
          reviewerName: 'A',
          languageCode: 'en',
        }),
      ])
      await env1.sync(defaultInput)
      const hash1 = env1.reviewStore.get(`${ORG_ID}:ext-1`)!.contentHash

      const env2 = createTestEnv([
        makeGoogleReview({
          externalId: 'ext-1',
          rating: 4,
          text: 'Solid',
          reviewerName: 'A',
          languageCode: 'en',
        }),
      ])
      await env2.sync(defaultInput)
      const hash2 = env2.reviewStore.get(`${ORG_ID}:ext-1`)!.contentHash

      expect(hash1).toBe(hash2)
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
          refreshed: 0,
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

    it('events.emit throws → durable upsert still succeeds (bus is best-effort after commit)', async () => {
      const env = createTestEnv([
        makeGoogleReview({ externalId: 'ext-1', rating: 5 }),
        makeGoogleReview({ externalId: 'ext-2', rating: 4 }),
      ])
      let emitCount = 0
      const origEvents = env.emittedEvents
      ;(env.events.emit as ReturnType<typeof vi.fn>).mockImplementation(
        async (event: unknown) => {
          emitCount++
          if (emitCount === 2) throw new Error('Event bus down')
          origEvents.push(event as Record<string, unknown>)
        },
      )

      const result = await env.sync(defaultInput)

      // BQR-2.3: after atomic commit, in-process emit is best-effort. Both
      // reviews remain durable; second emit failure is logged, not a failed sync.
      expect(result.isOk()).toBe(true)
      if (result.isOk()) {
        expect(result.value).toMatchObject({
          fetched: 2,
          created: 2,
          updated: 0,
          refreshed: 0,
          repliesMirrored: 0,
          failed: 0,
          partialFailure: false,
        })
      }
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
      // BQC-1.2: identifier-only payload — no rating on the bus.
      expect(event).toMatchObject({
        _tag: 'review.created',
        externalId: 'ext-1',
        platform: 'google',
        organizationId: ORG_ID,
        propertyId: PROP_ID,
        occurredAt: daysAgo(5),
      })
      expect(event).not.toHaveProperty('rating')
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
