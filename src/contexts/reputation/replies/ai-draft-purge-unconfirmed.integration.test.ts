import { replyScopeEffects } from '#/contexts/reputation/public-api'
// The AI draft purge against real PostgreSQL, for replies nobody has
// confirmed and for replies back in draft after a cancelled publication cycle.
// The confirmed and dispatched replies are in ai-draft-purge.integration.test.ts.
//
// A reply nobody confirmed is deleted by the purge, and a re-observation of the
// unchanged Review must not take it away; the binding also ends by time alone,
// and the next observation is what withdraws a reply whose time has run out. A
// draft that came back from a cancelled cycle is emptied, not deleted, because
// its publication authorization still references it.
//
// Every reply here is adopted through the real AI draft store and confirmed
// through the real reply command store, so the rows are the ones production
// writes.

import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { purgeAiDraftsForProperty } from '#/shared/db/ai/ai-draft-purge'
import {
  createAiReplyAdoptionSeeder,
  DAY_MS,
  SUGGESTION,
  WITHDRAWN,
  type SeededReply,
} from './ai-reply-adoption-seeder.test-fixtures'
import { organizationId, userId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { createAiControlAdapter } from '#/contexts/ai/infrastructure/adapters/ai-control.adapter'
import { createPropertyProcessingProfileAdapter } from '#/contexts/ai/analysis/property-processing-profile.adapter.server'
import { reviewReplyPublicationCancelled } from '../domain/review-events'
import { createAiSuggestedDraftStore } from './ai-suggested-draft-store.server'
import { createAtomicReplyCommandStore } from './reply-command-store.server'
import { createReplyRepository } from './reply-repository.server'
import { createReviewRepository } from '../reviews/review-repository.server'
import { createAtomicReviewCommandStore } from '../reviews/review-command-store.server'

const ORG = organizationId('ai-draft-purge-unconfirmed-org')
const SUBMITTER = userId('ai-draft-purge-submitter')
const APPROVER = userId('ai-draft-purge-approver')
const OPERATOR = 'ai-draft-purge-operator'

const { privateKey, publicKey } = generateKeyPairSync('ed25519')

const db = getDb()
const reviewRepository = createReviewRepository(
  db,
  () => new Date(),
  undefined,
  replyScopeEffects,
)
const replyRepository = createReplyRepository(db, () => new Date())
const replyCommandStore = createAtomicReplyCommandStore(
  db,
  () => new Date(),
  async () => true,
  replyScopeEffects,
)
const draftStore = createAiSuggestedDraftStore(
  db,
  new Map([['provenance-v1', publicKey]]),
  { isCurrentAiReplyBrandProfile: async () => true },
)
const profiles = createPropertyProcessingProfileAdapter(
  db,
  () => new Date(),
  replyScopeEffects,
)
const seeder = createAiReplyAdoptionSeeder({
  db,
  organizationId: ORG,
  submitter: SUBMITTER,
  approver: APPROVER,
  operator: OPERATOR,
  label: 'ai-draft-purge-unconfirmed',
  idPrefix: '75000001',
  privateKey,
  reviewRepository,
  reviewCommandStore: createAtomicReviewCommandStore(
    db,
    () => new Date(),
    undefined,
    undefined,
    replyScopeEffects,
  ),
  replyRepository,
  draftStore,
  replyCommandStore,
  profiles,
  control: createAiControlAdapter(db, replyScopeEffects),
})
const {
  clean,
  controlHead,
  setReplyDrafting,
  seedAiReply,
  submitForApproval,
  storedReply,
  replyRows,
  authorizationCount,
  cancellationFacts,
  adoptionDisposition,
  withdrawalFact,
  expireAiDraft,
  observeUnchanged,
  observeGuestEdit,
} = seeder

const purgeProperty = (seeded: Pick<SeededReply, 'property'>): Promise<void> =>
  db.transaction((tx) =>
    purgeAiDraftsForProperty(
      tx,
      { organizationId: ORG, propertyId: seeded.property },
      replyScopeEffects,
    ),
  )

let initialReplyDrafting: 'enabled' | 'killed'

beforeAll(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  const head = await controlHead('capability:reply_drafting')
  initialReplyDrafting = head.executionState === 'enabled' ? 'enabled' : 'killed'
  await setReplyDrafting('enabled')
})

afterAll(async () => {
  await clean()
  await setReplyDrafting(initialReplyDrafting)
  clearEventSchemas()
})

beforeEach(async () => {
  await clean()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'AI draft purge test', ${ORG}, now())
  `)
})

describe.sequential('AI draft purge (real PostgreSQL)', () => {
  describe('an AI-assisted reply nobody has confirmed', () => {
    it.each(['draft', 'pending_approval'] as const)(
      'survives another observation of the unchanged Review (%s)',
      async (stage) => {
        const seeded = await seedAiReply(stage)

        await observeUnchanged(seeded)

        expect(await replyRows(seeded.review.id)).toMatchObject([
          { status: stage, text: SUGGESTION, authorship: 'ai_assisted' },
        ])
        expect(await adoptionDisposition(seeded.operationId)).toBe('adopted')
        await expect(
          draftStore.assertCurrentBinding({
            organizationId: ORG,
            replyId: seeded.reply.id,
          }),
        ).resolves.toBe('current')
      },
    )

    // The binding also ends by time alone, and no transaction marks that
    // moment. Once it has, nobody can approve, reject or rewrite the reply, and
    // a Review holds one internal reply, so the Review could not be answered
    // from RepKey. The next observation is what takes it away.
    it.each([
      ['draft', 0],
      ['pending_approval', 1],
    ] as const)(
      'is withdrawn by the next observation once its time has run out (%s)',
      async (stage, expectedFacts) => {
        const seeded = await seedAiReply(stage)
        await expireAiDraft(seeded)
        await expect(
          draftStore.assertCurrentBinding({
            organizationId: ORG,
            replyId: seeded.reply.id,
          }),
        ).resolves.toBe('stale')

        await observeUnchanged(seeded)

        expect(await replyRows(seeded.review.id)).toEqual([])
        expect(await cancellationFacts()).toEqual(
          Array.from({ length: expectedFacts }, () => withdrawalFact(seeded)),
        )
      },
    )

    // Older provider evidence is recorded and never applied, but it is still
    // sync seeing the Review, and a Review Google keeps answering with an old
    // version would otherwise never release the reply.
    it('is withdrawn once its time has run out even by an out-of-order observation', async () => {
      const seeded = await seedAiReply('pending_approval')
      await expireAiDraft(seeded)

      await observeUnchanged(seeded, {
        sourceUpdatedAt: new Date(seeded.review.sourceUpdatedAt!.getTime() - DAY_MS),
      })

      const latest = await db.execute(sql`
        SELECT comparison_result
        FROM review_source_observations
        WHERE review_id = ${seeded.review.id}::uuid AND organization_id = ${ORG}
        ORDER BY observation_sequence DESC
        LIMIT 1
      `)
      expect(latest.rows).toEqual([{ comparison_result: 'out_of_order_ignored' }])
      expect(await replyRows(seeded.review.id)).toEqual([])
      expect(await cancellationFacts()).toEqual([withdrawalFact(seeded)])
    })

    // The edit is its own record: `review.updated` carries the new revision and
    // reopens the Inbox item. Only a reply someone was waiting on needs a fact
    // of its own.
    it.each([
      ['draft', 0],
      ['pending_approval', 1],
    ] as const)(
      'is withdrawn when the guest edits the Review (%s)',
      async (stage, expectedFacts) => {
        const seeded = await seedAiReply(stage)

        const saved = await observeGuestEdit(seeded)

        expect(saved).toMatchObject({ sourceRevision: 2 })
        expect(await replyRows(seeded.review.id)).toEqual([])
        expect(await cancellationFacts()).toEqual(
          Array.from({ length: expectedFacts }, () => withdrawalFact(seeded)),
        )
        expect(await adoptionDisposition(seeded.operationId)).toBe('invalidated')
      },
    )

    it('is deleted without a notice while it is still a draft', async () => {
      const seeded = await seedAiReply('draft')

      await purgeProperty(seeded)

      expect(await replyRows(seeded.review.id)).toEqual([])
      expect(await cancellationFacts()).toEqual([])
      expect(await adoptionDisposition(seeded.operationId)).toBe('invalidated')
    })

    it('is deleted, and the people waiting on it are told, once it was submitted', async () => {
      const seeded = await seedAiReply('pending_approval')

      await purgeProperty(seeded)

      expect(await replyRows(seeded.review.id)).toEqual([])
      expect(await cancellationFacts()).toEqual([withdrawalFact(seeded)])
    })
  })

  describe('an AI-assisted reply back in draft after a cancelled cycle', () => {
    /** Confirm a reply, then stop its cycle the way a policy stop does. */
    async function seedCancelledAiReply(): Promise<SeededReply> {
      const seeded = await seedAiReply('authorized')
      const now = new Date()
      const cancelled = await replyCommandStore.cancelPublications([
        {
          reply: seeded.reply,
          event: reviewReplyPublicationCancelled({
            replyId: seeded.reply.id,
            reviewId: seeded.review.id,
            propertyId: seeded.property,
            organizationId: ORG,
            authorId: SUBMITTER,
            cause: 'policy',
            occurredAt: now,
          }),
          now,
        },
      ])
      if (cancelled !== 1) throw new Error('The publication cycle was not cancelled')
      return seeded
    }

    const policyFact = (seeded: SeededReply) => ({
      ...withdrawalFact(seeded),
      cause: 'policy',
    })

    it('is emptied, not deleted, because its authorization still references it', async () => {
      const seeded = await seedCancelledAiReply()
      expect(await replyRows(seeded.review.id)).toMatchObject([
        { status: 'draft', publication_state: 'cancelled', text: SUGGESTION },
      ])

      await purgeProperty(seeded)

      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
      expect(await authorizationCount(seeded.reply)).toBe(1)
      expect(await cancellationFacts()).toEqual([policyFact(seeded)])
    })

    // The emptying leaves the draft a draft, in the same cancelled cycle. A
    // Submit that read the AI text before the purge names the reply it read,
    // state revision included, so it does not hand an approver a reply with
    // no text.
    it('is not submitted, blank, by a Submit that read it before the purge', async () => {
      const seeded = await seedCancelledAiReply()
      const readBySubmit = await storedReply(seeded)
      await purgeProperty(seeded)

      const submitted = await submitForApproval(readBySubmit, seeded.property, new Date())

      expect(submitted).toBeNull()
      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
    })

    it('tells the people waiting on it when it had been submitted again', async () => {
      const seeded = await seedCancelledAiReply()
      const now = new Date()
      const resubmitted = await submitForApproval(
        await storedReply(seeded),
        seeded.property,
        now,
      )
      expect(resubmitted).toMatchObject({ status: 'pending_approval' })

      await purgeProperty(seeded)

      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
      expect(await cancellationFacts()).toEqual([
        withdrawalFact(seeded),
        policyFact(seeded),
      ])
    })
  })
})
