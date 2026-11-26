import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { eraseReviewSourceContent } from '#/contexts/reputation/content/store.server'
import { canonicalizeRfc8785 } from '#/shared/merchant-ai-notice-contract'
import { sign } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { getPool } from '#/shared/db/pool'
import { aiOperations, replies } from '#/shared/db/schema'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import { createAiReplyAdoptionFixture } from './ai-reply-adoption.test-fixtures'
import { eraseKeepingContentClock } from '#/shared/testing/review-tombstone-fixtures'
import type { AiReplyProvenancePayload } from '#/shared/reply/ai-reply-provenance'
import { createReviewRepository } from '../reviews/review-repository.server'
import { createAiSuggestedDraftStore } from './ai-suggested-draft-store.server'

const NOW = new Date()
const ORGANIZATION_ID = organizationId('ai-suggested-draft-binding-org')
const PROPERTY_ID = propertyId('74000000-0000-4000-8000-000000000501')
const REVIEW_ID = reviewId('74000000-0000-4000-8000-000000000502')
const ACTOR_USER_ID = userId('ai-suggested-draft-binding-user')
const SOURCE_EPOCH = 2
const SOURCE_REVISION = 1
const SUGGESTION = 'Thank you for sharing your experience.'

describe.sequential('AI suggested draft acceptance (real PostgreSQL)', () => {
  const db = getDb()
  const {
    publicKey,
    privateKey,
    provenancePayload,
    provenanceToken,
    reviewFixture,
    transitionReplyControl,
    readReplyControl,
    seedSucceededReplyOperation,
    seedEnabledProperty,
    clear,
  } = createAiReplyAdoptionFixture(db, {
    organizationId: ORGANIZATION_ID,
    propertyId: PROPERTY_ID,
    reviewId: REVIEW_ID,
    actorUserId: ACTOR_USER_ID,
    lineageId: '74000000-0000-4000-8000-000000000503',
    sourceEpoch: SOURCE_EPOCH,
    sourceRevision: SOURCE_REVISION,
    suggestion: SUGGESTION,
    now: NOW,
    label: 'suggested-draft-binding',
  })
  const store = createAiSuggestedDraftStore(
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
  let initialReplyControl: Awaited<ReturnType<typeof readReplyControl>> | undefined

  /** Signs a payload the signer's schema would refuse, as a token minted elsewhere. */
  function signWithoutValidation(
    rawPayload: Readonly<Record<string, unknown>>,
    version: AiReplyProvenancePayload['version'],
  ): string {
    const canonical = canonicalizeRfc8785(rawPayload)
    const signature = sign(
      null,
      Buffer.from(`repkey-${version}\0${canonical}`, 'utf8'),
      privateKey,
    )
    return `rk_ai_reply_v4.${Buffer.from(canonical, 'utf8').toString('base64url')}.${signature.toString('base64url')}`
  }

  beforeAll(async () => {
    await clear()
    initialReplyControl = await readReplyControl()
    await transitionReplyControl('enabled', 'accepting')
    await seedEnabledProperty({ propertySlug: 'ai-suggested-draft-binding-property' })
    await createReviewRepository(
      db,
      () => new Date(),
      undefined,
      replyScopeEffects,
    ).upsert(reviewFixture(REVIEW_ID, 'ai-suggested-draft-binding-review'))
  })

  afterAll(async () => {
    await clear()
    if (initialReplyControl) {
      await transitionReplyControl(
        initialReplyControl.executionState,
        initialReplyControl.admissionState,
      )
    }
  })

  // Only the first case isolates the store's state check: its Review keeps the
  // clock the store used to test alone. The second is a regression case: the
  // erase clears the clock today, so the clock fence refuses it as well.
  it.each([
    {
      label: 'a Review erased before the content clock was cleared',
      review: reviewId('74000000-0000-4000-8000-0000000000a1'),
      operation: '74000000-0000-4000-8000-000000000009',
      permit: '74000000-0000-4000-8000-000000000109',
      erase: (id: ReturnType<typeof reviewId>) =>
        eraseKeepingContentClock(getPool(), {
          id,
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
        }),
    },
    {
      label: 'a Review erased today',
      review: reviewId('74000000-0000-4000-8000-0000000000a2'),
      operation: '74000000-0000-4000-8000-000000000010',
      permit: '74000000-0000-4000-8000-000000000110',
      erase: (id: ReturnType<typeof reviewId>) =>
        db.transaction(async (tx) => {
          await eraseReviewSourceContent(
            tx,
            {
              reviewId: id,
              organizationId: ORGANIZATION_ID,
              propertyId: PROPERTY_ID,
              sourceEpoch: SOURCE_EPOCH,
              expectedSourceRevision: SOURCE_REVISION,
              state: 'provider_deleted',
            },
            replyScopeEffects,
          )
        }),
    },
  ])(
    'refuses to adopt a suggestion for $label and writes no draft',
    async ({ review, operation, permit, erase }) => {
      await createReviewRepository(
        db,
        () => new Date(),
        undefined,
        replyScopeEffects,
      ).upsert(reviewFixture(review, `ai-suggested-draft-erased-${operation}`))
      await seedSucceededReplyOperation({
        operationId: operation,
        permitId: permit,
        sourceRevision: SOURCE_REVISION,
        baseReplyStateRevision: 0,
        reviewId: review,
      })
      // The suggestion was generated while the review was live; Google then
      // deleted it and the sync erased the row before the manager clicked.
      await erase(review)

      await expect(
        store.accept({
          organizationId: ORGANIZATION_ID,
          propertyId: PROPERTY_ID,
          reviewId: review,
          actorUserId: ACTOR_USER_ID,
          text: SUGGESTION,
          provenanceToken: provenanceToken({
            operationId: operation,
            reviewId: review,
            baseReplyStateRevision: 0,
          }),
          now: NOW,
        }),
      ).resolves.toEqual({ status: 'rejected', reason: 'stale' })

      await expect(
        db.select({ id: replies.id }).from(replies).where(eq(replies.reviewId, review)),
      ).resolves.toEqual([])
      await expect(
        db
          .select({ disposition: aiOperations.replyAdoptionDisposition })
          .from(aiOperations)
          .where(eq(aiOperations.id, operation)),
      ).resolves.toEqual([{ disposition: 'none' }])
    },
  )

  describe('execution binding', () => {
    const PERMIT_REVIEW = reviewId('74000000-0000-4000-8000-0000000000b1')
    const LEGACY_REVIEW = reviewId('74000000-0000-4000-8000-0000000000b2')
    const PERMIT_OPERATION = '74000000-0000-4000-8000-000000000020'
    const PERMIT = '74000000-0000-4000-8000-000000000120'
    const OTHER_OPERATION = '74000000-0000-4000-8000-000000000021'
    const OTHER_PERMIT = '74000000-0000-4000-8000-000000000121'
    const LEGACY_OPERATION = '74000000-0000-4000-8000-000000000022'
    const LEGACY_PERMIT = '74000000-0000-4000-8000-000000000122'

    const acceptFor = (
      review: ReturnType<typeof reviewId>,
      provenanceToken: string,
      input: Partial<{
        organizationId: ReturnType<typeof organizationId>
        propertyId: ReturnType<typeof propertyId>
        reviewId: ReturnType<typeof reviewId>
        actorUserId: ReturnType<typeof userId>
      }> = {},
    ) =>
      store.accept({
        organizationId: ORGANIZATION_ID,
        propertyId: PROPERTY_ID,
        reviewId: review,
        actorUserId: ACTOR_USER_ID,
        text: SUGGESTION,
        provenanceToken,
        now: NOW,
        ...input,
      })

    const adoptionOf = async (
      review: ReturnType<typeof reviewId>,
      operation: string,
    ) => ({
      replies: await db
        .select({ id: replies.id })
        .from(replies)
        .where(eq(replies.reviewId, review)),
      operation: await db
        .select({ disposition: aiOperations.replyAdoptionDisposition })
        .from(aiOperations)
        .where(eq(aiOperations.id, operation)),
    })

    beforeAll(async () => {
      const repository = createReviewRepository(
        db,
        () => new Date(),
        undefined,
        replyScopeEffects,
      )
      await repository.upsert(reviewFixture(PERMIT_REVIEW, 'ai-suggested-draft-permit'))
      await repository.upsert(reviewFixture(LEGACY_REVIEW, 'ai-suggested-draft-legacy'))
      // The delivering execution was retried once.
      await seedSucceededReplyOperation({
        operationId: PERMIT_OPERATION,
        permitId: PERMIT,
        sourceRevision: SOURCE_REVISION,
        baseReplyStateRevision: 0,
        reviewId: PERMIT_REVIEW,
        executionAttempt: 2,
      })
      await seedSucceededReplyOperation({
        operationId: OTHER_OPERATION,
        permitId: OTHER_PERMIT,
        sourceRevision: SOURCE_REVISION,
        baseReplyStateRevision: 0,
        reviewId: PERMIT_REVIEW,
      })
      await seedSucceededReplyOperation({
        operationId: LEGACY_OPERATION,
        permitId: LEGACY_PERMIT,
        sourceRevision: SOURCE_REVISION,
        baseReplyStateRevision: 0,
        reviewId: LEGACY_REVIEW,
      })
    })

    it('adopts a permit-bound draft only for the permit and attempt that delivered it', async () => {
      const bound = (
        binding: Readonly<{ executionPermitId: string; executionAttempt: number }>,
        overrides: Partial<AiReplyProvenancePayload> = {},
      ) =>
        provenanceToken({
          operationId: PERMIT_OPERATION,
          reviewId: PERMIT_REVIEW,
          baseReplyStateRevision: 0,
          ...binding,
          ...overrides,
        })
      const delivered = { executionPermitId: PERMIT, executionAttempt: 2 }
      const otherOrganization = organizationId('ai-suggested-draft-other-org')
      const otherProperty = propertyId('74000000-0000-4000-8000-0000000000b9')
      const otherActor = userId('ai-suggested-draft-other-user')

      const refusals = [
        acceptFor(
          PERMIT_REVIEW,
          bound({ executionPermitId: OTHER_PERMIT, executionAttempt: 2 }),
        ),
        acceptFor(
          PERMIT_REVIEW,
          bound({ executionPermitId: OTHER_PERMIT, executionAttempt: 1 }),
        ),
        acceptFor(
          PERMIT_REVIEW,
          bound({ executionPermitId: PERMIT, executionAttempt: 1 }),
        ),
        acceptFor(
          PERMIT_REVIEW,
          bound({ executionPermitId: PERMIT, executionAttempt: 3 }),
        ),
        acceptFor(REVIEW_ID, bound(delivered, { reviewId: REVIEW_ID })),
        acceptFor(PERMIT_REVIEW, bound(delivered, { actorId: otherActor }), {
          actorUserId: otherActor,
        }),
      ]
      for (const refusal of refusals) {
        await expect(refusal).resolves.toEqual({ status: 'rejected', reason: 'invalid' })
      }
      await expect(
        acceptFor(
          PERMIT_REVIEW,
          bound(delivered, { organizationId: otherOrganization }),
          {
            organizationId: otherOrganization,
          },
        ),
      ).resolves.toMatchObject({ status: 'rejected' })
      await expect(
        acceptFor(PERMIT_REVIEW, bound(delivered, { propertyId: otherProperty }), {
          propertyId: otherProperty,
        }),
      ).resolves.toMatchObject({ status: 'rejected' })
      await expect(adoptionOf(PERMIT_REVIEW, PERMIT_OPERATION)).resolves.toEqual({
        replies: [],
        operation: [{ disposition: 'none' }],
      })

      await expect(acceptFor(PERMIT_REVIEW, bound(delivered))).resolves.toMatchObject({
        status: 'accepted',
        reply: { text: SUGGESTION, aiGenerated: true, stateRevision: 1 },
      })
      await expect(adoptionOf(PERMIT_REVIEW, PERMIT_OPERATION)).resolves.toMatchObject({
        operation: [{ disposition: 'adopted' }],
      })
    })

    it('refuses a token bound by a request binding and writes nothing', async () => {
      const permitBound = provenancePayload({
        operationId: LEGACY_OPERATION,
        reviewId: LEGACY_REVIEW,
        baseReplyStateRevision: 0,
      })
      const {
        executionPermitId: _permit,
        executionAttempt: _attempt,
        ...unbound
      } = permitBound
      const token = signWithoutValidation(
        { ...unbound, ['requestBinding' + 'Hmac']: 'A'.repeat(43) },
        permitBound.version,
      )

      await expect(acceptFor(LEGACY_REVIEW, token)).resolves.toEqual({
        status: 'rejected',
        reason: 'invalid',
      })
      await expect(adoptionOf(LEGACY_REVIEW, LEGACY_OPERATION)).resolves.toEqual({
        replies: [],
        operation: [{ disposition: 'none' }],
      })
    })
  })
})
