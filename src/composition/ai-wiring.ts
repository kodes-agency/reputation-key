import { randomUUID } from 'node:crypto'
import { buildAiContext } from '#/contexts/ai/build'
import {
  createAnalyzeReviewNowEnqueue,
  createPropertyTrendEnqueue,
} from '#/contexts/ai/infrastructure/jobs/ai-job-enqueue'
import { createScheduledScopeAuthorizer } from '#/shared/jobs/delayed-execution-gate'
import { getLogger } from '#/shared/observability/logger'
import { createAiRuntimeProviders } from './provider-runtime'
import type { buildIdentityContext } from '#/contexts/identity/build'
import type { buildPropertyContext } from '#/contexts/property/build'
import type { buildPortalContext } from '#/contexts/portal/build'
import type { ReviewContextApi } from '#/contexts/review/build'
import type { CompositionRuntime, ContextWiringInput } from './runtime'

export function buildAiRuntime({
  options,
  env,
  enableJobs,
  pool,
  clock,
}: CompositionRuntime) {
  const aiRuntime = createAiRuntimeProviders({
    env,
    // ARC-03-T14: injectable so a process fixture boots deterministically; the
    // composition boundary is the ONE place allowed to fall back to ambient state.
    runtimeEnvironment: options?.runtimeEnvironment ?? process.env,
    enableJobs,
    pool,
    clock,
    inferenceOverride: options?.providers?.aiInference,
    subjectHmacOverride: options?.providers?.aiSubjectHmac,
  })
  return aiRuntime
}

export function wireAi(
  { db, outboxRepo, redis, clock, infra }: ContextWiringInput,
  identity: ReturnType<typeof buildIdentityContext>,
  property: ReturnType<typeof buildPropertyContext>,
  portal: ReturnType<typeof buildPortalContext>,
  review: ReviewContextApi,
  aiRuntime: ReturnType<typeof buildAiRuntime>,
) {
  const ai = buildAiContext({
    db,
    outboxRepo,
    redis,
    logger: getLogger(),
    idGen: randomUUID,
    nowEpochMillis: () => clock().getTime(),
    reviewSources: review.publicApi.aiReviewSource,
    propertyAccess: (orgId, uid, orgWide) =>
      identity.publicApi.people.getAccessiblePropertyIds(orgId, uid, orgWide),
    propertyReplyLanguages: {
      readDefaultReplyLanguage: ({ organizationId: orgId, propertyId: pid }) =>
        property.publicApi.getPropertyReplyLanguage(orgId, pid),
    },
    replyBrandProfiles: portal.publicApi.portal,
    replyVoices: review.publicApi.aiReplyVoice,
    inference: aiRuntime.inference,
    subjectHmac: aiRuntime.subjectHmac,
    enqueuePropertyTrend: infra.jobQueue
      ? createPropertyTrendEnqueue(infra.jobQueue)
      : undefined,
    enqueueReviewAnalysisNow: infra.jobQueue
      ? createAnalyzeReviewNowEnqueue(infra.jobQueue)
      : undefined,
    // The review event consumer is ungated at the dispatcher, so that a review
    // arriving during a stop is queued instead of lost. It asks the backlog
    // drain's own policy question before analysing a review on delivery.
    authorizeReviewAnalysisScope: createScheduledScopeAuthorizer(
      'system:ai.review_analysis_backlog_drain',
    ),
  })

  return ai
}
