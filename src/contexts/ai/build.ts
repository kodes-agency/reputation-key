import { createReadReplyDraftingConsent } from './application/read-reply-drafting-consent'
import { recordDraftMeasurementEvent } from '#/shared/db/ai/draft-measurement-events'
import { recordDraftGeneration } from '#/shared/db/ai/draft-generation-measurement'
import type { OrganizationId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import {
  createCld3ReplyLanguageDetector,
  resolveConcreteReplyLanguage,
} from '#/shared/ai-reply-language-verifier'
import type { AiInferencePort } from './application/ports/ai-inference.port'
import type { AiAdmissionPort } from './application/ports/ai-admission.port'
import type { AiSubjectHmacPort } from './application/ports/ai-subject-hmac.port'
import type { AiProviderChoicePort } from './application/ports/ai-provider-choice.port'
import { createReviewAnalysisContractV3 } from './application/review-analysis-contract-v3'
import { createAnalyzeReviewEvent } from './application/use-cases/analyze-review-event'
import { createAiOperationExecutionReaper } from './application/ai-operation-execution-reaper'
import { createAdvanceReviewAnalysisEnrollments } from './replay/advance-enrollments.server'
import { createApplyAiAuthorizationLifecycle } from './application/use-cases/apply-ai-authorization-lifecycle'
import { createApproveReviewAnalysisEnrollment } from './replay/approve-enrollment.server'
import type { AiOutputStorePort } from './application/ports/ai-output-store.port'
import {
  createGenerateReplySuggestion,
  type GenerateReplySuggestionDependencies,
} from './reply/generate-suggestion.server'
import { createReadReviewAnalysis } from './application/use-cases/read-review-analysis'
import type { AiPropertyAccess } from './application/ai-property-read-access'
import { createReadGuestVoiceDetail } from './guest-voice/get-detail.server'
import { createReadGuestVoiceV2 } from './guest-voice/get-guest-voice.server'
import { createPlanGuestVoiceSummary } from './guest-voice/plan-summary.server'
import { createRunGuestVoiceSummarySweep } from './application/use-cases/run-guest-voice-summary-sweep'
import { createCorrectReviewMention } from './application/use-cases/correct-review-mention'
import { createAiAuthorizationAdapter } from './infrastructure/adapters/ai-authorization.adapter'
import { createAiControlAdapter } from './infrastructure/adapters/ai-control.adapter'
import { createAiOperationStoreAdapter } from './infrastructure/adapters/ai-operation-store.adapter'
import { createAiOutputStoreAdapter } from './infrastructure/adapters/ai-output-store.adapter'
import { createPropertyVocabularyContextAdapter } from './infrastructure/adapters/property-vocabulary-context.adapter'
import { createOperatorProviderChoice } from './infrastructure/adapters/ai-provider-choice.adapter'
import { createAiPropertyCalendarAdapter } from './infrastructure/adapters/ai-property-calendar.adapter'
import { createAiProfileRebuild } from './infrastructure/adapters/ai-profile-rebuild'
import { createAiPropertyAggregateStoreAdapter } from './infrastructure/adapters/ai-property-aggregate-store.adapter'
import { createAiGuestVoiceFactsAdapter } from './infrastructure/adapters/ai-guest-voice-facts.adapter'
import { createAiGuestVoiceSummaryScheduleAdapter } from './infrastructure/adapters/ai-guest-voice-summary-schedule.adapter'
import { createAiMentionCorrectionStoreAdapter } from './infrastructure/adapters/ai-mention-correction-store.adapter'
import { findCurrentReviewIdsByIssue } from './infrastructure/adapters/ai-current-issue-review-ids'
import { createAiReviewAnalysisReceiptWriter } from './infrastructure/adapters/ai-review-analysis-receipt.adapter'
import { createAiReviewEventStoreAdapter } from './infrastructure/adapters/ai-review-event-store.adapter'
import { createPropertyProcessingProfileAdapter } from './infrastructure/adapters/property-processing-profile.adapter'
import { createReviewAnalysisEnrollmentAdapter } from './replay/enrollment-store.server'
import { createAiReviewAnalysisReopenAdapter } from './replay/reopen-store.server'
import { createRedisAiLaneAdmissionAdapter } from './infrastructure/adapters/ai-lane-admission.adapter'
import { createAiReviewAnalysisBacklogAdapter } from './replay/backlog-store.server'
import { createAiOrganizationSpendAdapter } from './infrastructure/adapters/ai-organization-spend.adapter'
import {
  createDrainReviewAnalysisBacklog,
  type AuthorizeReviewAnalysisScope,
} from './replay/drain-backlog.server'
import { createReadReviewAnalysisProgress } from './application/use-cases/read-review-analysis-progress'
import {
  createRequestReviewAnalysisNow,
  type RequestReviewAnalysisNowDependencies,
} from './application/use-cases/request-review-analysis-now'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import { registerAiConsumers } from './infrastructure/outbox-consumers'
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
