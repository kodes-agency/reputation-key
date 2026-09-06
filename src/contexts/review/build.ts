// Review context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns the public API surface of the review context.

import { randomUUID } from 'node:crypto'
import { reviewError } from './domain/errors'
import type { Database } from '#/shared/db'
import type { ConsumerRegistry, OutboxRepository } from '#/shared/outbox'
import type { Queue } from 'bullmq'
import type { Pool } from 'pg'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { JobRegistry } from '#/shared/jobs/registry'
import type { GoogleReviewApiPort } from './application/ports/google-review-api.port'
import type { PropertyRoutingPort } from './application/ports/property-routing.port'
import type { ReviewRepository } from './application/ports/review.repository'
import type { ReviewObservationRepository } from './application/ports/review-observation.repository'
import type { ReplyRepository } from './application/ports/reply.repository'
import type { FindAmbiguousPublicationReconciliationCandidates } from './application/ports/publication-reconciliation-maintenance.port'
import type { ReplyCommandStore } from './application/ports/reply-command-store.port'
import type {
  ReviewQueuePort,
  TargetedGoogleReviewQueuePort,
} from './application/ports/review-queue.port'
import type { TargetedGoogleReviewReferenceResolver } from './application/ports/targeted-google-review-reference.port'
import type {
  PublishReplyJobData,
  ReplyQueuePort,
} from './application/ports/reply-queue.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { PropertyProcessingScopePublicApi } from '#/contexts/property/application/public-api'
import type { AiReplyProvenancePublicKeyring } from './application/ports/ai-suggested-draft-store.port'
import type { PortalAiReplyBrandProfilePublicApi } from '#/contexts/portal/application/public-api'
import { createReviewOrganizationExportContributor } from './infrastructure/adapters/review-organization-export.adapter'
import { createReviewOrganizationLifecycleContributor } from './infrastructure/adapters/review-organization-lifecycle.adapter'
import { createReviewRepository } from './infrastructure/repositories/review.repository'
import { createReviewObservationRepository } from './infrastructure/repositories/review-observation.repository'
import { createReplyRepository } from './infrastructure/repositories/reply.repository'
import { createPublicationReconciliationCandidateQuery } from './infrastructure/repositories/publication-reconciliation-candidate.repository'
import { createServingStats } from './infrastructure/serving-stats'
import type { ReviewServingStats } from './application/ports/serving-stats.port'
import { createAtomicReviewCommandStore } from './infrastructure/review-command-store'
import {
  createAtomicReplyCommandStore,
  type ReplyPublicationActorAuthority,
} from './infrastructure/reply-command-store'
import { createGoogleReplyObservationStore } from './infrastructure/google-reply-observation-store'
import { createReviewReplyObservationAuthority } from './infrastructure/reply-observation-authority'
import { createReviewResponseTargetAuthority } from './infrastructure/response-target-authority'
import type { ReviewReplyObservationAuthority } from './application/ports/reply-observation-authority.port'
import { createReviewSourceTransitionAuthority } from './infrastructure/source-transition-authority'
import type { ReviewSourceTransitionAuthority } from './application/ports/source-transition-authority.port'
import { createReviewProviderObservationWriter } from './application/use-cases/sync-reviews'
import { createAiReviewSource } from './application/ai-review-source'
import type { AiReviewSourcePort } from './application/ports/ai-review-source.port'
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
import { createReviewSourceContentLifecycleStore } from './infrastructure/repositories/source-content-lifecycle-store.repository'
import {
  createReviewLifecycleRecoveryExecutionRepository,
  createReviewLifecycleRecoveryPlanningQuery,
} from './infrastructure/repositories/lifecycle-recovery-execution.repository'
import {
  createRunReviewSourceContentLifecycle,
  type RunReviewSourceContentLifecycle,
} from './application/use-cases/run-source-content-lifecycle'
import {
  createReviewLifecycleRecoveryAuthorityFactory,
  type ReviewLifecycleRecoveryAuthorityFactory,
} from './application/recovery-maintenance'
import { runReviewProviderSnapshot } from './application/use-cases/run-review-provider-snapshot'
import { runTargetedGoogleReviewFetch } from './application/use-cases/run-targeted-google-review-fetch'
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
import { registerReplyPublicationConsumers } from './infrastructure/outbox-consumers'
import { createPublishReplyScopeResolver } from './infrastructure/jobs/publish-reply-scope-resolver'
import { JOB_NAME as PUBLISH_REPLY_JOB_NAME } from './infrastructure/jobs/publish-reply.job'
import type {
  ProcessingRouter,
  RoutingEnvelope,
  WorkloadClass,
} from '#/shared/routing/processing-router'

export type ReviewContextBuildInput = Readonly<{
  db: Database
  outboxRepo: OutboxRepository
  clock: () => Date
  idGen: () => string
  snapshotRunIdGen: () => string
  googleReviewApi: GoogleReviewApiPort
  targetedReviewReferences?: TargetedGoogleReviewReferenceResolver
  jobQueue: Queue | undefined
  /** Root-owned worker infrastructure captured by Review's runtime contribution. */
  workerRuntime: Readonly<{
    pool: Pool
    registry: Pick<JobRegistry, 'register'>
    backgroundQueue: Pick<Queue, 'add'> | undefined
  }>
  logger: LoggerPort
  staffPublicApi: StaffPublicApi
  /** Identity-owned current actor/member/permission/Property decision. */
  publicationActorAuthority: ReplyPublicationActorAuthority
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
  /** Portal-owned transaction-bound authority for grounded reply adoption. */
  replyBrandProfiles: Pick<
    PortalAiReplyBrandProfilePublicApi,
    'isCurrentAiReplyBrandProfile'
  >
}>

/**
 * Minimal Review-owned wiring seam for report-only operator/drill processes
 * that intentionally do not construct the full application container.
 */
export const wireReviewSourceContentLifecycle = (
  input: Pick<ReviewContextBuildInput, 'db' | 'clock'>,
): RunReviewSourceContentLifecycle =>
  createRunReviewSourceContentLifecycle({
    store: createReviewSourceContentLifecycleStore(input.db),
    clock: input.clock,
  })

export type ReviewContextApi = Readonly<{
  /** BQC-1.4: the governed read interface for review content. */
  publicApi: EligibleReads &
    Readonly<{
      replyObservationAuthority: ReviewReplyObservationAuthority
      responseTargetAuthority: import('./application/ports/response-target-authority.port').ReviewResponseTargetAuthority
      sourceTransitionAuthority: ReviewSourceTransitionAuthority
      /** Content-minimized Review source/version facts for authorized AI consumers. */
      aiReviewSource: AiReviewSourcePort
      /** Review-owned queue admission used by Integration import/push workflows. */
      syncAdmission: Readonly<
        Pick<ReviewQueuePort, 'addSyncJob'> &
          Pick<TargetedGoogleReviewQueuePort, 'addTargetedFetchJob'>
      >
      /** Review-owned reply workflow presented to Review HTTP adapters. */
      reply: Readonly<{
        draft: ReturnType<typeof draftReply>
        submit: ReturnType<typeof submitReply>
        approve: ReturnType<typeof approveReply>
        editPublished: ReturnType<typeof editPublishedReply>
        reject: ReturnType<typeof rejectReply>
        delete: ReturnType<typeof deleteReply>
        get: ReturnType<typeof getReply>
        retryPublish: ReturnType<typeof retryPublish>
      }>
      /** Property-scoped Review activity query presented to Review HTTP adapters. */
      getStaffRecentActivity: ReturnType<typeof getStaffRecentActivity>
    }>
  /**
   * LIF-01: Review's own Organization Export contribution. It is deliberately
   * NOT part of `publicApi` — nothing in a request path may call it, and adding
   * it here reaches no new capability. The composition root hands it to
   * Identity's `organizationExport.contributors`, which is the only caller.
   */
  organizationExport: Readonly<{
    contributor: ReturnType<typeof createReviewOrganizationExportContributor>
  }>
  /**
   * LIF-01: Review's own Organization lifecycle contribution (closing, purge
   * readiness, purge). It is deliberately NOT part of `publicApi` — nothing in
   * a request path may call it, and adding it here reaches no new capability.
   * The composition root hands it to Identity's lifecycle coordinator, which is
   * the only caller and is itself composed only under a reviewed composition.
   */
  organizationLifecycle: Readonly<{
    contributor: ReturnType<typeof createReviewOrganizationLifecycleContributor>
  }>
  /** Bounded operator maintenance. These capabilities preserve Review's
   * invariants without exposing its repositories or request workflows. */
  maintenance: Readonly<{
    publicationReconciliation: Readonly<{
      findCandidates: FindAmbiguousPublicationReconciliationCandidates
      reconcile: ReturnType<typeof reconcileReplyPublication>
    }>
    runSourceContentLifecycle: RunReviewSourceContentLifecycle
    recovery: ReviewLifecycleRecoveryAuthorityFactory
  }>
  /** Context-owned worker registration; exposes no repositories or use cases. */
  worker: Readonly<{
    registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) => void
    /** Review-owned registration against the root's one canonical job registry. */
    registerWorkerJobs: (runtime: { discoveryIntervalMs: number }) => Promise<void>
    /** Boot-time inventory-parity check for the provider subject keyring. */
    refreshProviderSubjectKeys: () => Promise<void>
  }>
  /**
   * ARC-03-T12: narrow cross-context read lookups Review publishes. They
   * satisfy the Inbox-owned lookup source contracts and the Dashboard's review
   * stats dep port; the repositories themselves stay context-private.
   */
  lookups: Readonly<{
    reply: ReplyRepository
    review: ReviewRepository
    servingStats: ReviewServingStats
  }>
  internal: Readonly<{
    repos: Readonly<{
      reviewRepo: ReviewRepository
      observationRepo: ReviewObservationRepository
      replyRepo: ReplyRepository
      replyCommandStore: ReplyCommandStore
      queue: ReviewQueuePort
      targetedQueue: TargetedGoogleReviewQueuePort
      replyQueue: ReplyQueuePort
    }>
    useCases: Readonly<{
      runReviewProviderSnapshot: ReturnType<typeof runReviewProviderSnapshot>
      runTargetedGoogleReviewFetch: ReturnType<typeof runTargetedGoogleReviewFetch>
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
      runReviewSourceContentLifecycle: RunReviewSourceContentLifecycle
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
    /** Review-owned registration against the root's one canonical job registry. */
    registerWorkerJobs: (runtime: { discoveryIntervalMs: number }) => Promise<void>
  }>
}>

export const buildReviewContext = (input: ReviewContextBuildInput): ReviewContextApi => {
  const reviewRepo = createReviewRepository(input.db, input.clock)
  const observationRepo = createReviewObservationRepository(input.db)
  const replyRepo = createReplyRepository(input.db, input.clock)
  const publicationCandidates = createPublicationReconciliationCandidateQuery(input.db)
  const sourceContentLifecycleStore = createReviewSourceContentLifecycleStore(input.db)
  const recoveryPlanning = createReviewLifecycleRecoveryPlanningQuery(input.db)
  const recovery = createReviewLifecycleRecoveryAuthorityFactory({
    clock: input.clock,
    createRunLifecycle: ({ clock, authorizeApply }) =>
      createRunReviewSourceContentLifecycle({
        store: sourceContentLifecycleStore,
        clock,
        ...(authorizeApply === undefined ? {} : { authorizeApply }),
      }),
    executions: createReviewLifecycleRecoveryExecutionRepository(input.db),
    createRecoveryRunId: randomUUID,
    loadNextRecoveryGeneration: recoveryPlanning.loadNextRecoveryGeneration,
  })
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

  const targetedQueue: TargetedGoogleReviewQueuePort = {
    addTargetedFetchJob: async (data, options) => {
      const routing = await stampRouting(data.propertyId, 'review.sync')
      const execution = createJobExecutionEnvelope({
        organizationId: data.organizationId,
        propertyId: data.propertyId,
        capability: 'property.connect_gbp',
        initiator: data.initiator ?? { kind: 'system', id: 'queue:review-targeted' },
        correlationId: data.correlationId,
      })
      await jobQueue.add(
        'sync-property-reviews',
        { ...data, ...execution, ...(routing ? { routing } : {}) },
        {
          jobId: options.jobId,
          removeOnComplete: { count: 100 },
          removeOnFail: { count: 50 },
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

  // BQC-3.3: atomic reply state and outbox writes for the reply command family.
  const replyCommandStore = createAtomicReplyCommandStore(
    input.db,
    input.clock,
    input.publicationActorAuthority,
  )
  const googleReplyObservationStore = createGoogleReplyObservationStore(input.db)
  const replyObservationAuthority = createReviewReplyObservationAuthority(input.db)
  const responseTargetAuthority = createReviewResponseTargetAuthority(input.db)
  const sourceTransitionAuthority = createReviewSourceTransitionAuthority(input.db)

  const replyDeps = {
    replyRepo,
    reviewRepo,
    queue: replyQueue,
    commandStore: replyCommandStore,
    aiSuggestedDraftStore: input.aiReplyProvenancePublicKeys
      ? createAiSuggestedDraftStore(
          input.db,
          input.aiReplyProvenancePublicKeys,
          input.replyBrandProfiles,
        )
      : undefined,
    googleReviewApi: input.googleReviewApi,
    googleReplyObservationStore,
    clock: input.clock,
    idGen: () => replyId(input.idGen()),
    staffPublicApi: input.staffPublicApi,
  }

  // BQC-3.8: disconnect cancels in-flight publications before/with the
  // source-content purge (the guarded store tolerates the race). Delivered by
  // the durable review.on-google-account-disconnected consumer.
  const cancelPublications = cancelPublicationsForConnection({
    reviewRepo,
    replyRepo,
    commandStore: replyCommandStore,
    clock: input.clock,
  })

  // BQR-2.3: atomic review upsert + outbox insert for sync path
  const commandStore = createAtomicReviewCommandStore(input.db, input.clock)

  const observationWriter = createReviewProviderObservationWriter({
    reviewRepo,
    clock: input.clock,
    idGen: () => reviewId(input.idGen()),
    commandStore,
    googleReplyObservationStore,
  })
  const syncActivity = createReviewSyncActivityRecorder(input.db)
  const targetedReviewReferences: TargetedGoogleReviewReferenceResolver =
    input.targetedReviewReferences ?? {
      resolve: async () => ({ status: 'obsolete' }),
    }
  const useCases = {
    runReviewProviderSnapshot: runReviewProviderSnapshot({
      repository: createReviewProviderSnapshotRepository(
        input.db,
        input.snapshotRunIdGen,
      ),
      googleReviewApi: input.googleReviewApi,
      propertyRouting: propertyRoutingLookup,
      observationWriter,
      subjectKeyService: providerSubjectKeys,
      // Discovery-ladder activity stamps (migration 0071): a page that
      // persisted a review we had never seen marks the property live.
      syncActivity,
      clock: input.clock,
      logger: input.logger,
    }),
    runTargetedGoogleReviewFetch: runTargetedGoogleReviewFetch({
      references: targetedReviewReferences,
      googleReviewApi: input.googleReviewApi,
      propertyRouting: propertyRoutingLookup,
      observationWriter,
      subjectKeyService: providerSubjectKeys,
      syncActivity,
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
      observationStore: googleReplyObservationStore,
      clock: input.clock,
    }),
    getStaffRecentActivity: getStaffRecentActivity({
      reviewRepo,
      staffPublicApi: input.staffPublicApi,
      clock: input.clock,
    }),
    runReviewSourceContentLifecycle: createRunReviewSourceContentLifecycle({
      store: sourceContentLifecycleStore,
      clock: input.clock,
    }),
  }

  const aiReviewSource = createAiReviewSource({
    findById: reviewRepo.findById,
    readForAi: reviewRepo.readForAi,
    readTrendPopulation: reviewRepo.readTrendPopulation,
    assertCurrentForAi: reviewRepo.assertCurrentForAi,
    readReplyStateRevision: reviewRepo.readReplyStateRevision,
  })
  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) =>
    registerReplyPublicationConsumers(consumerRegistry, {
      replyRepo,
      queue: replyQueue,
      receipts: input.outboxRepo,
      logger: input.logger,
      cancelPublicationsForConnection: cancelPublications,
    })
  // BQC-5.5: governed aggregate serving reads — eligibility in SQL,
  // clock-injected. Wired into the dashboard build by composition. ONE
  // instance: two constructions would open two independent read paths.
  const servingStats = createServingStats({ db: input.db, clock: input.clock })
  const registerWorkerJobs = async ({
    discoveryIntervalMs,
  }: Readonly<{ discoveryIntervalMs: number }>): Promise<void> => {
    const { registerReviewWorkerJobs } = await import('./infrastructure/worker-runtime')
    await registerReviewWorkerJobs({
      db: input.db,
      pool: input.workerRuntime.pool,
      registry: input.workerRuntime.registry,
      backgroundQueue: input.workerRuntime.backgroundQueue,
      reviewQueue: queue,
      reviewRepo,
      replyRepo,
      replyCommandStore,
      googleReviewApi: input.googleReviewApi,
      staffPublicApi: input.staffPublicApi,
      propertyRouting: propertyRoutingLookup,
      runSnapshot: useCases.runReviewProviderSnapshot,
      runTargetedFetch: useCases.runTargetedGoogleReviewFetch,
      runSourceContentLifecycle: useCases.runReviewSourceContentLifecycle,
      reconcileReplyPublication: useCases.reconcileReplyPublication,
      clock: input.clock,
      idGen: input.idGen,
      logger: input.logger,
      discoveryIntervalMs,
    })
  }

  return {
    publicApi: {
      ...createEligibleReads({ reviewRepo, clock: input.clock }),
      replyObservationAuthority,
      responseTargetAuthority,
      sourceTransitionAuthority,
      aiReviewSource,
      syncAdmission: Object.freeze({
        addSyncJob: queue.addSyncJob,
        addTargetedFetchJob: targetedQueue.addTargetedFetchJob,
      }),
      reply: Object.freeze({
        draft: useCases.draftReply,
        submit: useCases.submitReply,
        approve: useCases.approveReply,
        editPublished: useCases.editPublishedReply,
        reject: useCases.rejectReply,
        delete: useCases.deleteReply,
        get: useCases.getReply,
        retryPublish: useCases.retryPublish,
      }),
      getStaffRecentActivity: useCases.getStaffRecentActivity,
    },
    organizationExport: Object.freeze({
      contributor: createReviewOrganizationExportContributor(input.db),
    }),
    organizationLifecycle: Object.freeze({
      contributor: createReviewOrganizationLifecycleContributor(input.db),
    }),
    maintenance: Object.freeze({
      publicationReconciliation: Object.freeze({
        findCandidates: publicationCandidates.findAmbiguousCandidates,
        reconcile: useCases.reconcileReplyPublication,
      }),
      runSourceContentLifecycle: useCases.runReviewSourceContentLifecycle,
      recovery,
    }),
    worker: Object.freeze({
      registerOutboxConsumers,
      /**
       * ARC-03-T12: Review-owned worker contributions. The root used to reach
       * `registerWorkerJobs` and the subject keyring out of the context-private
       * hatch; both are worker capabilities and belong here.
       */
      registerWorkerJobs,
      /**
       * Boot-time inventory-parity check for the provider subject keyring. It
       * is always a service: the real keyring-backed one when writer material
       * is configured, otherwise the secret-free deny adapter whose
       * acquireDeriver() throws `config_invalid`.
       */
      refreshProviderSubjectKeys: async (): Promise<void> => {
        await providerSubjectKeys.acquireDeriver()
      },
    }),
    /**
     * ARC-03-T12: narrow cross-context read lookups Review publishes for the
     * Inbox projection. They satisfy the Inbox-owned lookup source contracts;
     * the repositories themselves stay context-private.
     */
    lookups: Object.freeze({
      reply: replyRepo,
      review: reviewRepo,
      servingStats,
    }),
    internal: {
      repos: {
        reviewRepo,
        observationRepo,
        replyRepo,
        replyCommandStore,
        queue,
        targetedQueue,
        replyQueue,
      },
      useCases,
      servingStats,
      aiReviewSource,
      providerSubjectKeys,
      registerWorkerJobs,
    },
  }
}
