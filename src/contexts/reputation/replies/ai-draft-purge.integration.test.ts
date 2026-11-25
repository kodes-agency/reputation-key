import {
  replyScopeEffects,
  eraseReviewSourceContent,
} from '#/contexts/reputation/public-api'
// The AI draft purge against real PostgreSQL.
//
// An AI-assisted reply is the unedited output of one AI operation. The purge
// withdraws it when something it was generated from changes. Two things used
// to go wrong, and both are pinned here:
//   - a reply a manager had confirmed (publication_state 'authorized') has an
//     immutable authorization row that restricts its deletion, so the purge's
//     DELETE raised and took the caller's transaction with it: the AI kill
//     switch, a consent or processing-profile change, a Property archive,
//     source erasure and review sync all failed while one such reply waited;
//   - every re-observation of a Review ran the purge, so an AI-assisted draft
//     or a reply awaiting approval vanished the next time sync listed the
//     unchanged Review.
// The fix for the second must not strand a reply: the binding also ends by
// time alone, and the next observation is the only thing that withdraws a
// reply whose time has run out. That, and what a guest edit leaves of a reply
// the worker had already claimed, are pinned here too.
//
// Every reply here is adopted through the real AI draft store and confirmed
// through the real reply command store, so the rows are the ones production
// writes.

import { generateKeyPairSync } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import {
  purgeAiDraftsForAuthorization,
  purgeAiDraftsForControl,
  purgeAiDraftsForOrganization,
  purgeAiDraftsForProfile,
  purgeAiDraftsForProperty,
  purgeAiDraftsForReview,
} from '#/shared/db/ai/ai-draft-purge'
import { properties } from '#/shared/db/schema'
import {
  createAiReplyAdoptionSeeder,
  DAY_MS,
  OPERATION_PROVIDER_PROFILE,
  SOURCE_EPOCH,
  SUGGESTION,
  WITHDRAWN,
  type SeededReply,
} from './ai-reply-adoption-seeder.test-fixtures'
import { organizationId, userId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import { createAiControlAdapter } from '#/contexts/ai/infrastructure/adapters/ai-control.adapter'
import { createPropertyProcessingProfileAdapter } from '#/contexts/ai/analysis/property-processing-profile.adapter.server'
import { propertyArchived } from '#/contexts/property/domain/events'
import { createPropertyLifecycleCommandStore } from '#/contexts/property/lifecycle/transition-store.server'
import type { Reply } from '../domain/review-types'
import { createAiSuggestedDraftStore } from './ai-suggested-draft-store.server'
import { createAtomicReplyCommandStore } from './reply-command-store.server'
import { createReplyRepository } from './reply-repository.server'
import { createReviewRepository } from '../reviews/review-repository.server'
import { createAtomicReviewCommandStore } from '../reviews/review-command-store.server'

const ORG = organizationId('ai-draft-purge-test-org')
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
  {
    resolveSavedFrame: async () => null,
    resolveV2Frame: async () => null,
    resolveLocalFrame: async () => null,
    isCurrentVoice: async () => true,
  },
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
  label: 'ai-draft-purge',
  idPrefix: '75000000',
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
  storedReply,
  replyRows,
  authorizationCount,
  attemptRows,
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
  const head = await controlHead('capability:reply_drafting')
  initialReplyDrafting = head.executionState === 'enabled' ? 'enabled' : 'killed'
  await setReplyDrafting('enabled')
})

afterAll(async () => {
  await clean()
  await setReplyDrafting(initialReplyDrafting)
})

beforeEach(async () => {
  await clean()
  await db.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${ORG}, 'AI draft purge test', ${ORG}, now())
  `)
})

/** The reply is withdrawn and everything that proves it was confirmed stays. */
async function expectWithdrawnWithEvidence(seeded: SeededReply): Promise<void> {
  expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
  expect(await authorizationCount(seeded.reply)).toBe(1)
  expect(await cancellationFacts()).toEqual([withdrawalFact(seeded)])
  expect(await adoptionDisposition(seeded.operationId)).toBe('invalidated')
}

/** The publish worker's claim, with the fences the reply was confirmed under. */
function claimForDispatch(seeded: SeededReply): Promise<Reply | null> {
  return replyCommandStore.markPublicationSending(seeded.reply, {
    propertyId: seeded.property,
    sourceEpoch: SOURCE_EPOCH,
    materialReviewRevision: 1,
    baseObservationRevision: 0,
    providerOperationKey: `ai-draft-purge:${seeded.reply.id}:1`,
  })
}

type PurgeEntryPoint = (tx: Tx, seeded: SeededReply) => Promise<void>

const scope = (seeded: SeededReply) => ({
  organizationId: ORG,
  propertyId: seeded.property,
})

const PURGE_ENTRY_POINTS: ReadonlyArray<readonly [string, PurgeEntryPoint]> = [
  [
    'a Property change',
    (tx, s) => purgeAiDraftsForProperty(tx, scope(s), replyScopeEffects),
  ],
  [
    'a processing-profile change',
    (tx, s) => purgeAiDraftsForProfile(tx, scope(s), replyScopeEffects),
  ],
  [
    'an AI Authorization change',
    (tx, s) => purgeAiDraftsForAuthorization(tx, scope(s), replyScopeEffects),
  ],
  [
    'an Organization closing',
    (tx) => purgeAiDraftsForOrganization(tx, ORG, replyScopeEffects),
  ],
  [
    'a Review change',
    (tx, s) =>
      purgeAiDraftsForReview(
        tx,
        { organizationId: ORG, reviewId: s.review.id },
        replyScopeEffects,
      ),
  ],
  [
    'the global AI control',
    (tx) => purgeAiDraftsForControl(tx, 'global', null, replyScopeEffects),
  ],
  [
    'the provider AI control',
    (tx) =>
      purgeAiDraftsForControl(
        tx,
        'provider_deployment_profile',
        OPERATION_PROVIDER_PROFILE,
        replyScopeEffects,
      ),
  ],
  [
    'the reply-drafting AI control',
    (tx) =>
      purgeAiDraftsForControl(tx, 'capability', 'reply_drafting', replyScopeEffects),
  ],
]

describe.sequential('AI draft purge (real PostgreSQL)', () => {
  describe('a confirmed AI-assisted reply that has not been dispatched', () => {
    it.each(PURGE_ENTRY_POINTS)(
      'the purge for %s withdraws it and keeps the publication evidence',
      async (_label, purge) => {
        const seeded = await seedAiReply('authorized')

        await db.transaction((tx) => purge(tx, seeded))

        await expectWithdrawnWithEvidence(seeded)
      },
    )

    it('lets the AI kill switch apply', async () => {
      const seeded = await seedAiReply('authorized')

      const killed = await setReplyDrafting('killed')
      await setReplyDrafting('enabled')

      expect(killed).toMatchObject({
        executionState: 'killed',
        admissionState: 'draining',
      })
      await expectWithdrawnWithEvidence(seeded)
    })

    it('lets a processing-profile change apply', async () => {
      const seeded = await seedAiReply('authorized')
      await db
        .update(properties)
        .set({ timezone: 'Europe/Sofia' })
        .where(eq(properties.id, seeded.property))

      const refreshed = await profiles.refreshForAi({
        organizationId: ORG,
        propertyId: seeded.property,
      })

      expect(refreshed).toMatchObject({
        status: 'available',
        profile: { profileVersion: 2 },
      })
      await expectWithdrawnWithEvidence(seeded)
    })

    it('lets the Property be archived', async () => {
      const seeded = await seedAiReply('authorized')
      const occurredAt = new Date()
      const recoveryDeadline = new Date(occurredAt.getTime() + 30 * DAY_MS)
      const [property] = await db
        .select({ profileVersion: properties.profileVersion })
        .from(properties)
        .where(eq(properties.id, seeded.property))
        .limit(1)

      const archived = await createPropertyLifecycleCommandStore(
        db,
        replyScopeEffects,
      ).transitionLifecycle({
        organizationId: ORG,
        propertyId: seeded.property,
        expectedSourceEpoch: SOURCE_EPOCH,
        nextSourceEpoch: SOURCE_EPOCH + 1,
        expectedProfileVersion: property!.profileVersion,
        initiatedBy: APPROVER,
        occurredAt,
        from: 'active',
        to: 'archived',
        reason: 'archived_by_manager',
        recoveryDeadline,
        event: propertyArchived({
          organizationId: ORG,
          propertyId: seeded.property,
          userId: APPROVER,
          previousState: 'active',
          sourceEpoch: SOURCE_EPOCH + 1,
          recoveryDeadline,
          occurredAt,
        }),
      })

      expect(archived).toMatchObject({ lifecycleState: 'archived' })
      await expectWithdrawnWithEvidence(seeded)
    })

    it('lets the Review source content be erased', async () => {
      const seeded = await seedAiReply('authorized')

      const erased = await db.transaction((tx) =>
        eraseReviewSourceContent(
          tx,
          {
            reviewId: seeded.review.id,
            organizationId: ORG,
            propertyId: seeded.property,
            sourceEpoch: SOURCE_EPOCH,
            expectedSourceRevision: 1,
            state: 'source_expired',
          },
          replyScopeEffects,
        ),
      )

      expect(erased).toBe(true)
      await expectWithdrawnWithEvidence(seeded)
    })

    // A retryable failure sends the cycle back to `authorized` with one
    // attempt on record. Cancelling it supersedes that attempt, as every other
    // cancellation does, and deletes nothing.
    it('supersedes the attempt of a cycle that was waiting to be retried', async () => {
      const seeded = await seedAiReply('authorized')
      const sending = await claimForDispatch(seeded)
      if (!sending) throw new Error('The publish worker could not claim the cycle')
      const requeued = await replyCommandStore.markPublicationRetryQueued(sending)
      expect(requeued).toMatchObject({
        publicationState: 'authorized',
        publicationAttempts: 1,
      })

      await purgeProperty(seeded)

      await expectWithdrawnWithEvidence(seeded)
      expect(await attemptRows(seeded.reply)).toEqual([
        { attempt_number: 1, outcome: 'superseded' },
      ])
    })

    // What is left is an ordinary empty draft, so the Review can be answered
    // from RepKey again: a Review holds one internal reply, and this is it.
    it('leaves a draft a manager can write a new reply into', async () => {
      const seeded = await seedAiReply('authorized')
      await purgeProperty(seeded)

      const rewritten = await replyRepository.saveDraft(
        await storedReply(seeded),
        { text: 'A reply written by hand' },
        new Date(),
      )

      expect(rewritten).toMatchObject({
        status: 'draft',
        text: 'A reply written by hand',
        aiGenerated: false,
      })
      expect(await authorizationCount(seeded.reply)).toBe(1)
    })

    // The publish job reads the reply before it claims it. A purge that commits
    // in between must leave that copy unclaimable: the withdrawn row no longer
    // claims AI authorship, so the binding check alone would let it through.
    it('cannot be claimed by a publish job that read it before the purge', async () => {
      const seeded = await seedAiReply('authorized')
      await purgeProperty(seeded)

      const claimed = await claimForDispatch(seeded)

      expect(claimed).toBeNull()
      expect(await attemptRows(seeded.reply)).toEqual([])
      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
    })

    it('lets a guest edit be observed, and withdraws it once', async () => {
      const seeded = await seedAiReply('authorized')

      const saved = await observeGuestEdit(seeded)

      expect(saved).toMatchObject({ sourceRevision: 2 })
      await expectWithdrawnWithEvidence(seeded)
    })

    it('stays confirmed when the unchanged Review is observed again', async () => {
      const seeded = await seedAiReply('authorized')

      await observeUnchanged(seeded)

      expect(await replyRows(seeded.review.id)).toMatchObject([
        {
          status: 'approved',
          publication_state: 'authorized',
          text: SUGGESTION,
          authorship: 'ai_assisted',
        },
      ])
      expect(await cancellationFacts()).toEqual([])
    })

    // The publish worker refuses to claim a reply whose binding ran out, so
    // without this it would wait in `authorized` for good.
    it('is withdrawn by the next observation once its time has run out', async () => {
      const seeded = await seedAiReply('authorized')
      await expireAiDraft(seeded)

      await observeUnchanged(seeded)

      await expectWithdrawnWithEvidence(seeded)
    })
  })

  // The worker has claimed these, so the purge itself never touches them: the
  // text may be on Google. A guest edit stops the cycle and returns the reply
  // to draft, and that draft still holds AI text written for the old revision.
  describe('an AI-assisted reply that was dispatched', () => {
    it('is emptied when a guest edit stops its publication, with one notice', async () => {
      const seeded = await seedAiReply('authorized')
      const sending = await claimForDispatch(seeded)
      expect(sending).toMatchObject({ publicationState: 'sending' })

      const saved = await observeGuestEdit(seeded)

      expect(saved).toMatchObject({ sourceRevision: 2 })
      expect(await replyRows(seeded.review.id)).toEqual([WITHDRAWN])
      expect(await authorizationCount(seeded.reply)).toBe(1)
      expect(await attemptRows(seeded.reply)).toEqual([
        { attempt_number: 1, outcome: 'superseded' },
      ])
      expect(await cancellationFacts()).toEqual([
        { ...withdrawalFact(seeded), cause: 'source_changed' },
      ])
    })

    it('keeps its text when the unchanged Review is observed after its time ran out', async () => {
      const seeded = await seedAiReply('authorized')
      const sending = await claimForDispatch(seeded)
      expect(sending).toMatchObject({ publicationState: 'sending' })
      await expireAiDraft(seeded)

      await observeUnchanged(seeded)

      expect(await replyRows(seeded.review.id)).toMatchObject([
        {
          status: 'approved',
          publication_state: 'sending',
          text: SUGGESTION,
          authorship: 'ai_assisted',
        },
      ])
      expect(await cancellationFacts()).toEqual([])
    })
  })

  describe('replies the purge must leave alone', () => {
    it('keeps a reply the manager edited, another Property and a dispatched reply', async () => {
      const edited = await seedAiReply('draft')
      const elsewhere = await seedAiReply('draft')
      const dispatched = await seedAiReply('authorized', edited.property)
      // A draft save is a manager writing the text: the store records the
      // reply as human-authored.
      const typedOver = await replyRepository.saveDraft(
        edited.reply,
        { text: 'Rewritten by a manager' },
        new Date(),
      )
      if (!typedOver) throw new Error('The AI-assisted draft could not be typed over')
      await db.execute(sql`
        UPDATE replies SET publication_state = 'sending'
        WHERE id = ${dispatched.reply.id}::uuid AND organization_id = ${ORG}
      `)

      await purgeProperty(edited)

      expect(await replyRows(edited.review.id)).toMatchObject([
        { status: 'draft', text: 'Rewritten by a manager', authorship: 'human' },
      ])
      expect(await replyRows(elsewhere.review.id)).toMatchObject([
        { status: 'draft', text: SUGGESTION, authorship: 'ai_assisted' },
      ])
      expect(await replyRows(dispatched.review.id)).toMatchObject([
        {
          status: 'approved',
          publication_state: 'sending',
          text: SUGGESTION,
          authorship: 'ai_assisted',
        },
      ])
      expect(await cancellationFacts()).toEqual([])
    })
  })
})
