import { createReadReplyDraftingConsent } from './reply/read-reply-drafting-consent.server'
import { recordDraftMeasurementEvent } from '#/shared/db/ai/draft-measurement-events'
import { recordDraftGeneration } from '#/shared/db/ai/draft-generation-measurement'
import type { OrganizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import type { AiReviewSourcePort } from '#/contexts/reputation/public-api'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/public-api'
import {
  createCld3ReplyLanguageDetector,
  resolveConcreteReplyLanguage,
} from '#/shared/ai-reply-language-verifier'
import type { AiInferencePort } from './execution/ai-inprocess.port.server'
import type { AiAdmissionPort } from './execution/ai-lane-admission.port.server'
import type { AiSubjectHmacPort } from './analysis/ai-subject-hmac.port.server'
import type { AiProviderChoicePort } from './analysis/ai-provider-choice.port.server'
import { createReviewAnalysisContractV3 } from './analysis/review-analysis-contract-v3.server'
import { createAnalyzeReviewEvent } from './analysis/analyze-review-event.server'
import { createAiOperationExecutionReaper } from './analysis/ai-operation-execution-reaper.server'
import { createAdvanceReviewAnalysisEnrollments } from './replay/advance-enrollments.server'
import { createApplyAiAuthorizationLifecycle } from './replay/apply-ai-authorization-lifecycle.server'
import { createApproveReviewAnalysisEnrollment } from './replay/approve-enrollment.server'
import type { AiOutputStorePort } from './analysis/ai-output-store.port.server'
import {
  createGenerateReplySuggestion,
  type GenerateReplySuggestionDependencies,
} from './reply/generate-suggestion.server'
import { createReadReviewAnalysis } from './analysis/read-review-analysis.server'
import type { AiPropertyAccess } from './consent/ai-property-read-access.server'
import { createReadGuestVoiceDetail } from './guest-voice/get-detail.server'
import { createReadGuestVoiceV2 } from './guest-voice/get-guest-voice.server'
import { createPlanGuestVoiceSummary } from './guest-voice/plan-summary.server'
import { createRunGuestVoiceSummarySweep } from './guest-voice/run-guest-voice-summary-sweep.server'
import { createCorrectReviewMention } from './analysis/correct-review-mention.server'
import { createAiAuthorizationAdapter } from './consent/ai-authorization.adapter.server'
import { createAiControlAdapter } from './infrastructure/adapters/ai-control.adapter'
import { createAiOperationStoreAdapter } from './execution/ai-operation-store.adapter.server'
import { createAiOutputStoreAdapter } from './analysis/ai-output-store.adapter.server'
import { createPropertyVocabularyContextAdapter } from './analysis/property-vocabulary-context.adapter.server'
import { createOperatorProviderChoice } from './analysis/ai-provider-choice.adapter.server'
import { createAiPropertyCalendarAdapter } from './guest-voice/ai-property-calendar.adapter.server'
import { createAiProfileRebuild } from './analysis/ai-profile-rebuild.server'
import { createAiPropertyAggregateStoreAdapter } from './analysis/ai-property-aggregate-store.adapter.server'
import { createAiGuestVoiceFactsAdapter } from './guest-voice/ai-guest-voice-facts.adapter.server'
import { createAiGuestVoiceSummaryScheduleAdapter } from './guest-voice/ai-guest-voice-summary-schedule.adapter.server'
import { createAiMentionCorrectionStoreAdapter } from './analysis/ai-mention-correction-store.adapter.server'
import { findCurrentReviewIdsByIssue } from './analysis/ai-current-issue-review-ids.server'
import { createAiReviewAnalysisReceiptWriter } from './analysis/ai-review-analysis-receipt.adapter.server'
import { createAiReviewEventStoreAdapter } from './analysis/ai-review-event-store.adapter.server'
import { createPropertyProcessingProfileAdapter } from './analysis/property-processing-profile.adapter.server'
import { createReviewAnalysisEnrollmentAdapter } from './replay/enrollment-store.server'
import { createAiReviewAnalysisReopenAdapter } from './replay/reopen-store.server'
import { createRedisAiLaneAdmissionAdapter } from './execution/ai-lane-admission.adapter.server'
import { createAiReviewAnalysisBacklogAdapter } from './replay/backlog-store.server'
import { createAiOrganizationSpendAdapter } from './execution/ai-organization-spend.adapter.server'
import {
  createDrainReviewAnalysisBacklog,
  type AuthorizeReviewAnalysisScope,
} from './replay/drain-backlog.server'
import { createReadReviewAnalysisProgress } from './replay/read-review-analysis-progress.server'
import {
  createRequestReviewAnalysisNow,
  type RequestReviewAnalysisNowDependencies,
} from './replay/request-review-analysis-now.server'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { registerAiConsumers } from './analysis/outbox-consumers.server'
import { createReadReviewAnalysisEnrollmentReadiness } from './replay/get-enrollment-readiness.server'

const unavailableInference: AiInferencePort = Object.freeze({
  analyzeReview: async () => ({
    route: 'review-analysis' as const,
    status: 'error' as const,
    code: 'provider_unavailable' as const,
    retryAfterEpochMillis: null,
  }),
  generateReply: async () => ({
    route: 'reply-suggestion' as const,
    status: 'error' as const,
    code: 'provider_unavailable' as const,
    retryAfterEpochMillis: null,
  }),
})

const unavailableAdmission: AiAdmissionPort = Object.freeze({
  acquire: async () => ({
    ok: false as const,
    code: 'admission_unavailable' as const,
  }),
  release: async () => {},
})

const unavailableSubjectHmac: AiSubjectHmacPort = Object.freeze({
  sign: () => {
    throw new Error('AI subject HMAC authority is unavailable')
  },
})

import type { ReplyScopeEffects } from '#/shared/db/reply-scope-effects'

export type AiContextBuildInput = Readonly<{
  replyEffects: ReplyScopeEffects
  db: Database
  outboxRepo: OutboxRepository
  redis: Redis | undefined
  reviewSources: AiReviewSourcePort
  /** Identity's current grants: every reader-facing read authorizes its reader. */
  propertyAccess: AiPropertyAccess
  propertyReplyLanguages: GenerateReplySuggestionDependencies['propertyReplyLanguages']
  replyBrandProfiles: PortalAiReplyBrandProfilePublicApi
  replyVoices: GenerateReplySuggestionDependencies['replyVoices']
  inference?: AiInferencePort
  admission?: AiAdmissionPort
  subjectHmac?: AiSubjectHmacPort
  /**
   * Which provider a v3 review analysis is claimed under. Left out, it is the
   * operator's choice, which names OpenAI alone (`OPERATOR_PROVIDER_SELECTION`);
   * a test hands in its own.
   */
  providerChoice?: AiProviderChoicePort
  resolveReplyLanguage?: GenerateReplySuggestionDependencies['resolveReplyLanguage']
  /** Hands one waiting review to the worker's on-demand analysis job. */
  enqueueReviewAnalysisNow?: RequestReviewAnalysisNowDependencies['enqueueReviewAnalysisNow']
  /**
   * Current platform policy for one Organization and Property, asked by the
   * review event consumer before it analyses a review on delivery. Without it
   * the consumer queues every review for the backlog drain, which asks the
   * same question of each entry.
   */
  authorizeReviewAnalysisScope?: AuthorizeReviewAnalysisScope
  /**
   * Records Review Analysis backlog entries whose attempt threw. Optional so
   * existing constructions keep working; without it the drain says nothing.
   */
  logger?: Pick<LoggerPort, 'warn'>
  idGen: () => string
  nowEpochMillis: () => number
}>

export const buildAiContext = (input: AiContextBuildInput) => {
  const nowEpochMillis = input.nowEpochMillis
  const clock = () => new Date(nowEpochMillis())
  const authorization = createAiAuthorizationAdapter(input.db)
  const control = createAiControlAdapter(input.db, input.replyEffects)
  const operations = createAiOperationStoreAdapter(input.db, input.idGen)
  const outputs = createAiOutputStoreAdapter(input.db, input.replyBrandProfiles)
  const aggregates = createAiPropertyAggregateStoreAdapter(input.db)
  const calendar = createAiPropertyCalendarAdapter(input.db)
  const reviewEvents = createAiReviewEventStoreAdapter(input.db)
  const backlog = createAiReviewAnalysisBacklogAdapter(input.db)
  const organizationSpend = createAiOrganizationSpendAdapter(input.db)
  const enrollments = createReviewAnalysisEnrollmentAdapter(input.db, input.idGen)
  const processingProfiles = createPropertyProcessingProfileAdapter(
    input.db,
    clock,
    input.replyEffects,
  )
  const inference = input.inference ?? unavailableInference
  const admission =
    input.admission ??
    (input.redis
      ? createRedisAiLaneAdmissionAdapter(input.redis, input.idGen)
      : unavailableAdmission)
  const reviewAnalysisContract = createReviewAnalysisContractV3({
    outputs,
    vocabularyContext: createPropertyVocabularyContextAdapter(input.db),
    providerChoice: input.providerChoice ?? createOperatorProviderChoice(),
  })
  const analyzeReviewEvent = createAnalyzeReviewEvent({
    contract: reviewAnalysisContract,
    authorization,
    control,
    inference,
    operations,
    outputs,
    aggregates,
    admission,
    reviewEvents,
    reviewSources: input.reviewSources,
    processingProfiles,
    subjectHmac: input.subjectHmac ?? unavailableSubjectHmac,
    nowEpochMillis,
  })
  const reapAiOperations = createAiOperationExecutionReaper({
    store: operations,
    aggregates,
    recordAnalysisReceipt: createAiReviewAnalysisReceiptWriter(input.db),
    nowEpochMillis,
    logger: input.logger,
  })
  const advanceReviewAnalysisEnrollments = createAdvanceReviewAnalysisEnrollments({
    authorization,
    control,
    enrollments,
    reopen: createAiReviewAnalysisReopenAdapter(input.db),
    rebuildProfiles: createAiProfileRebuild(input.db, input.logger).sweep,
    nowEpochMillis,
    logger: input.logger,
  })
  const applyAiAuthorizationLifecycle = createApplyAiAuthorizationLifecycle({
    enrollments,
  })
  const approveReviewAnalysisEnrollment = createApproveReviewAnalysisEnrollment({
    enrollments,
  })
  const readReviewAnalysisEnrollmentReadiness =
    createReadReviewAnalysisEnrollmentReadiness({
      authorization,
      control,
      enrollments,
    })
  const drainReviewAnalysisBacklog = createDrainReviewAnalysisBacklog({
    backlog,
    analyzeReviewEvent,
    nowEpochMillis,
    logger: input.logger,
    advanceEnrollment: advanceReviewAnalysisEnrollments.advanceProperty,
  })
  const readReviewAnalysisProgress = createReadReviewAnalysisProgress({
    propertyAccess: input.propertyAccess,
    authorization,
    processingProfiles,
    backlog,
    readEnrollmentReadiness: readReviewAnalysisEnrollmentReadiness,
  })
  const requestReviewAnalysisNow = createRequestReviewAnalysisNow({
    authorization,
    processingProfiles,
    backlog,
    enqueueReviewAnalysisNow:
      input.enqueueReviewAnalysisNow ??
      (async () => {
        throw new Error('AI on-demand review analysis queue is unavailable')
      }),
  })
  // The Monday email (decision 11 of the v3 contract): the same read the Guest voice page
  // is drawn from, planned for the Properties whose Monday morning it is.
  const runGuestVoiceSummarySweep = createRunGuestVoiceSummarySweep({
    schedule: createAiGuestVoiceSummaryScheduleAdapter(input.db),
    plan: createPlanGuestVoiceSummary({
      authorization,
      processingProfiles,
      calendar,
      facts: createAiGuestVoiceFactsAdapter(input.db),
      reviewSources: input.reviewSources,
      nowEpochMillis,
    }),
    nowEpochMillis,
    logger: input.logger ?? { warn: () => {} },
  })
  const readDependencies = {
    propertyAccess: input.propertyAccess,
    authorization,
    outputs,
    processingProfiles,
    nowEpochMillis,
    reviewAnalysisProfileVersion: reviewAnalysisContract.operationProfile.profileVersion,
  }
  let replyLanguageDetector:
    Awaited<ReturnType<typeof createCld3ReplyLanguageDetector>> | undefined
  const resolveReplyLanguage =
    input.resolveReplyLanguage ??
    (async (
      request: Parameters<GenerateReplySuggestionDependencies['resolveReplyLanguage']>[0],
    ) => {
      replyLanguageDetector ??= await createCld3ReplyLanguageDetector()
      return resolveConcreteReplyLanguage({
        ...request,
        detector: replyLanguageDetector,
      })
    })

  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    registerAiConsumers(consumerRegistry, {
      analyzeReviewEvent,
      applyAiAuthorizationLifecycle,
      advanceEnrollment: advanceReviewAnalysisEnrollments.advanceProperty,
      receipts: input.outboxRepo,
      backlog,
      authorizeScope: input.authorizeReviewAnalysisScope,
      nowEpochMillis,
      logger: input.logger,
    })
  }

  return Object.freeze({
    publicApi: Object.freeze({
      readReplyDraftingConsent: createReadReplyDraftingConsent(
        authorization,
        input.propertyAccess,
      ),
      recordDraftMeasurement: (
        scope: Parameters<typeof recordDraftMeasurementEvent>[1],
        event: Parameters<typeof recordDraftMeasurementEvent>[2],
      ) => recordDraftMeasurementEvent(input.db, scope, event),
      generateReplySuggestion: createGenerateReplySuggestion({
        logger: input.logger,
        measurements: {
          record: (measurement) => recordDraftGeneration(input.db, measurement),
        },
        authorization,
        control,
        inference,
        operations,
        outputs,
        admission,
        reviewSources: input.reviewSources,
        processingProfiles,
        propertyReplyLanguages: input.propertyReplyLanguages,
        replyBrandProfiles: input.replyBrandProfiles,
        replyVoices: input.replyVoices,
        resolveReplyLanguage,
        nowEpochMillis,
      }),
      readReviewAnalysis: createReadReviewAnalysis(readDependencies),
      readReviewAnalysisProgress,
      requestReviewAnalysisNow,
      readOrganizationAiSpend: (request: Readonly<{ organizationId: OrganizationId }>) =>
        organizationSpend.readCurrentMonth({
          organizationId: request.organizationId,
          nowEpochMillis: nowEpochMillis(),
        }),
      findCurrentReviewIdsByAttention: (
        request: Omit<
          Parameters<AiOutputStorePort['findCurrentReviewIdsByAttention']>[0],
          'nowEpochMillis'
        >,
      ) =>
        outputs.findCurrentReviewIdsByAttention({
          ...request,
          nowEpochMillis: nowEpochMillis(),
        }),
      findCurrentReviewIdsByIssue: (
        request: Omit<
          Parameters<typeof findCurrentReviewIdsByIssue>[1],
          'nowEpochMillis'
        >,
      ) =>
        findCurrentReviewIdsByIssue(input.db, {
          ...request,
          nowEpochMillis: nowEpochMillis(),
        }),
      correctReviewMention: createCorrectReviewMention({
        propertyAccess: input.propertyAccess,
        authorization,
        processingProfiles,
        corrections: createAiMentionCorrectionStoreAdapter(input.db),
        nowEpochMillis,
      }),
      readGuestVoiceV2: createReadGuestVoiceV2({
        ...readDependencies,
        facts: createAiGuestVoiceFactsAdapter(input.db),
        calendar,
        reviewSources: input.reviewSources,
      }),
      readGuestVoiceDetail: createReadGuestVoiceDetail({
        ...readDependencies,
        facts: createAiGuestVoiceFactsAdapter(input.db),
        calendar,
        reviewSources: input.reviewSources,
      }),
    }),
    worker: Object.freeze({
      registerOutboxConsumers,

      advanceReviewAnalysisEnrollments,
      drainReviewAnalysisBacklog,
      runGuestVoiceSummarySweep,
      reapAiOperations,
    }),
    internal: Object.freeze({
      repos: Object.freeze({}),
      useCases: Object.freeze({
        analyzeReviewEvent,
        advanceReviewAnalysisEnrollments,
        approveReviewAnalysisEnrollment,
        readReviewAnalysisEnrollmentReadiness,
      }),
    }),
  })
}
