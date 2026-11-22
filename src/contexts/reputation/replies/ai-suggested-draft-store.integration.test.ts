import { replyScopeEffects } from '#/contexts/reputation/public-api'
import { REPLY_DRAFTING_V2_PROFILE_DIGEST } from '#/shared/reply/reply-drafting-v2-contract'
import { resolveReplyDraftingV2Options } from '#/shared/reply/request'
import { replyAiFrameReservations } from '#/shared/db/schema'
import { assertCurrentAiDraftBinding } from './ai-draft-binding.server'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { getDb } from '#/shared/db'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { purgeAiDraftsForReview } from '#/shared/db/ai/ai-draft-purge'
import {
  aiExecutionControlHeads,
  aiOperations,
  replies,
  reviews,
} from '#/shared/db/schema'
import { organizationId, propertyId, reviewId, userId } from '#/shared/domain/ids'
import {
  digestRenderedReply,
  signAiReplyProvenance,
  verifyAiReplyProvenance,
} from '#/shared/reply/ai-reply-provenance'
import {
  BRAND_DISPLAY_NAME_DIGEST,
  createAiReplyAdoptionFixture,
} from './ai-reply-adoption.test-fixtures'
import { createReviewRepository } from '../reviews/review-repository.server'
import { createReplyRepository } from './reply-repository.server'
import { createAiSuggestedDraftStore } from './ai-suggested-draft-store.server'
import { createAtomicReplyCommandStore } from './reply-command-store.server'
import {
  reviewReplyApproved,
  reviewReplyPublicationRequested,
} from '../domain/review-events'

const NOW = new Date()
const ORGANIZATION_ID = organizationId('ai-suggested-draft-test-org')
const PROPERTY_ID = propertyId('74000000-0000-4000-8000-000000000001')
const REVIEW_ID = reviewId('74000000-0000-4000-8000-000000000002')
const ACTOR_USER_ID = userId('ai-suggested-draft-user')
const SOURCE_EPOCH = 2
// Material Review Revisions are repository-owned and start at one. Fixtures
// must bind AI provenance to that canonical revision instead of attempting to
// inject an arbitrary provider counter through the upsert input.
const SOURCE_REVISION = 1
const SUGGESTION = 'Thank you for sharing your experience.'

describe.sequential('AI suggested draft acceptance (real PostgreSQL)', () => {
  const db = getDb()
  const {
    publicKey,
    privateKey,
    executionOf,
    provenanceToken,
    personalizedProvenanceToken,
    groundedProvenanceToken,
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
    lineageId: '74000000-0000-4000-8000-000000000003',
    sourceEpoch: SOURCE_EPOCH,
    sourceRevision: SOURCE_REVISION,
    suggestion: SUGGESTION,
    now: NOW,
    label: 'suggested-draft',
  })
  let brandProfileCurrent = true
  let voiceCurrent = true
  const brandAuthorityCalls: Array<Readonly<Record<string, unknown>>> = []
  const voiceAuthorityCalls: Array<Readonly<Record<string, unknown>>> = []
  const store = createAiSuggestedDraftStore(
    db,
    new Map([['provenance-v1', publicKey]]),
    {
      isCurrentAiReplyBrandProfile: async (_tx, input) => {
        brandAuthorityCalls.push(input)
        return brandProfileCurrent
      },
    },
    {
      resolveLocalFrame: async () => null,
      isCurrentVoice: async (_tx, input) => {
        voiceAuthorityCalls.push(input)
        return voiceCurrent
      },
    },
  )
  const reviewRepository = () =>
    createReviewRepository(db, () => new Date(), undefined, replyScopeEffects)

  let initialReplyControl: Awaited<ReturnType<typeof readReplyControl>> | undefined

  const accept = (
    token: string,
    overrides: Partial<Parameters<typeof store.accept>[0]> = {},
  ) =>
    store.accept({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: REVIEW_ID,
      actorUserId: ACTOR_USER_ID,
      text: SUGGESTION,
      provenanceToken: token,
      now: NOW,
      ...overrides,
    })

  const operationState = (operationId: string) =>
    db
      .select({
        disposition: aiOperations.replyAdoptionDisposition,
        adoptedReplyRevision: aiOperations.adoptedReplyRevision,
        adoptedReviewReplyStateRevision: aiOperations.adoptedReviewReplyStateRevision,
      })
      .from(aiOperations)
      .where(eq(aiOperations.id, operationId))
      .limit(1)

  beforeAll(async () => {
    // The purge records a fact for a reply it withdraws while it awaits approval.
    clearEventSchemas()
    registerAllEventSchemas()
    await clear()
    initialReplyControl = await readReplyControl()
    await transitionReplyControl('enabled', 'accepting')
    await seedEnabledProperty({ propertySlug: 'ai-suggested-draft-property' })

    await reviewRepository().upsert(reviewFixture(REVIEW_ID, 'ai-suggested-draft-review'))
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000004',
      permitId: '74000000-0000-4000-8000-000000000104',
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 0,
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000005',
      permitId: '74000000-0000-4000-8000-000000000105',
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 1,
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000006',
      permitId: '74000000-0000-4000-8000-000000000106',
      sourceRevision: SOURCE_REVISION + 1,
      baseReplyStateRevision: 1,
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000007',
      permitId: '74000000-0000-4000-8000-000000000107',
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 2,
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
    })
    await seedSucceededReplyOperation({
      operationId: '74000000-0000-4000-8000-000000000008',
      permitId: '74000000-0000-4000-8000-000000000108',
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 2,
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
    })
  })

  afterAll(async () => {
    await clear()
    clearEventSchemas()
    if (initialReplyControl) {
      await transitionReplyControl(
        initialReplyControl.executionState,
        initialReplyControl.admissionState,
      )
    }
  })

  it('adopts Spanish v4 with authenticated frame choices on the served reply drafting v2 execution', async () => {
    const newReview = reviewId('74000000-0000-4000-8000-000000000090')
    const operationId = '74000000-0000-4000-8000-000000000091'
    const permitId = '74000000-0000-4000-8000-000000000092'
    await reviewRepository().upsert(reviewFixture(newReview, 'v4-spanish'))
    await seedSucceededReplyOperation({
      operationId,
      permitId,
      reviewId: newReview,
      sourceRevision: SOURCE_REVISION,
      baseReplyStateRevision: 0,
      replyBrandProfileVersion: 7,
      replyBrandDisplayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
    })
    const selected = {
      options: resolveReplyDraftingV2Options({ languageCode: 'es-Latn', variation: 0 }),
      voiceDigest: 'f'.repeat(64),
      generationSeed: 'b'.repeat(64),
      parentOperationId: null,
      rewriteOrdinal: 0 as const,
      rewriteIssues: [],
    }
    const choices = {
      closing: -1,
      signOff: 1,
      contactSentence: 0,
      emoji: 0,
      includeContact: true,
    }
    await db
      .update(aiOperations)
      .set({
        operationProfileVersion: 'reply-suggestion-v2',
        capabilityRuntimeProfileVersion: 'reply-drafting-runtime-v2',
        replyDraftingV2: selected,
        concreteReplyLanguageTag: 'es-Latn',
        concreteReplyTemplateGroup: 'es-Latn',
      })
      .where(eq(aiOperations.id, operationId))
    await db.insert(replyAiFrameReservations).values({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      languageGroup: 'es-Latn',
      ratingBand: 'positiveText',
      voiceDigest: selected.voiceDigest,
      generationSeed: selected.generationSeed,
      choices,
      closingOrder: [],
      createdAt: NOW,
    })
    const previous = verifyAiReplyProvenance(
      groundedProvenanceToken(),
      new Map([['provenance-v1', publicKey]]),
    )!
    if (previous.version !== 'ai-reply-provenance-v3')
      throw new Error('Expected historical fixture')
    const text = 'Sentimos que la espera fuera tan larga. Su tiempo merece más atención.'
    // The gateway signs the deployment the v2 operation recorded: the streaming one.
    const v4Token = (providerDeploymentProfileVersion: string) =>
      signAiReplyProvenance(
        {
          ...previous,
          version: 'ai-reply-provenance-v4',
          operationId,
          ...executionOf(operationId),
          reviewId: newReview,
          baseReplyStateRevision: 0,
          providerDeploymentProfileVersion,
          operationProfileVersion: 'reply-suggestion-v2',
          replyProfileVersion: 'reply-draft-v4',
          replyProfileDigest: REPLY_DRAFTING_V2_PROFILE_DIGEST,
          replyVoiceDigest: selected.voiceDigest,
          voiceChoices: choices,
          parentOperationId: null,
          rewriteOrdinal: 0,
          concreteLanguageTag: 'es-Latn',
          templateGroup: 'es-Latn',
          promptVersion: 'reply-suggestion-prompt-v2',
          renderedSuggestionDigest: digestRenderedReply(text),
        },
        privateKey,
      )
    const input = {
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      reviewId: newReview,
      actorUserId: ACTOR_USER_ID,
      text,
      provenanceToken: v4Token('private-beta-global-v3'),
      now: NOW,
    }
    // A v4 token never names the pre-release deployment, and an operation that
    // recorded the v2 profile on that deployment is a pair the catalogue does not
    // list: neither is adoptable.
    expect(
      await store.accept({
        ...input,
        provenanceToken: v4Token('private-beta-global-v2'),
      }),
    ).toEqual({ status: 'rejected', reason: 'invalid' })
    expect(await store.accept(input)).toEqual({ status: 'rejected', reason: 'stale' })

    // The served execution is the catalogue's own: no stubbed compatibility or
    // selection. Recording the v2 operation on its streaming deployment (and that
    // deployment's control head, as the admission does) is all adoption needs.
    const [streamingControl] = await db
      .select()
      .from(aiExecutionControlHeads)
      .where(eq(aiExecutionControlHeads.scopeKey, 'provider:private-beta-global-v3'))
      .limit(1)
    if (!streamingControl) throw new Error('Streaming deployment control is not seeded')
    await db
      .update(aiOperations)
      .set({
        providerDeploymentProfileVersion: 'private-beta-global-v3',
        providerControlId: streamingControl.controlId,
        providerControlGeneration: streamingControl.generation,
      })
      .where(eq(aiOperations.id, operationId))

    const accepted = await store.accept(input)
    expect(accepted.status).toBe('accepted')
    if (accepted.status !== 'accepted') throw new Error('Expected v4 adoption')
    const [stored] = await db
      .select()
      .from(replies)
      .where(eq(replies.id, accepted.reply.id))
    expect(stored).toMatchObject({
      originAiProfileVersion: 'reply-draft-v4',
      originTemplateGroup: 'es-Latn',
      voiceChoices: choices,
      voiceDigest: selected.voiceDigest,
    })
    const [usage] = await db
      .select()
      .from(replyAiFrameReservations)
      .where(eq(replyAiFrameReservations.generationSeed, selected.generationSeed))
    expect(usage!.adoptedAt).not.toBeNull()
    expect(usage!.choices).toEqual(choices)
    expect(
      await db.transaction((tx) =>
        assertCurrentAiDraftBinding(tx, {
          organizationId: ORGANIZATION_ID,
          replyId: accepted.reply.id,
        }),
      ),
    ).toBe('current')
  })

  it('persists exact signed provenance and replays the same adoption idempotently', async () => {
    const token = provenanceToken()
    const accepted = await accept(token)

    expect(accepted).toMatchObject({
      status: 'accepted',
      reply: {
        text: SUGGESTION,
        aiGenerated: true,
        replyLanguageTag: 'en-Latn-US',
        stateRevision: 1,
      },
    })
    const [persisted] = await db
      .select({
        authorship: replies.authorship,
        originOperationId: replies.originOperationId,
        originSourceRevision: replies.originSourceRevision,
        originTemplateId: replies.originReplyTemplateId,
        originConcreteLanguageTag: replies.originConcreteLanguageTag,
        originTemplateGroup: replies.originTemplateGroup,
        replyLanguageTag: replies.replyLanguageTag,
        replyStateRevision: reviews.replyStateRevision,
      })
      .from(replies)
      .innerJoin(reviews, eq(reviews.id, replies.reviewId))
      .where(eq(replies.reviewId, REVIEW_ID))
      .limit(1)
    expect(persisted).toEqual({
      authorship: 'ai_assisted',
      originOperationId: '74000000-0000-4000-8000-000000000004',
      originSourceRevision: SOURCE_REVISION,
      originTemplateId: 'appreciation_positive',
      originConcreteLanguageTag: 'en-Latn-US',
      originTemplateGroup: 'en-Latn',
      replyLanguageTag: 'en-Latn-US',
      replyStateRevision: 1,
    })
    await expect(operationState('74000000-0000-4000-8000-000000000004')).resolves.toEqual(
      [
        {
          disposition: 'adopted',
          adoptedReplyRevision: 1,
          adoptedReviewReplyStateRevision: 1,
        },
      ],
    )

    await expect(accept(token)).resolves.toMatchObject({
      status: 'accepted',
      reply: { stateRevision: 1 },
    })
  })

  it('rejects edited text, expiry, and stale source without changing the reply', async () => {
    await expect(
      accept(provenanceToken({ baseReplyStateRevision: 1 }), { text: `${SUGGESTION}!` }),
    ).resolves.toEqual({ status: 'rejected', reason: 'invalid' })

    await expect(
      accept(
        provenanceToken({
          baseReplyStateRevision: 1,
          tokenExpiresAtEpochMillis: NOW.getTime() - 1,
          draftExpiresAtEpochMillis: NOW.getTime() + 1,
        }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'expired' })

    await expect(
      accept(
        provenanceToken({
          baseReplyStateRevision: 1,
          operationId: '74000000-0000-4000-8000-000000000006',
          sourceRevision: SOURCE_REVISION + 1,
        }),
      ),
    ).resolves.toEqual({ status: 'rejected', reason: 'stale' })
  })

  it('adopts a personalized draft without inventing stock-template provenance', async () => {
    const accepted = await accept(personalizedProvenanceToken(), {
      now: new Date(NOW.getTime() + 1),
    })

    expect(accepted).toMatchObject({
      status: 'accepted',
      reply: { aiGenerated: true, stateRevision: 2 },
    })
    if (accepted.status !== 'accepted') {
      throw new Error('Expected the fresh AI suggestion to be accepted')
    }
    await expect(
      db
        .select({
          profileVersion: replies.originAiProfileVersion,
          templateId: replies.originReplyTemplateId,
          catalogueVersion: replies.originReplyTemplateCatalogueVersion,
          catalogueDigest: replies.originReplyTemplateCatalogueDigest,
        })
        .from(replies)
        .where(eq(replies.id, accepted.reply.id))
        .limit(1),
    ).resolves.toEqual([
      {
        profileVersion: 'reply-draft-v1',
        templateId: null,
        catalogueVersion: null,
        catalogueDigest: null,
      },
    ])
    await expect(
      store.assertCurrentBinding({
        organizationId: ORGANIZATION_ID,
        replyId: accepted.reply.id,
      }),
    ).resolves.toBe('current')

    await expect(
      db
        .select({
          id: aiOperations.id,
          disposition: aiOperations.replyAdoptionDisposition,
          adoptedReplyRevision: aiOperations.adoptedReplyRevision,
          adoptedReviewReplyStateRevision: aiOperations.adoptedReviewReplyStateRevision,
        })
        .from(aiOperations)
        .where(
          sql`${aiOperations.id} IN (
            ${'74000000-0000-4000-8000-000000000004'}::uuid,
            ${'74000000-0000-4000-8000-000000000005'}::uuid
          )`,
        )
        .orderBy(aiOperations.id),
    ).resolves.toEqual([
      {
        id: '74000000-0000-4000-8000-000000000004',
        disposition: 'invalidated',
        adoptedReplyRevision: 1,
        adoptedReviewReplyStateRevision: 1,
      },
      {
        id: '74000000-0000-4000-8000-000000000005',
        disposition: 'adopted',
        adoptedReplyRevision: 2,
        adoptedReviewReplyStateRevision: 2,
      },
    ])
  })

  it('atomically invalidates a grounded suggestion when Portal says its Brand Profile changed', async () => {
    brandProfileCurrent = false
    voiceCurrent = true
    const token = groundedProvenanceToken()

    await expect(accept(token, { now: new Date(NOW.getTime() + 2) })).resolves.toEqual({
      status: 'rejected',
      reason: 'invalidated',
    })
    expect(brandAuthorityCalls.at(-1)).toEqual({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      version: 7,
      displayNameDigest: BRAND_DISPLAY_NAME_DIGEST,
    })
    await expect(operationState('74000000-0000-4000-8000-000000000007')).resolves.toEqual(
      [
        {
          disposition: 'invalidated',
          adoptedReplyRevision: null,
          adoptedReviewReplyStateRevision: null,
        },
      ],
    )

    brandProfileCurrent = true
    await expect(accept(token, { now: new Date(NOW.getTime() + 3) })).resolves.toEqual({
      status: 'rejected',
      reason: 'invalidated',
    })
  })

  it('keeps an adopted Review-owned draft usable after a later Brand Profile change', async () => {
    brandProfileCurrent = true
    voiceCurrent = true
    const token = groundedProvenanceToken({
      operationId: '74000000-0000-4000-8000-000000000008',
    })
    const accepted = await accept(token, { now: new Date(NOW.getTime() + 4) })
    expect(accepted).toMatchObject({
      status: 'accepted',
      reply: { stateRevision: 3 },
    })
    if (accepted.status !== 'accepted') {
      throw new Error('Expected the grounded suggestion to be adopted')
    }
    expect(voiceAuthorityCalls.at(-1)).toEqual({
      organizationId: ORGANIZATION_ID,
      propertyId: PROPERTY_ID,
      languageGroup: 'en-Latn',
      voiceDigest: 'f'.repeat(64),
    })

    const authorityCallCount = brandAuthorityCalls.length
    brandProfileCurrent = false
    await expect(
      accept(token, { now: new Date(NOW.getTime() + 5) }),
    ).resolves.toMatchObject({ status: 'accepted', reply: { stateRevision: 3 } })
    expect(brandAuthorityCalls).toHaveLength(authorityCallCount)
    await expect(
      store.assertCurrentBinding({
        organizationId: ORGANIZATION_ID,
        replyId: accepted.reply.id,
      }),
    ).resolves.toBe('current')
    await expect(
      db
        .select({ disposition: aiOperations.replyAdoptionDisposition })
        .from(aiOperations)
        .where(eq(aiOperations.id, '74000000-0000-4000-8000-000000000008'))
        .limit(1),
    ).resolves.toEqual([{ disposition: 'adopted' }])

    // Confirm & Publish runs the same binding check inside the transaction of
    // its write: once the draft's expiry has passed, the approval is refused
    // without a row change. (reply-ai-adoption.integration.test.ts covers the
    // rest of the lifecycle: a draft save, a reject, a retry and an edit do not
    // read the binding.)
    const replyRepository = createReplyRepository(db, () => new Date())
    await db
      .update(replies)
      .set({
        status: 'pending_approval',
        submittedAt: NOW,
        aiDraftExpiresAt: new Date(NOW.getTime() - 1),
      })
      .where(eq(replies.id, accepted.reply.id))
    const pending = await replyRepository.findById(accepted.reply.id, ORGANIZATION_ID)
    if (!pending) throw new Error('Expected the adopted reply to be stored')
    await expect(
      store.assertCurrentBinding({
        organizationId: ORGANIZATION_ID,
        replyId: accepted.reply.id,
      }),
    ).resolves.toBe('stale')
    const approval = {
      replyId: pending.id,
      reviewId: REVIEW_ID,
      propertyId: PROPERTY_ID,
      organizationId: ORGANIZATION_ID,
      userId: ACTOR_USER_ID,
      occurredAt: NOW,
    }
    await expect(
      createAtomicReplyCommandStore(
        db,
        () => new Date(),
        async () => true,
        undefined,
        replyScopeEffects,
      ).markPublicationAuthorized(
        pending,
        { status: 'approved' },
        {
          lifecycleEvent: reviewReplyApproved({ ...approval, authorId: ACTOR_USER_ID }),
          publicationIntent: reviewReplyPublicationRequested({
            ...approval,
            publicationCycle: 1,
            sourceEpoch: SOURCE_EPOCH,
            materialReviewRevision: SOURCE_REVISION,
            baseObservationRevision: 0,
          }),
        },
      ),
    ).resolves.toBeNull()
    await expect(
      db
        .select({
          text: replies.text,
          authorship: replies.authorship,
          status: replies.status,
          publicationState: replies.publicationState,
        })
        .from(replies)
        .where(eq(replies.id, accepted.reply.id))
        .limit(1),
    ).resolves.toEqual([
      {
        text: SUGGESTION,
        authorship: 'ai_assisted',
        status: 'pending_approval',
        publicationState: null,
      },
    ])
    brandProfileCurrent = true
  })

  it('purges an AI draft on source change and advances human-draft heads only for material changes', async () => {
    const [before] = await db
      .select({ replyStateRevision: reviews.replyStateRevision })
      .from(reviews)
      .where(eq(reviews.id, REVIEW_ID))
      .limit(1)
    if (!before) throw new Error('review missing')
    const base = before.replyStateRevision
    await db.transaction(async (tx) => {
      await tx
        .update(reviews)
        .set({ sourceRevision: SOURCE_REVISION + 1 })
        .where(eq(reviews.id, REVIEW_ID))
      await purgeAiDraftsForReview(
        tx,
        {
          organizationId: ORGANIZATION_ID,
          reviewId: REVIEW_ID,
        },
        replyScopeEffects,
      )
    })
    await expect(
      db
        .select({ replyStateRevision: reviews.replyStateRevision })
        .from(reviews)
        .where(eq(reviews.id, REVIEW_ID))
        .limit(1),
    ).resolves.toEqual([{ replyStateRevision: base + 1 }])
    await expect(operationState('74000000-0000-4000-8000-000000000005')).resolves.toEqual(
      [
        {
          disposition: 'invalidated',
          adoptedReplyRevision: 2,
          adoptedReviewReplyStateRevision: 2,
        },
      ],
    )

    const [created] = await db
      .insert(replies)
      .values({
        reviewId: REVIEW_ID,
        organizationId: ORGANIZATION_ID,
        text: 'A manual draft',
        status: 'draft',
        source: 'internal',
        createdBy: ACTOR_USER_ID,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .returning({
        id: replies.id,
        authorship: replies.authorship,
        stateRevision: replies.stateRevision,
      })
    expect(created).toMatchObject({ authorship: 'human', stateRevision: 1 })

    await db
      .update(replies)
      .set({ updatedAt: new Date(NOW.getTime() + 1) })
      .where(eq(replies.id, created!.id))
    await expect(
      db
        .select({
          stateRevision: replies.stateRevision,
          replyStateRevision: reviews.replyStateRevision,
        })
        .from(replies)
        .innerJoin(reviews, eq(reviews.id, replies.reviewId))
        .where(eq(replies.id, created!.id))
        .limit(1),
    ).resolves.toEqual([{ stateRevision: 1, replyStateRevision: base + 2 }])

    await db
      .update(replies)
      .set({ text: 'A revised manual draft' })
      .where(eq(replies.id, created!.id))
    await expect(
      db
        .select({
          text: replies.text,
          stateRevision: replies.stateRevision,
          replyStateRevision: reviews.replyStateRevision,
        })
        .from(replies)
        .innerJoin(reviews, eq(reviews.id, replies.reviewId))
        .where(eq(replies.id, created!.id))
        .limit(1),
    ).resolves.toEqual([
      {
        text: 'A revised manual draft',
        stateRevision: 2,
        replyStateRevision: base + 3,
      },
    ])
  })
})
