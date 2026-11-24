import { seedReply } from './reply-seed.test-fixtures'
// Reply repository writes — integration tests against real Postgres.
// Tenant isolation test is NON-NEGOTIABLE.
import { describe, it, expect } from 'vitest'
import { eq } from 'drizzle-orm'
import { createReplyRepository } from './reply-repository.server'
import { getDb } from '#/shared/db'
import { replies } from '#/shared/db/schema/review.schema'
import { reviewId } from '#/shared/domain/ids'
import {
  ORG_A,
  ORG_B,
  PROP_B,
  arrangeRepo,
  makeReply,
  seedReview,
  useReplyRepositoryDatabase,
} from './reply-repository.test-fixtures'

const getPool = useReplyRepositoryDatabase()

describe.sequential('replyRepository (integration)', () => {
  describe('findByReviewId', () => {
    it('inserts and retrieves a reply', async () => {
      const { repo } = await arrangeRepo()
      const reply = makeReply()

      const created = await seedReply(getDb(), reply)
      const found = await repo.findByReviewId(reply.reviewId, ORG_A)

      expect(found).toHaveLength(1)
      expect(found[0]!.id).toBe(created.id)
      expect(found[0]!.text).toBe('Thank you!')
    })

    it('persists a library template as a human-authored manual draft', async () => {
      const { db } = await arrangeRepo()
      const draft = makeReply({
        id: '2a000000-0000-4000-8000-000000000099',
        status: 'draft',
        source: 'internal',
        createdBy: 'manager-1' as never,
        aiGenerated: false,
        templateLayer: 'account',
        templateRef: 'template:73000000-0000-4000-8000-000000000001',
        templateRevision: 3,
        templateWordingKey: 'w1',
        publishedAt: null,
      })

      await seedReply(getDb(), draft)
      const [persisted] = await db
        .select({
          aiGenerated: replies.aiGenerated,
          authorship: replies.authorship,
          templateLayer: replies.templateLayer,
          templateRef: replies.templateRef,
          templateRevision: replies.templateRevision,
          templateWordingKey: replies.templateWordingKey,
        })
        .from(replies)
        .where(eq(replies.id, draft.id))

      expect(persisted).toEqual({
        aiGenerated: false,
        authorship: 'human',
        templateLayer: 'account',
        templateRef: 'template:73000000-0000-4000-8000-000000000001',
        templateRevision: 3,
        templateWordingKey: 'w1',
      })
    })

    it('returns empty array for review with no replies', async () => {
      const { repo } = await arrangeRepo()
      const found = await repo.findByReviewId(
        reviewId('00000000-0000-0000-0000-000000000999'),
        ORG_A,
      )
      expect(found).toHaveLength(0)
    })
  })

  describe('state revision', () => {
    it('increments the durable state revision on every internal reply update', async () => {
      await arrangeRepo()
      const reply = makeReply({ text: 'Original reply', source: 'internal' })

      const created = await seedReply(getDb(), reply)
      const updated = await seedReply(getDb(), { ...reply, text: 'Updated reply' })

      expect(created.stateRevision).toBe(1)
      expect(updated.stateRevision).toBe(2)
    })
  })

  describe('tenant isolation', () => {
    it('keeps replies isolated across tenant-owned reviews', async () => {
      const db = getDb()
      const reviewA = await seedReview(db)
      const reviewB = await seedReview(db, {
        id: reviewId('3b000000-0000-0000-0000-000000000002'),
        organizationId: ORG_B,
        propertyId: PROP_B,
        externalId: 'rpl-ext-tenant-b',
      })
      const repo = createReplyRepository(db, () => new Date())

      await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000001',
          reviewId: reviewA.id,
          organizationId: ORG_A,
          text: 'Reply from org A',
        }),
      )
      await seedReply(
        getDb(),
        makeReply({
          id: '2a000000-0000-0000-0000-000000000002',
          organizationId: ORG_B,
          reviewId: reviewB.id,
          text: 'Reply from org B',
          status: 'draft',
        }),
      )

      const foundA = await repo.findByReviewId(reviewA.id, ORG_A)
      const foundB = await repo.findByReviewId(reviewB.id, ORG_B)
      const crossTenantA = await repo.findByReviewId(reviewA.id, ORG_B)
      const crossTenantB = await repo.findByReviewId(reviewB.id, ORG_A)

      expect(foundA).toHaveLength(1)
      expect(foundB).toHaveLength(1)
      expect(foundA[0]?.text).toBe('Reply from org A')
      expect(foundB[0]?.text).toBe('Reply from org B')
      expect(crossTenantA).toEqual([])
      expect(crossTenantB).toEqual([])
    })
  })

  // The draft writes carry their command's precondition as the guard of the
  // SQL statement (reputation/domain/reply-command-preconditions.ts), so a caller that
  // skipped the use case, or read the reply before it moved, changes nothing.
  const internalDraft = (overrides: Parameters<typeof makeReply>[0] = {}) =>
    makeReply({
      source: 'internal',
      status: 'draft',
      publishedAt: null,
      publicationState: null,
      publicationCycle: 0,
      publicationAttempts: 0,
      publicationLastErrorClass: null,
      reconcileDueAt: null,
      ...overrides,
    })

  const NOT_A_DRAFT_OR_FAILED_REPLY = [
    ['waiting for approval', { status: 'pending_approval' }],
    ['being published', { status: 'approved', publicationState: 'authorized' }],
    [
      'accepted by Google',
      { status: 'approved', publicationState: 'pending_observation' },
    ],
    ['published', { status: 'published', publicationState: 'published' }],
    [
      'a draft with an open publication',
      { status: 'draft', publicationState: 'sending' },
    ],
  ] as const

  describe('createDraft', () => {
    it('inserts the first draft of a review', async () => {
      const { repo } = await arrangeRepo()

      const created = await repo.createDraft(internalDraft({ text: 'First draft' }))

      expect(created).toMatchObject({
        status: 'draft',
        text: 'First draft',
        publicationState: null,
        publicationCycle: 0,
      })
    })

    it('never rewrites a reply the review already has', async () => {
      const { repo } = await arrangeRepo()
      const confirmed = await seedReply(
        getDb(),
        internalDraft({
          status: 'approved',
          publicationState: 'authorized',
          publicationCycle: 1,
          text: 'Confirmed text',
        }),
      )

      await expect(
        repo.createDraft(
          internalDraft({ id: '2a000000-0000-0000-0000-000000000002', text: 'Late' }),
        ),
      ).resolves.toBeNull()

      expect(await repo.findInternalByReviewId(confirmed.reviewId, ORG_A)).toEqual(
        confirmed,
      )
    })

    it('refuses to insert anything but a draft with no publication', async () => {
      const { repo } = await arrangeRepo()

      for (const reply of [
        internalDraft({ status: 'approved' }),
        internalDraft({ publicationCycle: 1 }),
        internalDraft({ publicationState: 'authorized' }),
      ]) {
        await expect(repo.createDraft(reply)).rejects.toMatchObject({
          _tag: 'ReviewError',
          code: 'invalid_input',
        })
      }
      expect(await repo.findByReviewId(internalDraft().reviewId, ORG_A)).toHaveLength(0)
    })
  })

  describe('saveDraft', () => {
    it('rewrites a draft, and a rejected reply as a draft with its rejection cleared', async () => {
      const { repo } = await arrangeRepo()
      const draft = await seedReply(getDb(), internalDraft({ text: 'Original' }))

      const saved = await repo.saveDraft(draft, {
        text: 'Rewritten',
        replyLanguageTag: 'en-Latn-GB',
      })
      expect(saved).toMatchObject({
        status: 'draft',
        text: 'Rewritten',
        replyLanguageTag: 'en-Latn-GB',
      })

      await getPool().query(
        `UPDATE replies SET status = 'rejected', rejection_reason = 'Too terse'
          WHERE id = $1`,
        [draft.id],
      )
      const rejected = await repo.findById(draft.id, ORG_A)
      expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'Too terse' })

      await expect(
        repo.saveDraft(rejected!, { text: 'Friendlier' }),
      ).resolves.toMatchObject({
        status: 'draft',
        text: 'Friendlier',
        rejectionReason: null,
        rejectedBy: null,
      })
    })

    it('rewrites a draft whose publication was cancelled', async () => {
      const { repo } = await arrangeRepo()
      const cancelled = await seedReply(
        getDb(),
        internalDraft({ publicationState: 'cancelled', publicationCycle: 1 }),
      )

      await expect(
        repo.saveDraft(cancelled, { text: 'Second thoughts' }),
      ).resolves.toMatchObject({
        status: 'draft',
        text: 'Second thoughts',
        publicationState: 'cancelled',
        publicationCycle: 1,
      })
    })

    it.each([
      ...NOT_A_DRAFT_OR_FAILED_REPLY,
      ['failed', { status: 'publish_failed', publicationState: 'terminal' }],
    ] as const)('changes nothing for a reply that is %s', async (_name, state) => {
      const { repo } = await arrangeRepo()
      const stored = await seedReply(
        getDb(),
        internalDraft({ ...state, publicationCycle: 1, text: 'Confirmed text' }),
      )

      await expect(repo.saveDraft(stored, { text: 'Stale tab' })).resolves.toBeNull()

      expect(await repo.findById(stored.id, ORG_A)).toEqual(stored)
    })

    it('loses to a reply that was submitted after the caller read it', async () => {
      const { repo } = await arrangeRepo()
      const draft = await seedReply(getDb(), internalDraft({ text: 'Original' }))
      await getPool().query(
        `UPDATE replies SET status = 'pending_approval' WHERE id = $1`,
        [draft.id],
      )
      const submitted = await repo.findById(draft.id, ORG_A)

      await expect(repo.saveDraft(draft, { text: 'Stale tab' })).resolves.toBeNull()

      expect(await repo.findById(draft.id, ORG_A)).toEqual(submitted)
    })

    it('does not rewrite a reply through another organization', async () => {
      const { repo } = await arrangeRepo()
      const draft = await seedReply(getDb(), internalDraft({ text: 'Original' }))

      await expect(
        repo.saveDraft({ ...draft, organizationId: ORG_B }, { text: 'Intruder' }),
      ).resolves.toBeNull()

      expect(await repo.findById(draft.id, ORG_A)).toEqual(draft)
    })
  })

  describe('deleteDraft', () => {
    it.each(['draft', 'rejected'] as const)(
      'deletes a %s reply that was never authorized',
      async (status) => {
        const { repo } = await arrangeRepo()
        const reply = await seedReply(getDb(), internalDraft({ status }))

        await expect(repo.deleteDraft(reply)).resolves.toBe(true)

        expect(await repo.findByReviewId(reply.reviewId, ORG_A)).toHaveLength(0)
      },
    )

    it.each([
      ...NOT_A_DRAFT_OR_FAILED_REPLY,
      [
        'an uncertain failure',
        {
          status: 'publish_failed',
          publicationState: 'ambiguous',
          publicationLastErrorClass: 'ambiguous',
        },
      ],
      [
        'a terminal failure whose outcome is unknown',
        {
          status: 'publish_failed',
          publicationState: 'terminal',
          publicationLastErrorClass: 'ambiguous',
        },
      ],
      ['a cancelled draft', { status: 'draft', publicationState: 'cancelled' }],
      ['a rejected reply that was confirmed before', { status: 'rejected' }],
    ] as const)('keeps a reply that is %s', async (_name, state) => {
      const { repo } = await arrangeRepo()
      const stored = await seedReply(
        getDb(),
        internalDraft({ ...state, publicationCycle: 1 }),
      )

      await expect(repo.deleteDraft(stored)).resolves.toBe(false)

      expect(await repo.findById(stored.id, ORG_A)).toEqual(stored)
    })

    it('clears a settled failed reply and keeps its row for publication evidence', async () => {
      const { repo } = await arrangeRepo()
      const failed = await seedReply(
        getDb(),
        internalDraft({
          status: 'publish_failed',
          publicationState: 'terminal',
          publicationCycle: 1,
          publicationLastErrorClass: 'retryable',
        }),
      )

      await expect(repo.deleteDraft(failed)).resolves.toEqual({
        id: failed.id,
        stateRevision: failed.stateRevision + 1,
      })

      const cleared = await repo.findById(failed.id, ORG_A)
      expect(cleared).toMatchObject({
        id: failed.id,
        text: '',
        status: 'draft',
        publicationState: 'cancelled',
        publicationCycle: 1,
        publicationLastErrorClass: null,
      })
      expect(cleared!.stateRevision).toBeGreaterThan(failed.stateRevision)
      await expect(repo.deleteDraft(failed)).resolves.toBe(false)
      expect(await repo.findById(failed.id, ORG_A)).toEqual(cleared)
    })

    it('keeps a reply that was submitted after the caller read it', async () => {
      const { repo } = await arrangeRepo()
      const draft = await seedReply(getDb(), internalDraft())
      await getPool().query(
        `UPDATE replies SET status = 'pending_approval' WHERE id = $1`,
        [draft.id],
      )

      await expect(repo.deleteDraft(draft)).resolves.toBe(false)

      expect(await repo.findById(draft.id, ORG_A)).toMatchObject({
        status: 'pending_approval',
      })
    })
  })

  describe('cross-org delete protection', () => {
    it('deleteDraft through another organization does not delete the reply', async () => {
      const { repo } = await arrangeRepo()
      const reply = await seedReply(getDb(), internalDraft())

      // The same reply, addressed through ORG_B.
      await expect(repo.deleteDraft({ ...reply, organizationId: ORG_B })).resolves.toBe(
        false,
      )

      // Reply should still exist for ORG_A
      const found = await repo.findByReviewId(reply.reviewId, ORG_A)
      expect(found).toHaveLength(1)
      expect(found[0]!.id).toBe(reply.id)
    })
  })
})
