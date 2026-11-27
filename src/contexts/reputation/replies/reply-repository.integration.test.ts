import { seedReply } from './reply-seed.test-fixtures'
// Reply repository reads — integration tests against real Postgres.
import { describe, it, expect } from 'vitest'
import { createReplyRepository } from './reply-repository.server'
import { createPublicationReconciliationCandidateQuery } from '../publication/publication-reconciliation-candidate-repository.server'
import { getDb } from '#/shared/db'
import { reviewId, propertyId, userId } from '#/shared/domain/ids'
import type { Review } from '../domain/review-types'
import {
  REPLY_QUEUE_PUBLICATION_STATES,
  REPLY_QUEUE_STATUSES,
} from '#/shared/domain/reply-queue-stage.test-fixtures'
import { replyQueueStage, type ReplyQueueStage } from '#/shared/domain/reply-queue-stage'
import { itemMatchesQueue } from '#/contexts/reputation/inbox/ui/page/inbox-queues'
import type { InboxItem } from '#/contexts/reputation/public-api'
import { createReplyLookupAdapter } from '#/contexts/reputation/inbox/reply-lookup.adapter.server'
import { getInboxQueueCounts } from '#/contexts/reputation/inbox/get-inbox-queue-counts.server'
import { getInboxItems } from '#/contexts/reputation/inbox/get-inbox-items.server'
import {
  buildFixtureItem,
  createInboxUseCaseDatabase,
} from '#/contexts/reputation/inbox/inbox-database.test-fixtures'
import type { AuthContext } from '#/shared/domain/auth-context'
import {
  ORG_A,
  ORG_B,
  PROP_A,
  arrangeRepo,
  makeReply,
  now,
  observeGoogleReply,
  reviewedAt,
  seedReview,
  servedReview,
  useReplyRepositoryDatabase,
} from './reply-repository.test-fixtures'

const getPool = useReplyRepositoryDatabase()

describe.sequential('replyRepository (integration)', () => {
  describe.each([
    [
      'does not query for an empty review scope',
      (repo: ReturnType<typeof createReplyRepository>) =>
        repo.findMilestonesByReviewIds([], ORG_A),
    ],
    [
      'does not query for an empty review scope',
      (repo: ReturnType<typeof createReplyRepository>) =>
        repo.findStatesByReviewIds([], ORG_A),
    ],
    [
      'does not query for an empty property scope',
      (repo: ReturnType<typeof createReplyRepository>) =>
        repo.findReviewIdsByReplyStage(ORG_A, []),
    ],
  ])('empty scope', (title, query) => {
    it(title, async () => {
      await expect(query(createReplyRepository(getDb(), () => now))).resolves.toEqual([])
    })
  })

  describe('findMilestonesByReviewIds', () => {
    it('aggregates the earliest timestamps for a tenant in one content-free row per review', async () => {
      const db = getDb()
      const firstReview = await seedReview(db)
      const secondReview = await seedReview(db, {
        id: reviewId('3a000000-0000-0000-0000-000000000002'),
        externalId: 'rpl-ext-002',
      })
      const repo = createReplyRepository(db, () => new Date())
      const earlySubmission = new Date('2025-05-30T09:00:00Z')
      const laterSubmission = new Date('2025-05-31T09:00:00Z')
      const publication = new Date('2025-06-01T09:00:00Z')

      await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000011',
          reviewId: firstReview.id,
          source: 'internal',
          submittedAt: laterSubmission,
          publishedAt: null,
        }),
      )
      await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000012',
          reviewId: firstReview.id,
          source: 'google_sync',
          submittedAt: earlySubmission,
          publishedAt: publication,
        }),
      )
      const milestones = await repo.findMilestonesByReviewIds(
        [firstReview.id, secondReview.id],
        ORG_A,
      )

      expect(milestones).toEqual([
        {
          reviewId: firstReview.id,
          firstSubmittedAt: earlySubmission,
          firstPublishedAt: publication,
        },
      ])
      expect(Object.keys(milestones[0]!)).toEqual([
        'reviewId',
        'firstSubmittedAt',
        'firstPublishedAt',
      ])
      await expect(
        repo.findMilestonesByReviewIds([firstReview.id], ORG_B),
      ).resolves.toEqual([])
    })

    it('counts the reply Google shows, at the time Google reports for it', async () => {
      const repo = createReplyRepository(getDb(), () => new Date())
      const writtenOnGoogle = new Date('2025-05-29T08:00:00Z')
      const readFromGoogle = new Date('2025-05-30T06:00:00Z')
      const onlyOnGoogle = await servedReview(1)
      await observeGoogleReply(getPool(), onlyOnGoogle, {
        state: 'live',
        providerUpdatedAt: writtenOnGoogle,
        observedAt: readFromGoogle,
      })
      const noUpdateTime = await servedReview(2)
      await observeGoogleReply(getPool(), noUpdateTime, {
        state: 'live',
        providerUpdatedAt: null,
        observedAt: readFromGoogle,
      })
      // RepKey's own reply went out first; Google's time is its later edit.
      const repliedFromRepKey = await servedReview(3)
      const sentFromRepKey = new Date('2025-05-28T12:00:00Z')
      await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000103',
          reviewId: repliedFromRepKey.id,
          source: 'internal',
          submittedAt: new Date('2025-05-28T10:00:00Z'),
          publishedAt: sentFromRepKey,
        }),
      )
      await observeGoogleReply(getPool(), repliedFromRepKey, {
        state: 'live',
        providerUpdatedAt: writtenOnGoogle,
        observedAt: readFromGoogle,
      })
      const deletedOnGoogle = await servedReview(4)
      await observeGoogleReply(getPool(), deletedOnGoogle, {
        state: 'absent',
        providerUpdatedAt: null,
        observedAt: readFromGoogle,
      })

      const milestones = await repo.findMilestonesByReviewIds(
        [onlyOnGoogle.id, noUpdateTime.id, repliedFromRepKey.id, deletedOnGoogle.id],
        ORG_A,
      )

      expect(new Map(milestones.map((row) => [row.reviewId, row]))).toEqual(
        new Map([
          [
            onlyOnGoogle.id,
            {
              reviewId: onlyOnGoogle.id,
              firstSubmittedAt: null,
              firstPublishedAt: writtenOnGoogle,
            },
          ],
          [
            noUpdateTime.id,
            {
              reviewId: noUpdateTime.id,
              firstSubmittedAt: null,
              firstPublishedAt: readFromGoogle,
            },
          ],
          [
            repliedFromRepKey.id,
            {
              reviewId: repliedFromRepKey.id,
              firstSubmittedAt: new Date('2025-05-28T10:00:00Z'),
              firstPublishedAt: sentFromRepKey,
            },
          ],
        ]),
      )
      await expect(
        repo.findMilestonesByReviewIds([onlyOnGoogle.id], ORG_B),
      ).resolves.toEqual([])
    })
  })

  describe('findCurrentGoogleReplyHeadsByReviewIds', () => {
    it('returns each head as the identity Review fences on, without reply text', async () => {
      const repo = createReplyRepository(getDb(), () => new Date())
      const readFromGoogle = new Date('2025-05-30T06:00:00Z')
      const live = await servedReview(5)
      await observeGoogleReply(getPool(), live, {
        state: 'live',
        providerUpdatedAt: new Date('2025-05-29T08:00:00Z'),
        observedAt: readFromGoogle,
      })
      const deleted = await servedReview(6)
      await observeGoogleReply(getPool(), deleted, {
        state: 'absent',
        providerUpdatedAt: null,
        observedAt: readFromGoogle,
      })
      const neverRead = await servedReview(7)

      const heads = await repo.findCurrentGoogleReplyHeadsByReviewIds(
        [live.id, deleted.id, neverRead.id],
        ORG_A,
      )

      expect(new Map(heads.map((head) => [head.reviewId, head]))).toEqual(
        new Map([
          [
            live.id,
            {
              reviewId: live.id,
              propertyId: PROP_A,
              observationRevision: 2,
              sourceEpoch: live.sourceEpoch,
              materialReviewRevision: live.sourceRevision,
              state: 'live',
              change: 'added',
              resolution: 'external_current_live',
              provenance: 'external_or_unknown',
              matchedReplyId: null,
              matchedPublicationCycle: null,
              observedAt: readFromGoogle,
            },
          ],
          [
            deleted.id,
            expect.objectContaining({
              state: 'absent',
              change: 'deleted',
              resolution: 'absent',
            }),
          ],
        ]),
      )
      await expect(
        repo.findCurrentGoogleReplyHeadsByReviewIds([live.id], ORG_B),
      ).resolves.toEqual([])
      await expect(
        repo.findCurrentGoogleReplyHeadsByReviewIds([], ORG_A),
      ).resolves.toEqual([])
    })
  })

  describe('findStatesByReviewIds', () => {
    it('returns one content-free batch of source candidates within the tenant', async () => {
      const db = getDb()
      const firstReview = await seedReview(db)
      const secondReview = await seedReview(db, {
        id: reviewId('3a000000-0000-0000-0000-000000000002'),
        externalId: 'rpl-ext-002',
      })
      const repo = createReplyRepository(db, () => now)

      const providerReply = await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000011',
          reviewId: firstReview.id,
          source: 'google_sync',
          text: 'provider reply text must not cross the lookup',
          status: 'published',
          publicationState: 'published',
          publicationAttempts: 1,
          publicationCycle: 1,
          publicationLastErrorClass: null,
          reconcileDueAt: null,
        }),
        now,
      )
      const internalReply = await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000012',
          reviewId: firstReview.id,
          source: 'internal',
          text: 'manager reply text must not cross the lookup',
          status: 'approved',
          publicationState: 'pending_observation',
          publicationAttempts: 1,
          publicationCycle: 1,
          publicationLastErrorClass: null,
          reconcileDueAt: now,
        }),
        now,
      )

      const states = await repo.findStatesByReviewIds(
        [firstReview.id, secondReview.id],
        ORG_A,
      )

      expect(states).toEqual([
        {
          reviewId: firstReview.id,
          source: 'google_sync',
          status: 'published',
          publicationState: 'published',
          publicationLastErrorClass: null,
          reconcileDueAt: null,
          updatedAt: providerReply.updatedAt,
        },
        {
          reviewId: firstReview.id,
          source: 'internal',
          status: 'approved',
          publicationState: 'pending_observation',
          publicationLastErrorClass: null,
          reconcileDueAt: now,
          updatedAt: internalReply.updatedAt,
        },
      ])
      expect(Object.keys(states[0]!)).toEqual([
        'reviewId',
        'source',
        'status',
        'publicationState',
        'publicationLastErrorClass',
        'reconcileDueAt',
        'updatedAt',
      ])
      expect(JSON.stringify(states)).not.toContain('reply text')
      await expect(repo.findStatesByReviewIds([firstReview.id], ORG_B)).resolves.toEqual(
        [],
      )
    })
  })

  describe('findReviewIdsByReplyStage', () => {
    it('returns content-free source candidates within tenant and property scope', async () => {
      const db = getDb()
      const firstReview = await seedReview(db)
      const secondReview = await seedReview(db, {
        id: reviewId('3a000000-0000-0000-0000-000000000002'),
        externalId: 'rpl-stage-ext-002',
      })
      const repo = createReplyRepository(db, () => now)
      await seedReply(
        getDb(),
        makeReply({
          reviewId: firstReview.id,
          status: 'pending_approval',
          source: 'internal',
        }),
        now,
      )
      await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000002',
          reviewId: secondReview.id,
          status: 'approved',
          source: 'internal',
        }),
        now,
      )

      const rows = await repo.findReviewIdsByReplyStage(ORG_A, [PROP_A])

      expect(rows).toEqual([
        {
          reviewId: firstReview.id,
          source: 'internal',
          stage: 'awaiting',
        },
        { reviewId: secondReview.id, source: 'internal', stage: 'waiting' },
      ])
      expect(Object.keys(rows[0]!)).toEqual(['reviewId', 'source', 'stage'])
      await expect(
        repo.findReviewIdsByReplyStage(ORG_A, [
          propertyId('2a000000-0000-0000-0000-000000000099'),
        ]),
      ).resolves.toEqual([])
      await expect(repo.findReviewIdsByReplyStage(ORG_B)).resolves.toEqual([])
    })

    it('agrees with the shared rule and the client queue helper for every status × publication state × due time', async () => {
      const matrix = REPLY_QUEUE_STATUSES.flatMap((status) =>
        [null, ...REPLY_QUEUE_PUBLICATION_STATES].flatMap((publicationState) =>
          [true, false].map((hasDueTime) => ({ status, publicationState, hasDueTime })),
        ),
      )
      const db = getDb()
      const repo = createReplyRepository(db, () => now)
      const dueAt = new Date('2025-06-01T12:15:00Z')

      for (const [index, state] of matrix.entries()) {
        const suffix = String(index + 1).padStart(12, '0')
        const id = reviewId(`3c000000-0000-4000-8000-${suffix}`)
        await seedReview(db, {
          id,
          externalId: `rpl-stage-matrix-${index}`,
        })
        await seedReply(
          getDb(),
          makeReply({
            id: `2c000000-0000-4000-8000-${suffix}`,
            reviewId: id,
            source: 'internal',
            status: state.status,
            publicationState: state.publicationState,
            reconcileDueAt: state.hasDueTime ? dueAt : null,
          }),
          now,
        )
      }

      const sqlStageByReview = new Map(
        (await repo.findReviewIdsByReplyStage(ORG_A, [PROP_A])).map((row) => [
          row.reviewId,
          row.stage,
        ]),
      )
      expect(sqlStageByReview.size).toBe(matrix.length)

      const clientStage = (replyState: InboxItem['replyState']): ReplyQueueStage => {
        const item = {
          status: 'open',
          sourceType: 'review',
          replyState,
        } as InboxItem
        if (itemMatchesQueue(item, 'approval', undefined)) return 'awaiting'
        if (itemMatchesQueue(item, 'waiting', undefined)) return 'waiting'
        expect(itemMatchesQueue(item, 'reply', undefined)).toBe(true)
        return 'needs_reply'
      }

      const disagreements = matrix.flatMap((state, index) => {
        const suffix = String(index + 1).padStart(12, '0')
        const replyState = {
          status: state.status,
          publicationState: state.publicationState,
          publicationLastErrorClass: null,
          reconcileDueAt: state.hasDueTime ? dueAt : null,
          updatedAt: now,
        }
        const stages = {
          sql: sqlStageByReview.get(reviewId(`3c000000-0000-4000-8000-${suffix}`)),
          rule: replyQueueStage(replyState),
          client: clientStage(replyState),
        }
        return stages.sql === stages.rule && stages.rule === stages.client
          ? []
          : [{ ...state, ...stages }]
      })
      expect(disagreements).toEqual([])
    })

    it('counts and lists an uncertain publish under Waiting for Google only while checks continue', async () => {
      const { db, repo } = await arrangeRepo({}, () => now)
      const checked = await seedReview(db, {
        id: reviewId('3d000000-0000-4000-8000-000000000001'),
        externalId: 'rpl-stage-uncertain-checked',
      })
      const stopped = await seedReview(db, {
        id: reviewId('3d000000-0000-4000-8000-000000000002'),
        externalId: 'rpl-stage-uncertain-stopped',
      })
      for (const [review, reconcileDueAt, suffix] of [
        [checked, new Date('2025-06-01T12:15:00Z'), '1'],
        [stopped, null, '2'],
      ] as const) {
        await seedReply(
          getDb(),
          makeReply({
            id: `2d000000-0000-4000-8000-00000000000${suffix}`,
            reviewId: review.id,
            source: 'internal',
            status: 'publish_failed',
            publicationState: 'ambiguous',
            publicationLastErrorClass: 'ambiguous',
            publicationAttempts: 1,
            publicationCycle: 1,
            reconcileDueAt,
            publishedAt: null,
          }),
          now,
        )
      }
      const replyLookup = createReplyLookupAdapter({
        findByReviewId: (id, orgId) => repo.findByReviewId(id, orgId),
        getCurrentGoogleReplyByReviewId: async () => null,
        findMilestonesByReviewIds: (ids, orgId) =>
          repo.findMilestonesByReviewIds(ids, orgId),
        findCurrentGoogleReplyHeadsByReviewIds: (ids, orgId) =>
          repo.findCurrentGoogleReplyHeadsByReviewIds(ids, orgId),
        findStatesByReviewIds: (ids, orgId) => repo.findStatesByReviewIds(ids, orgId),
        findReviewIdsByReplyStage: (orgId, propertyIds) =>
          repo.findReviewIdsByReplyStage(orgId, propertyIds),
      })
      const itemFor = (review: Review) =>
        buildFixtureItem({
          organizationId: ORG_A,
          propertyId: PROP_A,
          scope: 'reply-stage',
          label: review.externalId,
          status: 'open',
          sourceType: 'review',
          at: now,
          overrides: {
            sourceId: review.id,
            sourceDate: reviewedAt,
            rating: null,
            snippet: null,
          },
        })
      const inbox = createInboxUseCaseDatabase(getPool(), () => now)
      const inboxRepo = inbox.repo
      await inbox.seed(itemFor(checked), itemFor(stopped))
      const staffPublicApi = {
        getAccessiblePropertyIds: async () => null,
        getAssignedPortals: async () => [],
      }
      const manager: AuthContext = {
        organizationId: ORG_A,
        userId: userId('user-rpl-stage-manager'),
        role: 'AccountAdmin',
      }

      const counts = await getInboxQueueCounts({
        repo: inboxRepo,
        staffPublicApi,
        replyLookup,
      })({}, manager)
      const list = getInboxItems({
        repo: inboxRepo,
        staffPublicApi,
        replyLookup,
        viewRepo: {
          getLastInboxView: async () => null,
          stampLastInboxView: async () => now,
        },
        clock: () => now,
      })
      const listed = async (queue: 'waiting' | 'reply') =>
        (await list({ filters: {}, queue }, manager)).items.map((item) => item.sourceId)

      expect(counts).toMatchObject({ waiting: 1, reply: 1, approval: 0 })
      await expect(listed('waiting')).resolves.toEqual([checked.id])
      await expect(listed('reply')).resolves.toEqual([stopped.id])
    })
  })

  describe('publication reconciliation scheduling', () => {
    it('finds due pending observations without widening operator candidates', async () => {
      const { db, repo } = await arrangeRepo()
      const candidates = createPublicationReconciliationCandidateQuery(db)
      const currentDueAt = new Date(now.getTime() - 60 * 1000)
      const pending = await seedReply(
        getDb(),
        makeReply({
          source: 'internal',
          status: 'approved',
          publicationState: 'pending_observation',
          publicationCycle: 2,
          publicationAttempts: 1,
          publicationLastErrorClass: null,
          reconcileDueAt: currentDueAt,
          publishedAt: null,
        }),
      )

      await expect(
        repo.findDuePublicationReconciliationBatch(now, null, 10),
      ).resolves.toEqual([
        expect.objectContaining({
          id: pending.id,
          publicationState: 'pending_observation',
          reconcileDueAt: currentDueAt,
        }),
      ])
      // The operator's explicit --all-ambiguous contract must not be widened
      // by the automatic sweep's inclusion of provider-pending rows.
      await expect(
        candidates.findAmbiguousCandidates({
          dueThrough: now,
          after: null,
          limit: 10,
        }),
      ).resolves.toEqual([])
    })

    it('normalizes millisecond deadlines and preserves keyset progress', async () => {
      const db = getDb()
      const firstReview = await seedReview(db)
      const secondReview = await seedReview(db, {
        id: reviewId('3a000000-0000-0000-0000-000000000002'),
        externalId: 'rpl-ext-002',
      })
      const candidates = createPublicationReconciliationCandidateQuery(db)
      const first = await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000011',
          reviewId: firstReview.id,
          source: 'internal',
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationCycle: 2,
          publicationAttempts: 1,
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: new Date('2025-06-01T11:58:00.123Z'),
          publishedAt: null,
        }),
      )
      const second = await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000012',
          reviewId: secondReview.id,
          source: 'internal',
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationCycle: 3,
          publicationAttempts: 1,
          publicationLastErrorClass: 'ambiguous',
          reconcileDueAt: new Date('2025-06-01T11:58:00.456Z'),
          publishedAt: null,
        }),
      )

      // PostgreSQL can store microsecond precision. Normalize to JavaScript's
      // millisecond Date scale so a returned deadline remains a valid cursor.
      await getPool().query(
        `UPDATE replies
         SET reconcile_due_at = TIMESTAMPTZ '2025-06-01 11:58:00.123456+00'
         WHERE id = $1 AND organization_id = $2`,
        [first.id, ORG_A],
      )

      const firstPage = await candidates.findAmbiguousCandidates({
        dueThrough: now,
        after: null,
        limit: 1,
      })
      expect(firstPage).toHaveLength(1)
      expect(firstPage[0]).toEqual({
        replyId: first.id,
        organizationId: ORG_A,
        publicationState: 'ambiguous',
        reconcileDueAt: new Date('2025-06-01T11:58:00.123Z'),
      })
      expect(firstPage[0]).not.toHaveProperty('text')

      const secondPage = await candidates.findAmbiguousCandidates({
        dueThrough: now,
        after: {
          reconcileDueAt: firstPage[0]!.reconcileDueAt!,
          replyId: firstPage[0]!.replyId,
        },
        limit: 1,
      })
      expect(secondPage).toEqual([expect.objectContaining({ replyId: second.id })])
    })
  })
})
