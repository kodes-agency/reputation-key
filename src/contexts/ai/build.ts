import type { Database } from '#/shared/db'
import type { Redis } from 'ioredis'
import type { AiReviewSourcePort } from '#/contexts/review/application/public-api'
import {
  createCld3ReplyLanguageDetector,
  resolveConcreteReplyLanguage,
} from '#/shared/ai-reply-language-verifier'
import type { AiInferencePort } from './application/ports/ai-inference.port'
import type { AiQuotaPort } from './application/ports/ai-quota.port'
import type { AiSubjectHmacPort } from './application/ports/ai-subject-hmac.port'
import { createAnalyzeReviewEvent } from './application/use-cases/analyze-review-event'
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
import { createAiRuntimeCatalogueAdapter } from './infrastructure/adapters/ai-runtime-catalogue.adapter'
import { createPropertyProcessingProfileAdapter } from './infrastructure/adapters/property-processing-profile.adapter'
import { createRedisAiQuotaAdapter } from './infrastructure/adapters/ai-quota.adapter'
import { createAiDataLifecycle } from './infrastructure/ai-data-lifecycle'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import {
  registerAiConsumers,
  type RegisterAiConsumersInput,
} from './infrastructure/outbox-consumers'

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
  redis: Redis | undefined
  reviewSources: AiReviewSourcePort
  inference?: AiInferencePort
  quota?: AiQuotaPort
  subjectHmac?: AiSubjectHmacPort
  resolveReplyLanguage?: GenerateReplySuggestionDependencies['resolveReplyLanguage']
  enqueuePropertyTrend?: RegisterAiConsumersInput['enqueuePropertyTrend']
  nowEpochMillis?: () => number
}>

export function buildAiContext(input: AiContextBuildInput) {
  const dataLifecycle = input.redis
    ? createAiDataLifecycle(input.db, input.redis)
    : undefined
  const authorization = createAiAuthorizationAdapter(input.db)
  const control = createAiControlAdapter(input.db)
  const operations = createAiOperationStoreAdapter(input.db)
  const outputs = createAiOutputStoreAdapter(input.db)
  const aggregates = createAiPropertyAggregateStoreAdapter(input.db)
  const schedules = createAiPropertyTrendScheduleStore(input.db)
  const calendar = createAiPropertyCalendarAdapter(input.db)
  const reviewEvents = createAiReviewEventStoreAdapter(input.db)
  const processingProfiles = createPropertyProcessingProfileAdapter(
    input.db,
    createAiRuntimeCatalogueAdapter(input.db),
  )
  const inference = input.inference ?? unavailableInference
  const quota =
    input.quota ??
    (input.redis ? createRedisAiQuotaAdapter(input.redis) : unavailableQuota)
  const nowEpochMillis = input.nowEpochMillis ?? Date.now
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
    internal: Object.freeze({
      analyzeReviewEvent,
      registerOutboxConsumers: () => {
        if (!input.enqueuePropertyTrend) {
          throw new Error('AI property trend queue is unavailable')
        }
        registerAiConsumers({
          enqueuePropertyTrend: input.enqueuePropertyTrend,
          analyzeReviewEvent,
          receipts: createOutboxRepository(input.db),
        })
      },
      generatePropertyTrend: createGeneratePropertyTrend({
        authorization,
        control,
        inference,
        operations,
        outputs,
        aggregates,
        schedules,
        quota,
        processingProfiles,
        nowEpochMillis,
      }),
      schedulePropertyTrends: createSchedulePropertyTrends({ schedules }),
      dataLifecycle,
    }),
  })
}
