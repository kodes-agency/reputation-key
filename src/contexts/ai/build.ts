import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import {
  createCld3ReplyLanguageDetector,
  resolveConcreteReplyLanguage,
} from '#/shared/ai-reply-language-verifier'
import type { AiInferencePort } from './application/ports/ai-inference.port'
import type { AiQuotaPort } from './application/ports/ai-quota.port'
import type { AiSubjectHmacPort } from './application/ports/ai-subject-hmac.port'
import type { PropertyReplyLanguagePort } from './application/ports/property-reply-language.port'
import { createAnalyzeReviewEvent } from './application/use-cases/analyze-review-event'
import { createAdvanceReviewAnalysisEnrollments } from './application/use-cases/advance-review-analysis-enrollments'
import { createApplyAiAuthorizationLifecycle } from './application/use-cases/apply-ai-authorization-lifecycle'
import { createApproveReviewAnalysisEnrollment } from './application/use-cases/approve-review-analysis-enrollment'
import type { AiOutputStorePort } from './application/ports/ai-output-store.port'
import { createGenerateReplySuggestion } from './application/use-cases/generate-reply-suggestion'
import type { GenerateReplySuggestionDependencies } from './application/use-cases/generate-reply-suggestion'
import { createGeneratePropertyTrend } from './application/use-cases/generate-property-trend'
import { createSchedulePropertyTrends } from './application/use-cases/schedule-property-trends'
import {
  createReadPropertyTrend,
  createReadReviewAnalysis,
} from './application/use-cases/read-ai-insights'
import { createReadPropertyAggregates } from './application/use-cases/read-property-aggregates'
import { createAiAuthorizationAdapter } from './infrastructure/adapters/ai-authorization.adapter'
import { createAiControlAdapter } from './infrastructure/adapters/ai-control.adapter'
import { createAiOperationStoreAdapter } from './infrastructure/adapters/ai-operation-store.adapter'
import { createAiOutputStoreAdapter } from './infrastructure/adapters/ai-output-store.adapter'
import { createAiPropertyCalendarAdapter } from './infrastructure/adapters/ai-property-calendar.adapter'
import { createAiPropertyAggregateStoreAdapter } from './infrastructure/adapters/ai-property-aggregate-store.adapter'
import { createAiPropertyTrendScheduleStore } from './infrastructure/adapters/ai-property-trend-schedule-store.adapter'
import { createAiReviewEventStoreAdapter } from './infrastructure/adapters/ai-review-event-store.adapter'
import { createPropertyProcessingProfileAdapter } from './infrastructure/adapters/property-processing-profile.adapter'
import { createReviewAnalysisEnrollmentAdapter } from './infrastructure/adapters/ai-review-analysis-enrollment.adapter'
import { createRedisAiQuotaAdapter } from './infrastructure/adapters/ai-quota.adapter'
import { createAiOrganizationExportContributor } from './infrastructure/adapters/ai-organization-export.adapter'
import { createAiOrganizationLifecycleContributor } from './infrastructure/adapters/ai-organization-lifecycle.adapter'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import {
  registerAiConsumers,
  type RegisterAiConsumersInput,
} from './infrastructure/outbox-consumers'
import { createReadReviewAnalysisEnrollmentReadiness } from './application/use-cases/read-review-analysis-enrollment-readiness'

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
  generateTrend: async () => ({
    route: 'property-trend' as const,
    status: 'error' as const,
    code: 'provider_unavailable' as const,
    retryAfterEpochMillis: null,
  }),
})

const unavailableQuota: AiQuotaPort = Object.freeze({
  acquire: async () => ({
    ok: false as const,
    code: 'provider_unavailable' as const,
  }),
  release: async () => {},
})

const unavailableSubjectHmac: AiSubjectHmacPort = Object.freeze({
  sign: () => {
    throw new Error('AI subject HMAC authority is unavailable')
  },
})

export type AiContextBuildInput = Readonly<{
  db: Database
  outboxRepo: OutboxRepository
  redis: Redis | undefined
  reviewSources: AiReviewSourcePort
  propertyReplyLanguages: PropertyReplyLanguagePort
  replyBrandProfiles: PortalAiReplyBrandProfilePublicApi
  inference?: AiInferencePort
  quota?: AiQuotaPort
  subjectHmac?: AiSubjectHmacPort
  resolveReplyLanguage?: GenerateReplySuggestionDependencies['resolveReplyLanguage']
  enqueuePropertyTrend?: RegisterAiConsumersInput['enqueuePropertyTrend']
  idGen: () => string
  nowEpochMillis: () => number
}>

export const buildAiContext = (input: AiContextBuildInput) => {
  const nowEpochMillis = input.nowEpochMillis
  const clock = () => new Date(nowEpochMillis())
  const authorization = createAiAuthorizationAdapter(input.db)
  const control = createAiControlAdapter(input.db)
  const operations = createAiOperationStoreAdapter(input.db, input.idGen)
  const outputs = createAiOutputStoreAdapter(input.db, input.replyBrandProfiles)
  const aggregates = createAiPropertyAggregateStoreAdapter(input.db)
  const schedules = createAiPropertyTrendScheduleStore(input.db, input.idGen)
  const calendar = createAiPropertyCalendarAdapter(input.db)
  const reviewEvents = createAiReviewEventStoreAdapter(input.db)
  const enrollments = createReviewAnalysisEnrollmentAdapter(input.db, input.idGen)
  const processingProfiles = createPropertyProcessingProfileAdapter(input.db, clock)
  const inference = input.inference ?? unavailableInference
  const quota =
    input.quota ??
    (input.redis ? createRedisAiQuotaAdapter(input.redis, input.idGen) : unavailableQuota)
  const analyzeReviewEvent = createAnalyzeReviewEvent({
    authorization,
    control,
    inference,
    operations,
    outputs,
    aggregates,
    quota,
    reviewEvents,
    reviewSources: input.reviewSources,
    processingProfiles,
    subjectHmac: input.subjectHmac ?? unavailableSubjectHmac,
    nowEpochMillis,
  })
  const advanceReviewAnalysisEnrollments = createAdvanceReviewAnalysisEnrollments({
    authorization,
    control,
    enrollments,
    nowEpochMillis,
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
  const generatePropertyTrend = createGeneratePropertyTrend({
    authorization,
    aggregates,
    schedules,
    processingProfiles,
    reviewSources: input.reviewSources,
    nowEpochMillis,
  })
  const schedulePropertyTrends = createSchedulePropertyTrends({ schedules })
  const readDependencies = {
    authorization,
    outputs,
    processingProfiles,
    nowEpochMillis,
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
    if (!input.enqueuePropertyTrend) {
      throw new Error('AI property trend queue is unavailable')
    }
    registerAiConsumers(consumerRegistry, {
      enqueuePropertyTrend: input.enqueuePropertyTrend,
      analyzeReviewEvent,
      applyAiAuthorizationLifecycle,
      receipts: input.outboxRepo,
    })
  }

  return Object.freeze({
    publicApi: Object.freeze({
      generateReplySuggestion: createGenerateReplySuggestion({
        authorization,
        control,
        inference,
        operations,
        outputs,
        quota,
        reviewSources: input.reviewSources,
        processingProfiles,
        propertyReplyLanguages: input.propertyReplyLanguages,
        replyBrandProfiles: input.replyBrandProfiles,
        resolveReplyLanguage,
        nowEpochMillis,
      }),
      readReviewAnalysis: createReadReviewAnalysis(readDependencies),
      readPropertyTrend: createReadPropertyTrend(readDependencies),
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
      findCurrentReviewIdsByCategory: (
        request: Omit<
          Parameters<AiOutputStorePort['findCurrentReviewIdsByCategory']>[0],
          'nowEpochMillis'
        >,
      ) =>
        outputs.findCurrentReviewIdsByCategory({
          ...request,
          nowEpochMillis: nowEpochMillis(),
        }),
      readPropertyAggregates: createReadPropertyAggregates({
        ...readDependencies,
        aggregates,
        calendar,
      }),
    }),
    // LIF-01: the Organization Export contribution the Identity bundle builder
    // demands from this context. It is exposed here and never on `publicApi`:
    // the three AI capabilities stay dark, and contributing an export must not
    // make any of them reachable from a request surface.
    lifecycle: Object.freeze({
      organizationExportContributor: createAiOrganizationExportContributor(input.db),
      // LIF-01-T12/T13/T14: the three destructive lifecycle phases. Exposing
      // the contributor does NOT arm it — the coordinator that calls `purge`
      // is composed only under an explicitly reviewed composition, and none of
      // this reaches a request surface.
      organizationLifecycleContributor: createAiOrganizationLifecycleContributor(
        input.db,
      ),
    }),
    worker: Object.freeze({
      registerOutboxConsumers,
      generatePropertyTrend,
      schedulePropertyTrends,
      advanceReviewAnalysisEnrollments,
    }),
    internal: Object.freeze({
      repos: Object.freeze({}),
      useCases: Object.freeze({
        analyzeReviewEvent,
          advanceReviewAnalysisEnrollments,
        approveReviewAnalysisEnrollment,
        readReviewAnalysisEnrollmentReadiness,
        generatePropertyTrend,
        schedulePropertyTrends,
      }),
    }),
  })
}
