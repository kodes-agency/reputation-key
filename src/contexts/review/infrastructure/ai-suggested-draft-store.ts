import { timingSafeEqual } from 'node:crypto'
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
} from '#/shared/ai-reply-provenance'
import type {
  AiReplyProvenancePublicKeyring,
  AiSuggestedDraftStore,
} from '../application/ports/ai-suggested-draft-store.port'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import { AI_PROVIDER_DEPLOYMENT_PROFILE } from '#/shared/ai-operation-profiles'
import { replyFromRow } from './mappers/reply.mapper'
import { assertCurrentAiDraftBinding } from './ai-draft-binding'

const REPLY_DRAFTING_RUNTIME_PROFILE = 'reply-drafting-runtime-v1'

function constantEqual(left: string | null, right: string): boolean {
  if (left === null) return false
  const leftBytes = Buffer.from(left, 'utf8')
  const rightBytes = Buffer.from(right, 'utf8')
  try {
    return (
      leftBytes.byteLength === rightBytes.byteLength &&
      timingSafeEqual(leftBytes, rightBytes)
    )
  } finally {
    leftBytes.fill(0)
    rightBytes.fill(0)
  }
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
      const personalized = provenance.version !== 'ai-reply-provenance-v1'
      const grounded = provenance.version === 'ai-reply-provenance-v3'
      const replyProfileVersion = personalized
        ? provenance.replyProfileVersion
        : provenance.operationProfileVersion
      const replyTemplateProvenance = personalized
        ? {
            templateId: null,
            catalogueVersion: null,
            catalogueDigest: null,
          }
        : {
            templateId: provenance.templateId,
            catalogueVersion: provenance.replyTemplateCatalogueVersion,
            catalogueDigest: provenance.replyTemplateCatalogueDigest,
          }

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
            contentExpiresAt: reviews.contentExpiresAt,
            replyStateRevision: reviews.replyStateRevision,
          })
          .from(reviews)
          .where(
            and(
              eq(reviews.organizationId, input.organizationId),
              eq(reviews.id, input.reviewId),
            ),
          )
          .limit(1)
          .for('update')

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
          provenance.providerDeploymentProfileVersion !==
            AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion ||
          provenance.operationProfileVersion !== 'reply-suggestion-v1' ||
          operation.outputLeakageProfileVersion !==
            provenance.outputLeakageProfileVersion ||
          operation.outputLeakageProfileDigest !==
            provenance.outputLeakageProfileDigest ||
          (grounded
            ? operation.replyBrandProfileVersion !==
                provenance.replyBrandProfileVersion ||
              operation.replyBrandDisplayNameDigest !==
                provenance.replyBrandDisplayNameDigest
            : operation.replyBrandProfileVersion !== null ||
              operation.replyBrandDisplayNameDigest !== null) ||
          (!personalized &&
            (operation.replyTemplateCatalogueVersion !==
              provenance.replyTemplateCatalogueVersion ||
              operation.replyTemplateCatalogueDigest !==
                provenance.replyTemplateCatalogueDigest)) ||
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
          !constantEqual(operation.requestBindingHmac, provenance.requestBindingHmac)
        ) {
          return { status: 'rejected', reason: 'invalid' } as const
        }

        if (operation.replyAdoptionDisposition === 'invalidated') {
          return { status: 'rejected', reason: 'invalidated' } as const
        }

        if (
          grounded &&
          operation.replyAdoptionDisposition === 'none' &&
          !(await replyBrandProfiles.isCurrentAiReplyBrandProfile(tx, {
            organizationId: input.organizationId,
            propertyId: input.propertyId,
            version: provenance.replyBrandProfileVersion,
            displayNameDigest: provenance.replyBrandDisplayNameDigest,
          }))
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
          authorization.providerDeploymentProfileVersion !==
            AI_PROVIDER_DEPLOYMENT_PROFILE.profileVersion ||
          !authorization.capabilities.includes('reply_drafting') ||
          authorization.capabilityRuntimeProfileVersions.reply_drafting !==
            REPLY_DRAFTING_RUNTIME_PROFILE ||
          !review ||
          review.propertyId !== input.propertyId ||
          review.sourceEpoch !== provenance.sourceEpoch ||
          review.sourceRevision !== provenance.sourceRevision ||
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
            existing.originReplyTemplateId === replyTemplateProvenance.templateId &&
            existing.originReplyTemplateCatalogueVersion ===
              replyTemplateProvenance.catalogueVersion &&
            existing.originReplyTemplateCatalogueDigest ===
              replyTemplateProvenance.catalogueDigest &&
            existing.originConcreteLanguageTag === provenance.concreteLanguageTag &&
            existing.originTemplateGroup === provenance.templateGroup &&
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
          ;[acceptedRow] = await tx
            .update(replies)
            .set({
              text: input.text,
              replyLanguageTag: provenance.concreteLanguageTag,
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
              originReplyTemplateId: replyTemplateProvenance.templateId,
              originReplyTemplateCatalogueVersion:
                replyTemplateProvenance.catalogueVersion,
              originReplyTemplateCatalogueDigest: replyTemplateProvenance.catalogueDigest,
              originConcreteLanguageTag: provenance.concreteLanguageTag,
              originTemplateGroup: provenance.templateGroup,
              aiDraftExpiresAt: new Date(provenance.draftExpiresAtEpochMillis),
              rejectedBy: null,
              rejectionReason: null,
              updatedAt: databaseNow,
            })
            .where(
              and(
                eq(replies.id, existing.id),
                eq(replies.organizationId, input.organizationId),
              ),
            )
            .returning()
        } else {
          ;[acceptedRow] = await tx
            .insert(replies)
            .values({
              reviewId: input.reviewId,
              organizationId: input.organizationId,
              text: input.text,
              replyLanguageTag: provenance.concreteLanguageTag,
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
              originReplyTemplateId: replyTemplateProvenance.templateId,
              originReplyTemplateCatalogueVersion:
                replyTemplateProvenance.catalogueVersion,
              originReplyTemplateCatalogueDigest: replyTemplateProvenance.catalogueDigest,
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
            .onConflictDoNothing({
              target: [replies.reviewId, replies.source, replies.organizationId],
            })
            .returning()
        }
        if (!acceptedRow) {
          return { status: 'rejected', reason: 'stale' } as const
        }
        const [adoptedReview] = await tx
          .select({ replyStateRevision: reviews.replyStateRevision })
          .from(reviews)
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
