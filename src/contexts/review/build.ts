// Review context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the review context.

import { reviewError } from './domain/errors'
import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { GoogleReviewApiPort } from './application/ports/google-review-api.port'
import type { PropertyRoutingPort } from './application/ports/property-routing.port'
import type { ReviewRepository } from './application/ports/review.repository'
import type { ReplyRepository } from './application/ports/reply.repository'
import type { ReviewQueuePort } from './application/ports/review-queue.port'
import type {
  PublishReplyJobData,
  ReplyQueuePort,
} from './application/ports/reply-queue.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyProcessingScopePublicApi } from '#/contexts/property/application/public-api'
import type { AiReplyProvenancePublicKeyring } from './application/ports/ai-suggested-draft-store.port'
import { createReviewRepository } from './infrastructure/repositories/review.repository'
import { createReplyRepository } from './infrastructure/repositories/reply.repository'
import { createServingStats } from './infrastructure/serving-stats'
import type { ReviewServingStats } from './application/ports/serving-stats.port'
import { createAtomicReviewCommandStore } from './infrastructure/review-command-store'
import { createAtomicReplyCommandStore } from './infrastructure/reply-command-store'
import { createReviewProviderObservationWriter } from './application/use-cases/sync-reviews'
import { createAiReviewSource } from './application/ai-review-source'
import { createAiSuggestedDraftStore } from './infrastructure/ai-suggested-draft-store'
import {
  createReviewProviderSubjectKeyService,
  createUnavailableReviewProviderSubjectKeyService,
  type ReviewProviderSubjectKeyService,
  type ReviewProviderSubjectSecretKeyring,
} from './application/provider-subject-keyring'
import { createReviewProviderSubjectKeyInventoryRepository } from './infrastructure/provider-subject-key-inventory.repository'
import { createReviewProviderSnapshotRepository } from './infrastructure/repositories/review-provider-snapshot.repository'
import { createReviewSyncActivityRecorder } from './infrastructure/repositories/review-sync-activity.repository'
import { runReviewProviderSnapshot } from './application/use-cases/run-review-provider-snapshot'
import {
  draftReply,
  submitReply,
  approveReply,
  rejectReply,
  deleteReply,
  getReply,
  retryPublish,
  editPublishedReply,
} from './application/use-cases/reply-operations'
import { reconcileReplyPublication } from './application/use-cases/reconcile-reply-publication'
import { cancelPublicationsForConnection } from './application/use-cases/cancel-publications'
import { getStaffRecentActivity } from './application/use-cases/get-staff-recent-activity'
import { createEligibleReads, type EligibleReads } from './application/eligible-reads'
import { reviewId, replyId } from '#/shared/domain/ids'
import { jobEnqueueOptions } from '#/shared/jobs/job-policy'
import { createJobExecutionEnvelope } from '#/shared/jobs/delayed-execution-gate'
import { registerReviewHandlers } from './infrastructure/event-handlers'
import { createPublishReplyScopeResolver } from './infrastructure/jobs/publish-reply-scope-resolver'
import { JOB_NAME as PUBLISH_REPLY_JOB_NAME } from './infrastructure/jobs/publish-reply.job'
import type {
  ProcessingRouter,
  RoutingEnvelope,
  WorkloadClass,
} from '#/shared/routing/processing-router'

export type ReviewContextBuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  googleReviewApi: GoogleReviewApiPort
  jobQueue: Queue | undefined
  logger: LoggerPort
  staffPublicApi: StaffPublicApi
  /**
   * BQC-4.1: fail-closed region gate for review sync (ADR 0048). The property
   * context owns the routing fact — the build wraps its public API into
   * review's PropertyRoutingPort.
   */
  propertyApi: PropertyProcessingScopePublicApi
  /**
   * BQC-4.2: stamps the content-free routing envelope on sync/publish job
   * payloads at enqueue. Optional — when absent (or when resolution fails),
   * jobs enqueue UNSTAMPED and the worker's dispatch-time routing gate
   * remains the authority (ADR 0048).
   */
  processingRouter?: ProcessingRouter
  /** Worker-only Review provider-subject key material; absent on web. */
  providerSubjectKeyring?: ReviewProviderSubjectSecretKeyring
  /** Web-side verification keys for browser-held AI reply suggestions. */
  aiReplyProvenancePublicKeys?: AiReplyProvenancePublicKeyring
}>

export type ReviewContextApi = Readonly<{
  /** BQC-1.4: the governed read interface for review content. */
  publicApi: EligibleReads
  internal: Readonly<{
    repos: Readonly<{
      reviewRepo: ReviewRepository
      replyRepo: ReplyRepository
      queue: ReviewQueuePort
      replyQueue: ReplyQueuePort
    }>
    useCases: Readonly<{
      runReviewProviderSnapshot: ReturnType<typeof runReviewProviderSnapshot>
      draftReply: ReturnType<typeof draftReply>
      submitReply: ReturnType<typeof submitReply>
      approveReply: ReturnType<typeof approveReply>
      editPublishedReply: ReturnType<typeof editPublishedReply>
      rejectReply: ReturnType<typeof rejectReply>
      deleteReply: ReturnType<typeof deleteReply>
      getReply: ReturnType<typeof getReply>
      retryPublish: ReturnType<typeof retryPublish>
      reconcileReplyPublication: ReturnType<typeof reconcileReplyPublication>
      getStaffRecentActivity: ReturnType<typeof getStaffRecentActivity>
    }>
    /**
     * BQC-5.5: review-owned governed aggregate serving reads (ADR 0031
     * eligibility enforced here). Composition passes this to foreign
     * consumers (dashboard) as their review-stats dep port.
     */
    servingStats: ReviewServingStats
    /** Content-minimized Review source for authorized AI workloads. */
    aiReviewSource: ReturnType<typeof createAiReviewSource>
    /** Masked-inventory-verified derivation/rotation authority for Review writers. */
    providerSubjectKeys: ReviewProviderSubjectKeyService
  }>
}>

export const buildReviewContext = (input: ReviewContextBuildInput): ReviewContextApi => {
  const reviewRepo = createReviewRepository(input.db)
  const replyRepo = createReplyRepository(input.db)
  const providerSubjectKeys = input.providerSubjectKeyring
    ? createReviewProviderSubjectKeyService({
        keyring: input.providerSubjectKeyring,
        repository: createReviewProviderSubjectKeyInventoryRepository(input.db),
      })
    : createUnavailableReviewProviderSubjectKeyService()

  if (!input.jobQueue)
    throw reviewError(
      'build_config_error',
      'jobQueue is required to build review context',
    )
  const jobQueue = input.jobQueue

  // BQC-4.2: stamp the content-free routing envelope at enqueue. The stamp is
  // telemetry — the worker re-resolves routing at dispatch and the fresh
  // decision is the authority (a payload region is never accepted on its
  // own). Best-effort: a blocked decision, a lookup failure, or a missing
  // router degrades to an UNSTAMPED envelope; the job still enqueues.
  const stampRouting = async (
    propertyId: string | undefined,
    workloadClass: WorkloadClass,
  ): Promise<RoutingEnvelope | undefined> => {
    const router = input.processingRouter
    if (!router || !propertyId) return undefined
    try {
      const subject = { kind: 'property', propertyId } as const
      const decision = await router.resolve(subject, workloadClass)
      if (decision.kind !== 'target') return undefined
      return {
        subject,
        cell: decision.cell,
        region: decision.region,
        workloadClass,
        routingPolicyVersion: decision.routingPolicyVersion,
      }
    } catch (err) {
      input.logger.warn(
        { err, workloadClass },
        'routing envelope stamp failed at enqueue — enqueueing unstamped (dispatch gate is the authority)',
      )
      return undefined
    }
  }

  // Publish envelopes carry replyId only — resolve reply → propertyId at
  // enqueue with the same identifier-only lookup the dispatch gate uses.
  const resolvePublishPropertyId = createPublishReplyScopeResolver({ db: input.db })
  const stampPublishRouting = async (
    data: PublishReplyJobData,
  ): Promise<RoutingEnvelope | undefined> => {
    if (!input.processingRouter) return undefined
    let propertyId: string | undefined
    try {
      propertyId = await resolvePublishPropertyId(PUBLISH_REPLY_JOB_NAME, data)
    } catch (err) {
      input.logger.warn(
        { err },
        'publish routing scope lookup failed at enqueue — enqueueing unstamped (dispatch gate is the authority)',
      )
      return undefined
    }
    return stampRouting(propertyId, 'reply.publish')
  }

  const queue: ReviewQueuePort = {
    addSyncJob: async (data, options) => {
      const routing = await stampRouting(data.propertyId, 'review.sync')
      const execution = createJobExecutionEnvelope({
        organizationId: data.organizationId,
        propertyId: data.propertyId,
        capability: 'property.connect_gbp',
        initiator: data.initiator ?? { kind: 'system', id: 'queue:review-sync' },
        correlationId: data.correlationId,
      })
      await jobQueue.add(
        'sync-property-reviews',
        { ...data, ...execution, ...(routing ? { routing } : {}) },
        {
          jobId: options?.jobId,
          ...(options?.delayMs === undefined ? {} : { delay: options.delayMs }),
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          // BQC-3.6: attempts/backoff+jitter/timeout from the job catalogue.
          ...jobEnqueueOptions('sync-property-reviews'),
        },
      )
    },
  }

  const replyQueue: ReplyQueuePort = {
    addPublishJob: async (data, options) => {
      const routing = await stampPublishRouting(data)
      const execution = createJobExecutionEnvelope({
        organizationId: data.organizationId,
        propertyId:
          routing?.subject.kind === 'property' ? routing.subject.propertyId : undefined,
        capability: 'property.publish_reply',
        initiator: data.initiator ?? { kind: 'system', id: 'queue:reply-publish' },
        correlationId: data.correlationId,
      })
      await jobQueue.add(
        'publish-reply',
        { ...data, ...execution, ...(routing ? { routing } : {}) },
        {
          // BQC-3.3: saga idempotency key as BullMQ jobId — a duplicate enqueue
          // of the same approval cycle is deduped by the queue.
          jobId: options?.idempotencyKey,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
          // BQC-3.6: attempts/backoff+jitter/timeout from the job catalogue
          // (exponential:5000 + 120s timeout for publish-reply).
          ...jobEnqueueOptions('publish-reply'),
        },
      )
    },
  }

  // Read the cell and source epoch atomically so review synchronization can
  // reject provider results after a relink/disconnect race.
  const propertyRoutingLookup: PropertyRoutingPort = {
    getProcessingScope: (orgId, pid) => input.propertyApi.getProcessingScope(orgId, pid),
  }

  // BQC-3.3: atomic reply state + outbox writes for the reply command family.
  // This closes the replyDeps wiring gap — reply facts were previously
  // bus-only in production because replyDeps never received outboxRepo.
  const replyCommandStore = createAtomicReplyCommandStore(input.db, input.events)

  const replyDeps = {
    replyRepo,
    reviewRepo,
    queue: replyQueue,
    commandStore: replyCommandStore,
    aiSuggestedDraftStore: input.aiReplyProvenancePublicKeys
      ? createAiSuggestedDraftStore(input.db, input.aiReplyProvenancePublicKeys)
      : undefined,
    googleReviewApi: input.googleReviewApi,
    clock: input.clock,
    idGen: () => replyId(crypto.randomUUID()),
    staffPublicApi: input.staffPublicApi,
  }

  registerReviewHandlers({
    events: input.events,
    // BQC-3.8: disconnect cancels in-flight publications before/with the
    // source-content purge (the guarded store tolerates the race).
    cancelPublicationsForConnection: cancelPublicationsForConnection({
      reviewRepo,
      replyRepo,
      commandStore: replyCommandStore,
      clock: input.clock,
    }),
  })

  // BQR-2.3: atomic review upsert + outbox insert for sync path
  const commandStore = createAtomicReviewCommandStore(input.db, input.events)

  const observationWriter = createReviewProviderObservationWriter({
    reviewRepo,
    replyRepo,
    clock: input.clock,
    idGen: () => reviewId(crypto.randomUUID()),
    replyIdGen: () => replyId(crypto.randomUUID()),
    commandStore,
    replyCommandStore,
  })
  const useCases = {
    runReviewProviderSnapshot: runReviewProviderSnapshot({
      repository: createReviewProviderSnapshotRepository(input.db, input.events),
      googleReviewApi: input.googleReviewApi,
      propertyRouting: propertyRoutingLookup,
      observationWriter,
      subjectKeyService: providerSubjectKeys,
      // Discovery-ladder activity stamps (migration 0071): a page that
      // persisted a review we had never seen marks the property live.
      syncActivity: createReviewSyncActivityRecorder(input.db),
      clock: input.clock,
    }),
    draftReply: draftReply(replyDeps),
    submitReply: submitReply(replyDeps),
    approveReply: approveReply(replyDeps),
    rejectReply: rejectReply(replyDeps),
    deleteReply: deleteReply(replyDeps),
    getReply: getReply(replyDeps),
    retryPublish: retryPublish(replyDeps),
    editPublishedReply: editPublishedReply(replyDeps),
    reconcileReplyPublication: reconcileReplyPublication({
      replyRepo,
      reviewRepo,
      googleReviewApi: input.googleReviewApi,
      commandStore: replyCommandStore,
      clock: input.clock,
    }),
    getStaffRecentActivity: getStaffRecentActivity({
      reviewRepo,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
    }),
  }

  return {
    publicApi: createEligibleReads({ reviewRepo, clock: input.clock }),
    internal: {
      repos: {
        reviewRepo,
        replyRepo,
        queue,
        replyQueue,
      },
      useCases,
      // BQC-5.5: governed aggregate serving reads — eligibility in SQL,
      // clock-injected. Wired into the dashboard build by composition.
      servingStats: createServingStats({ db: input.db, clock: input.clock }),
      aiReviewSource: createAiReviewSource({
        readForAi: reviewRepo.readForAi,
        readTrendPopulation: reviewRepo.readTrendPopulation,
        assertCurrentForAi: reviewRepo.assertCurrentForAi,
        readReplyStateRevision: reviewRepo.readReplyStateRevision,
      }),
      providerSubjectKeys,
    },
  }
}
