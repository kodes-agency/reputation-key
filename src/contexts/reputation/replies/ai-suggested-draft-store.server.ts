import { reviewContentJoin } from '#/shared/db/review-content-join'
import { reviewSourceContents } from '#/shared/db/schema/review-source-content.schema'
import { adoptDraftMeasurement } from '#/shared/db/ai/draft-measurement-lineage'
import { replyAiFrameReservations } from '#/shared/db/schema'
import { isExecutionCompatibleWithConsent } from '#/shared/merchant-ai-notice/ai-runtime-capability-contract'
import { and, eq, isNull, sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import {
  aiPropertyProcessingProfiles,
  aiOperations,
  merchantAiEnablement,
  properties,
  replies,
  reviews,
} from '#/shared/db/schema'
import {
  digestRenderedReply,
  verifyAiReplyProvenance,
  type AiReplyProvenancePayload,
} from '#/shared/reply/ai-reply-provenance'
import type {
  AiReplyProvenancePublicKeyring,
  AiSuggestedDraftStore,
} from './ai-suggested-draft-store.port.server'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/public-api'
import { replyFromRow } from './reply-mapper.server'
import { assertCurrentAiDraftBinding } from './ai-draft-binding.server'
import type { AiReplyVoicePublicApi } from '../library/ai-reply-voice-frame.server'
import { insertAdoptedAiDraft, updateAdoptedAiDraft } from './row-commands.server'

// Recorded deployment evidence is historical; each provenance has its own execution.
const REPLY_ADOPTION_DEPLOYMENT = 'private-beta-global-v3'

// The locked row must be the execution the token names: its execution permit
// and attempt.
function executionBindingMatches(
  operation: Readonly<{
    executionPermitId: string | null
    executionAttempt: number
  }>,
  provenance: AiReplyProvenancePayload,
): boolean {
  return (
    operation.executionPermitId === provenance.executionPermitId &&
    operation.executionAttempt === provenance.executionAttempt
  )
}

function replyFenceMatches(
  value: unknown,
  replyDraftingEpoch: number,
  baseReplyStateRevision: number,
): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).length === 3 &&
    record.capability === 'reply_drafting' &&
    record.replyDraftingEpoch === replyDraftingEpoch &&
    record.baseReplyStateRevision === baseReplyStateRevision
  )
}

/**
 * Cross-aggregate acceptance seam for browser-held AI suggestions. The
 * signature is checked before acquiring locks; every mutable authorization,
 * source, profile, and reply fence is rechecked inside the write transaction.
 */
export const createAiSuggestedDraftStore = (
  db: Database,
  publicKeys: AiReplyProvenancePublicKeyring,
  replyBrandProfiles: Pick<
    PortalAiReplyBrandProfilePublicApi,
    'isCurrentAiReplyBrandProfile'
  >,
  replyVoices: AiReplyVoicePublicApi,
): AiSuggestedDraftStore => {
  return {
    async accept(input) {
      const provenance = verifyAiReplyProvenance(input.provenanceToken, publicKeys)
      if (
        provenance === null ||
        provenance.actorId !== input.actorUserId ||
        provenance.organizationId !== input.organizationId ||
        provenance.propertyId !== input.propertyId ||
        provenance.reviewId !== input.reviewId ||
        provenance.renderedSuggestionDigest !== digestRenderedReply(input.text)
      ) {
        return { status: 'rejected', reason: 'invalid' }
      }
      const { replyVoiceDigest, replyProfileVersion } = provenance
      const bodyFrame = await adoptionBodyFrame(replyVoices, provenance, input)

      // fallow-ignore-next-line complexity -- one adoption transaction holds source, reply, consent and provenance fences through the atomic write
      return db.transaction(async (tx) => {
        const clockResult = await tx.execute(sql`SELECT transaction_timestamp() AS "now"`)
        const databaseNowValue = (clockResult.rows[0] as { now?: unknown } | undefined)
          ?.now
        const databaseNow =
          databaseNowValue instanceof Date
            ? databaseNowValue
            : typeof databaseNowValue === 'string'
              ? new Date(databaseNowValue)
              : null
        if (databaseNow === null || Number.isNaN(databaseNow.getTime())) {
          return { status: 'rejected', reason: 'stale' } as const
        }
        const nowEpochMillis = databaseNow.getTime()
        if (
          provenance.tokenExpiresAtEpochMillis <= nowEpochMillis ||
          provenance.draftExpiresAtEpochMillis <= nowEpochMillis
        ) {
          return { status: 'rejected', reason: 'expired' } as const
        }
        const [property] = await tx
          .select({
            organizationId: properties.organizationId,
            sourceEpoch: properties.sourceEpoch,
            lifecycleState: properties.lifecycleState,
          })
          .from(properties)
          .where(
            and(
              eq(properties.organizationId, input.organizationId),
              eq(properties.id, input.propertyId),
              isNull(properties.deletedAt),
            ),
          )
          .limit(1)
          .for('update')

        const [profile] = await tx
          .select()
          .from(aiPropertyProcessingProfiles)
          .where(
            and(
              eq(aiPropertyProcessingProfiles.organizationId, input.organizationId),
              eq(aiPropertyProcessingProfiles.propertyId, input.propertyId),
            ),
          )
          .limit(1)
          .for('update')

        const [authorization] = await tx
          .select()
          .from(merchantAiEnablement)
          .where(
            and(
              eq(merchantAiEnablement.organizationId, input.organizationId),
              eq(merchantAiEnablement.propertyId, input.propertyId),
            ),
          )
          .limit(1)
          .for('update')

        const [review] = await tx
          .select({
            propertyId: reviews.propertyId,
            sourceEpoch: reviews.sourceEpoch,
            sourceRevision: reviews.sourceRevision,
            sourceContentState: reviews.sourceContentState,
            contentExpiresAt: reviewSourceContents.contentExpiresAt,
            replyStateRevision: reviews.replyStateRevision,
          })
          .from(reviews)
          .leftJoin(reviewSourceContents, reviewContentJoin)
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.id, input.reviewId),
            ),
          )
          .limit(1)
          .for('update', { of: reviews })

        const [existing] = await tx
          .select()
          .from(replies)
          .where(
            and(
              eq(replies.organizationId, input.organizationId),
              eq(replies.reviewId, input.reviewId),
              eq(replies.source, 'internal'),
            ),
          )
          .limit(1)
          .for('update')

        const [operation] = await tx
          .select()
          .from(aiOperations)
          .where(eq(aiOperations.id, provenance.operationId))
          .limit(1)
          .for('update')

        if (
          !operation ||
          operation.command !== 'reply' ||
          operation.capability !== 'reply_drafting' ||
          operation.organizationId !== input.organizationId ||
          operation.propertyId !== input.propertyId ||
          operation.actorUserId !== input.actorUserId ||
          operation.reviewId !== input.reviewId ||
          operation.sourceEpoch !== provenance.sourceEpoch ||
          operation.sourceRevision !== provenance.sourceRevision ||
          operation.baseReplyStateRevision !== provenance.baseReplyStateRevision ||
          operation.propertyProfileVersion !== provenance.propertyProfileVersion ||
          provenance.providerDeploymentProfileVersion !== REPLY_ADOPTION_DEPLOYMENT ||
          operation.operationProfileVersion !== provenance.operationProfileVersion ||
          operation.outputLeakageProfileVersion !==
            provenance.outputLeakageProfileVersion ||
          operation.outputLeakageProfileDigest !==
            provenance.outputLeakageProfileDigest ||
          operation.replyBrandProfileVersion !== provenance.replyBrandProfileVersion ||
          operation.replyBrandDisplayNameDigest !==
            provenance.replyBrandDisplayNameDigest ||
          operation.concreteReplyLanguageTag !== provenance.concreteLanguageTag ||
          operation.concreteReplyTemplateGroup !== provenance.templateGroup ||
          !replyFenceMatches(
            operation.capabilityFences,
            provenance.replyDraftingEpoch,
            provenance.baseReplyStateRevision,
          ) ||
          operation.state !== 'succeeded' ||
          operation.deliveredAt === null ||
          operation.expiresAt <= databaseNow ||
          operation.executionAttempt < 1 ||
          operation.executionPermitId === null ||
          operation.budgetSettledAt === null ||
          operation.actualMicros === null ||
          !executionBindingMatches(operation, provenance)
        ) {
          return { status: 'rejected', reason: 'invalid' } as const
        }

        if (operation.replyAdoptionDisposition === 'invalidated') {
          return { status: 'rejected', reason: 'invalidated' } as const
        }

        const brandProfileCurrent =
          operation.replyAdoptionDisposition !== 'none' ||
          (await replyBrandProfiles.isCurrentAiReplyBrandProfile(tx, {
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            version: provenance.replyBrandProfileVersion,
            displayNameDigest: provenance.replyBrandDisplayNameDigest,
          }))
        const voiceCurrent =
          operation.replyAdoptionDisposition !== 'none' ||
          (await replyVoices.isCurrentVoice(tx, {
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            languageGroup: provenance.templateGroup,
            voiceDigest: replyVoiceDigest,
          }))
        if (
          operation.replyAdoptionDisposition === 'none' &&
          (!brandProfileCurrent || !voiceCurrent)
        ) {
          const invalidatedRows = await tx
            .update(aiOperations)
            .set({
              replyAdoptionDisposition: 'invalidated',
              updatedAt: databaseNow,
            })
            .where(
              and(
                eq(aiOperations.id, operation.id),
                eq(aiOperations.state, 'succeeded'),
                eq(aiOperations.replyAdoptionDisposition, 'none'),
              ),
            )
            .returning({ id: aiOperations.id })
          if (invalidatedRows.length !== 1) {
            throw new Error('AI reply Brand Profile invalidation commit conflict')
          }
          return { status: 'rejected', reason: 'invalidated' } as const
        }

        if (
          !property ||
          property.organizationId !== input.organizationId ||
          property.lifecycleState !== 'active' ||
          property.sourceEpoch !== provenance.sourceEpoch ||
          !profile ||
          profile.lifecycleState !== 'active' ||
          profile.sourceEpoch !== provenance.sourceEpoch ||
          profile.profileVersion !== provenance.propertyProfileVersion ||
          !authorization ||
          authorization.state !== 'enabled' ||
          authorization.authorizationLineageId !== operation.authorizationLineageId ||
          authorization.noticeVersion !== operation.noticeVersion ||
          authorization.noticeDigest !== operation.noticeDigest ||
          authorization.authorizedSourceEpoch !== provenance.sourceEpoch ||
          authorization.replyDraftingEpoch !== provenance.replyDraftingEpoch ||
          authorization.sourcePolicyId !== operation.sourcePolicyId ||
          authorization.redactionProfileFamily !== operation.redactionProfileVersion ||
          !authorization.capabilities.includes('reply_drafting') ||
          !adoptionRuntimeMatches(authorization, operation) ||
          !review ||
          review.propertyId !== input.propertyId ||
          review.sourceEpoch !== provenance.sourceEpoch ||
          review.sourceRevision !== provenance.sourceRevision ||
          review.sourceContentState !== 'active' ||
          review.contentExpiresAt === null ||
          review.contentExpiresAt <= databaseNow ||
          provenance.draftExpiresAtEpochMillis > review.contentExpiresAt.getTime()
        ) {
          return { status: 'rejected', reason: 'stale' } as const
        }

        if (operation.replyAdoptionDisposition === 'adopted') {
          const exactReplay =
            existing?.originOperationId === provenance.operationId &&
            existing.text === input.text &&
            existing.replyLanguageTag === provenance.concreteLanguageTag &&
            existing.authorship === 'ai_assisted' &&
            existing.status === 'draft' &&
            existing.stateRevision === operation.adoptedReplyRevision &&
            review.replyStateRevision === operation.adoptedReviewReplyStateRevision &&
            existing.originSourceEpoch === provenance.sourceEpoch &&
            existing.originSourceRevision === provenance.sourceRevision &&
            existing.originBaseReplyStateRevision === provenance.baseReplyStateRevision &&
            existing.originReplyDraftingEpoch === provenance.replyDraftingEpoch &&
            existing.originPropertyProfileVersion === provenance.propertyProfileVersion &&
            existing.originAiProfileVersion === replyProfileVersion &&
            existing.originReplyTemplateId === null &&
            existing.originReplyTemplateCatalogueVersion === null &&
            existing.originReplyTemplateCatalogueDigest === null &&
            existing.originConcreteLanguageTag === provenance.concreteLanguageTag &&
            existing.originTemplateGroup === provenance.templateGroup &&
            existing.voiceDigest === replyVoiceDigest &&
            existing.aiDraftExpiresAt?.getTime() === provenance.draftExpiresAtEpochMillis
          return exactReplay
            ? ({ status: 'accepted', reply: replyFromRow(existing) } as const)
            : ({ status: 'rejected', reason: 'invalidated' } as const)
        }

        if (
          review.replyStateRevision !== provenance.baseReplyStateRevision ||
          (existing !== undefined &&
            existing.status !== 'draft' &&
            existing.status !== 'rejected')
        ) {
          return { status: 'rejected', reason: 'stale' } as const
        }

        let acceptedRow: typeof replies.$inferSelect | undefined
        if (existing) {
          acceptedRow = await updateAdoptedAiDraft(
            tx,
            { id: existing.id, organizationId: input.organizationId },
            {
              text: input.text,
              replyLanguageTag: provenance.concreteLanguageTag,
              templateLayer: null,
              templateRef: null,
              templateRevision: null,
              templateWordingKey: null,
              voiceDigest: replyVoiceDigest,
              voiceChoices: replyV2VoiceChoices(provenance, bodyFrame),
              status: 'draft',
              aiGenerated: true,
              authorship: 'ai_assisted',
              originOperationId: provenance.operationId,
              originSourceEpoch: provenance.sourceEpoch,
              originSourceRevision: provenance.sourceRevision,
              originBaseReplyStateRevision: provenance.baseReplyStateRevision,
              originReplyDraftingEpoch: provenance.replyDraftingEpoch,
              originPropertyProfileVersion: provenance.propertyProfileVersion,
              originAiProfileVersion: replyProfileVersion,
              originReplyTemplateId: null,
              originReplyTemplateCatalogueVersion: null,
              originReplyTemplateCatalogueDigest: null,
              originConcreteLanguageTag: provenance.concreteLanguageTag,
              originTemplateGroup: provenance.templateGroup,
              aiDraftExpiresAt: new Date(provenance.draftExpiresAtEpochMillis),
              rejectedBy: null,
              rejectionReason: null,
              updatedAt: databaseNow,
            },
          )
        } else {
          acceptedRow = await insertAdoptedAiDraft(tx, {
            reviewId: input.reviewId,
            organizationId: input.organizationId,
            text: input.text,
            replyLanguageTag: provenance.concreteLanguageTag,
            voiceDigest: replyVoiceDigest,
            voiceChoices: replyV2VoiceChoices(provenance, bodyFrame),
            status: 'draft',
            source: 'internal',
            createdBy: input.actorUserId,
            approvedBy: null,
            rejectedBy: null,
            rejectionReason: null,
            aiGenerated: true,
            authorship: 'ai_assisted',
            originOperationId: provenance.operationId,
            originSourceEpoch: provenance.sourceEpoch,
            originSourceRevision: provenance.sourceRevision,
            originBaseReplyStateRevision: provenance.baseReplyStateRevision,
            originReplyDraftingEpoch: provenance.replyDraftingEpoch,
            originPropertyProfileVersion: provenance.propertyProfileVersion,
            originAiProfileVersion: replyProfileVersion,
            originReplyTemplateId: null,
            originReplyTemplateCatalogueVersion: null,
            originReplyTemplateCatalogueDigest: null,
            originConcreteLanguageTag: provenance.concreteLanguageTag,
            originTemplateGroup: provenance.templateGroup,
            aiDraftExpiresAt: new Date(provenance.draftExpiresAtEpochMillis),
            stateRevision: 1,
            submittedAt: null,
            approvedAt: null,
            publishedAt: null,
            publicationState: null,
            publicationCycle: 0,
            publicationAttempts: 0,
            publicationLastErrorClass: null,
            reconcileDueAt: null,
            createdAt: databaseNow,
            updatedAt: databaseNow,
          })
        }
        if (!acceptedRow) {
          return { status: 'rejected', reason: 'stale' } as const
        }
        await adoptDraftMeasurement(tx, operation.id, acceptedRow)
        await adoptReplyV2Frame(
          tx,
          input,
          operation.replyDraftingV2,
          provenance,
          databaseNow,
        )
        const [adoptedReview] = await tx
          .select({ replyStateRevision: reviews.replyStateRevision })
          .from(reviews)
          .leftJoin(reviewSourceContents, reviewContentJoin)
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.id, input.reviewId),
            ),
          )
          .limit(1)

        const adoptedReviewReplyStateRevision = provenance.baseReplyStateRevision + 1
        if (adoptedReview?.replyStateRevision !== adoptedReviewReplyStateRevision) {
          throw new Error('AI reply adoption state revision commit conflict')
        }
        const receiptRows = await tx
          .update(aiOperations)
          .set({
            replyAdoptionDisposition: 'adopted',
            adoptedReplyRevision: acceptedRow.stateRevision,
            adoptedReviewReplyStateRevision,
            updatedAt: databaseNow,
          })
          .where(
            and(
              eq(aiOperations.id, operation.id),
              eq(aiOperations.state, 'succeeded'),
              eq(aiOperations.replyAdoptionDisposition, 'none'),
            ),
          )
          .returning({ id: aiOperations.id })
        if (receiptRows.length !== 1) {
          throw new Error('AI reply adoption receipt commit conflict')
        }
        return { status: 'accepted', reply: replyFromRow(acceptedRow) } as const
      })
    },
    async assertCurrentBinding(input) {
      return db.transaction((tx) => assertCurrentAiDraftBinding(tx, input))
    },
  }
}

function adoptionRuntimeMatches(
  authorization: Readonly<{
    noticeVersion: string
    noticeDigest: string
    capabilityRuntimeProfileVersions: Readonly<Partial<Record<string, string>>>
  }>,
  operation: Readonly<{
    operationProfileVersion: string
    capabilityRuntimeProfileVersion: string | null
    providerDeploymentProfileVersion: string
  }>,
): boolean {
  return isExecutionCompatibleWithConsent({
    capability: 'reply_drafting',
    acknowledgedNotice: authorization,
    servedExecution: {
      runtimeProfileVersion: operation.capabilityRuntimeProfileVersion ?? '',
      operationProfileVersion: operation.operationProfileVersion,
      providerDeploymentProfileVersion: operation.providerDeploymentProfileVersion,
    },
  })
}

function replyV2VoiceChoices(
  provenance: AiReplyProvenancePayload,
  frame: Readonly<{ prefix: string; suffix: string }> | null,
) {
  return {
    ...provenance.voiceChoices,
    ...(frame
      ? { bodyPrefixLength: frame.prefix.length, bodySuffixLength: frame.suffix.length }
      : {}),
  }
}

async function adoptReplyV2Frame(
  tx: Parameters<Parameters<Database['transaction']>[0]>[0],
  input: Parameters<AiSuggestedDraftStore['accept']>[0],
  selected: typeof aiOperations.$inferSelect.replyDraftingV2,
  provenance: AiReplyProvenancePayload,
  databaseNow: Date,
): Promise<void> {
  if (
    !selected ||
    selected.voiceDigest !== provenance.replyVoiceDigest ||
    selected.parentOperationId !== provenance.parentOperationId ||
    selected.rewriteOrdinal !== provenance.rewriteOrdinal
  )
    throw new Error('AI reply frame binding conflict')
  const reserved = await tx
    .update(replyAiFrameReservations)
    .set({ choices: provenance.voiceChoices, adoptedAt: databaseNow })
    .where(
      and(
        eq(replyAiFrameReservations.organizationId, input.organizationId),
        eq(replyAiFrameReservations.propertyId, input.propertyId),
        eq(replyAiFrameReservations.languageGroup, provenance.templateGroup),
        eq(replyAiFrameReservations.voiceDigest, provenance.replyVoiceDigest),
        eq(replyAiFrameReservations.generationSeed, selected.generationSeed),
      ),
    )
    .returning({ id: replyAiFrameReservations.id })
  if (reserved.length !== 1) throw new Error('AI reply frame reservation missing')
}

async function adoptionBodyFrame(
  voices: AiReplyVoicePublicApi,
  provenance: AiReplyProvenancePayload,
  input: Parameters<AiSuggestedDraftStore['accept']>[0],
) {
  return (
    voices.resolveSavedFrame({
      organizationId: input.organizationId,
      propertyId: input.propertyId,
      reviewId: input.reviewId,
      languageGroup: provenance.templateGroup,
      voiceDigest: provenance.replyVoiceDigest,
      choices: provenance.voiceChoices,
      text: input.text,
    }) ?? null
  )
}
