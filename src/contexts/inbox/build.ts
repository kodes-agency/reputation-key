// Inbox context — build function (composition root)
// Per architecture: "Build functions wire ports → adapters, deps → use cases."
// Returns segregated request, lifecycle, maintenance, and worker capabilities;
// persistence details remain context-internal.
//
// Runtime contribution exposed to the composition root:
//   - worker.registerOutboxConsumers — registers Inbox's durable consumers
//     before the worker begins processing outbox jobs.

import type { Database } from '#/shared/db'
import { registerInboxMemberOffboardingConsumers } from './infrastructure/member-offboarding-outbox-consumers'
import type { ConsumerRegistry } from '#/shared/outbox'
import {
  createInboxAssignmentRuntime,
  type InboxAssignmentRuntime,
} from './application/inbox-assignment-runtime'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import type {
  ReviewReplyObservationAuthority,
  ReviewSourceTransitionAuthority,
} from '#/contexts/review/application/public-api'
import { inboxItemId } from '#/shared/domain/ids'
import type { InboxRepository } from './application/ports/inbox.repository'
import type { InboxNoteRepository } from './application/ports/inbox-note.repository'
import type { InboxViewRepository } from './application/ports/inbox-view.repository'
import type { InboxCommandStore } from './application/ports/inbox-command-store.port'
import type { ReviewHandlingCycleStore } from './application/ports/review-handling-cycle.store'
import type { FeedbackHandlingStore } from './application/ports/feedback-handling.store'
import type { ResponseTargetStore } from './application/ports/response-target.store'
import type { ResponseTargetPolicyStore } from './application/ports/response-target-policy.store'
import type { RestatedRevisionTargetExclusions } from './application/ports/restated-revision-target-exclusion.port'
import type { ReviewLookupPort } from './application/ports/review-lookup.port'
import type { AiReviewInsightsPort } from './application/ports/ai-review-insights.port'
import type {
  FeedbackLookupSource,
  PropertyLookupSource,
  ReplyLookupSource,
  ReviewSourceLookupSource,
} from './application/ports/lookup-sources.port'
import type { InboxPublicApi } from './application/public-api'
import type { GetInboxResponseTarget } from './application/use-cases/get-response-targets'
import type { RebuildInboxProjection } from '#/contexts/reputation/inbox/rebuild-inbox-projection.server'
import type { ReleaseDueResponseTargetReminders } from './application/use-cases/release-response-target-reminders'
import { createInboxRepository } from './infrastructure/repositories/inbox.repository'
import { createInboxNoteRepository } from './infrastructure/repositories/inbox-note.repository'
import { createInboxHistoryRepository } from './infrastructure/repositories/inbox-history.repository'
import { createInboxViewRepository } from './infrastructure/repositories/inbox-view.repository'
import {
  createAtomicInboxCommandStore,
  type InboxCommandAuthority,
} from '#/contexts/reputation/inbox/command-store.server'
import { createReviewHandlingCycleStore } from './infrastructure/review-handling-cycle.store'
import { createFeedbackHandlingStore } from './infrastructure/feedback-handling.store'
import { createResponseTargetStore } from './infrastructure/response-target.store'
import { createRestatedRevisionTargetExclusionStore } from './infrastructure/restated-revision-target-exclusion.store'
import { createResponseTargetPolicyStore } from './infrastructure/response-target-policy.store'
import { registerInboxConsumers } from '#/contexts/reputation/inbox/outbox-consumers.server'
import { registerInboxPropertyLifecycleConsumers } from './infrastructure/property-lifecycle-outbox-consumers'
import { registerGuestFeedbackConsumer } from './infrastructure/guest-feedback-outbox-consumers'
import { createFeedbackLookupAdapter } from './infrastructure/adapters/feedback-lookup.adapter'
import { createPropertyLookupAdapter } from './infrastructure/adapters/property-lookup.adapter'
import { createReplyLookupAdapter } from './infrastructure/adapters/reply-lookup.adapter'
import { createReviewSourceLookupAdapter } from './infrastructure/adapters/review-source-lookup.adapter'
import type {
  ReviewGoogleReviewCheck,
  ReviewResponseTargetAuthority,
} from '#/contexts/review/application/public-api'
import { createGoogleReviewCheckAdapter } from './infrastructure/adapters/google-review-check.adapter'
import { createGoogleCheckRateLimitAdapter } from './infrastructure/adapters/google-check-rate-limit.adapter'
import type { RateLimiter } from '#/shared/rate-limit/middleware'
import { createInboxActorDirectoryAdapter } from './infrastructure/adapters/inbox-actor-directory.adapter'
import { projectInboxRequestApi, wireUseCases } from './build-use-cases'

export type InboxContextBuildInput = Readonly<{
  db: Database
  clock: () => Date
  idGen: () => string
  staffPublicApi: StaffPublicApi
  /** BQC-1.4: review.publicApi IS the governed read interface — it satisfies
   * the inbox ReviewLookupPort directly (single rule, one owner). */
  reviewLookup: ReviewLookupPort
  aiInsights?: AiReviewInsightsPort
  /**
   * BQC-5.2: foreign-owned read pieces the inbox build adapts into its lookup
   * ports (guest feedback/rating reads, property names, review reply/metadata
   * reads). Narrow structural contracts — no foreign infrastructure imports.
   */
  sources: Readonly<{
    feedback: FeedbackLookupSource
    property: PropertyLookupSource
    reply: ReplyLookupSource
    review: ReviewSourceLookupSource
    replyObservationAuthority: ReviewReplyObservationAuthority
    responseTargetAuthority: ReviewResponseTargetAuthority
    sourceTransitionAuthority: ReviewSourceTransitionAuthority
    /** Reads one review from Google once, before a Response Target reminder for it goes out. */
    googleReviewCheck: ReviewGoogleReviewCheck
  }>
  /** The shared limiter: it budgets the manager-triggered "check on Google" reads. */
  rateLimiter: RateLimiter
  logger: LoggerPort
  /** Current actor/assignee authority, evaluated inside each command transaction. */
  authorizeCommand: InboxCommandAuthority
}>

export type InboxContextApi = Readonly<{
  publicApi: InboxPublicApi
  /** Event and cross-context workflow capabilities. These are deliberately
   * separate from request handlers and operator repair commands. */
  lifecycle: Readonly<{
    getInboxResponseTarget: GetInboxResponseTarget
  }>
  /** Bounded operator repair capabilities owned by Inbox. */
  maintenance: Readonly<{
    rebuildInboxProjection: RebuildInboxProjection
    /** Leaves the Response Targets of restated revisions out of every count
     * (`pnpm ops inbox exclude-restated-revision-targets`). */
    responseTargetExclusions: RestatedRevisionTargetExclusions
  }>
  /** Context-owned worker registration; exposes no repositories or use cases. */
  worker: Readonly<{
    registerOutboxConsumers: (consumerRegistry: ConsumerRegistry) => void
  }>
  /** ARC-03-T12: the named member-authority capability. Replaces the root's
   * `inbox.internal.commandStore` reach-through. */
  assignments: InboxAssignmentRuntime
  /** ARC-03-T12: the scheduled reminder release Inbox contributes to the
   * worker. Replaces the root's `inbox.internal.useCases` destructure. */
  runtime: Readonly<{
    releaseDueResponseTargetReminders: ReleaseDueResponseTargetReminders
  }>
  internal: Readonly<{
    repos: Readonly<{
      inboxRepo: InboxRepository
      inboxNoteRepo: InboxNoteRepository
      inboxViewRepo: InboxViewRepository
      staffPublicApi: StaffPublicApi
    }>
    /** BQC-3.4: atomic state+outbox command store — also drives the durable consumers. */
    commandStore: InboxCommandStore
    handlingCycleStore: ReviewHandlingCycleStore
    feedbackHandlingStore: FeedbackHandlingStore
    responseTargetStore: ResponseTargetStore
    responseTargetPolicyStore: ResponseTargetPolicyStore
    useCases: ReturnType<typeof wireUseCases>
  }>
}>

export const buildInboxContext = (input: InboxContextBuildInput): InboxContextApi => {
  const feedbackLookup = createFeedbackLookupAdapter(input.sources.feedback)
  const propertyLookup = createPropertyLookupAdapter(input.sources.property)
  const replyLookup = createReplyLookupAdapter(input.sources.reply)
  const reviewSourceLookup = createReviewSourceLookupAdapter(input.sources.review)
  const {
    replyObservationAuthority,
    responseTargetAuthority,
    sourceTransitionAuthority,
  } = input.sources
  const googleReviewCheck = createGoogleReviewCheckAdapter(
    input.sources.googleReviewCheck,
  )

  const inboxRepo = createInboxRepository(
    input.db,
    {
      reviewLookup: input.reviewLookup,
      feedbackLookup,
      propertyLookup,
      aiInsights: input.aiInsights,
    },
    {
      clock: input.clock,
      logger: input.logger,
    },
  )
  const inboxNoteRepo = createInboxNoteRepository(input.db)
  const inboxHistoryRepo = createInboxHistoryRepository(input.db)
  // IBX-01-T6: bounded actor display-name resolution. Inbox owns the read
  // because the alternative — rendering an eight-character id fragment — is not
  // usable manager history.
  const actorDirectory = createInboxActorDirectoryAdapter(input.db)
  const inboxViewRepo = createInboxViewRepository(input.db, input.clock)

  // BQC-3.4: every fact-producing command commits state and its outbox row in
  // one transaction.
  const commandStore = createAtomicInboxCommandStore(
    input.db,
    input.authorizeCommand,
    input.clock,
  )
  const handlingCycleStore = createReviewHandlingCycleStore(input.db)
  const feedbackHandlingStore = createFeedbackHandlingStore(
    input.db,
    input.authorizeCommand,
  )
  const responseTargetStore = createResponseTargetStore(input.db)
  const responseTargetPolicyStore = createResponseTargetPolicyStore(input.db)

  const useCases = wireUseCases({
    inboxRepo,
    inboxNoteRepo,
    inboxHistoryRepo,
    inboxViewRepo,
    actorDirectory,
    commandStore,
    handlingCycleStore,
    feedbackHandlingStore,
    responseTargetStore,
    responseTargetPolicyStore,
    responseTargetAuthority,
    reviewSourceLookup,
    replyLookup,
    replyObservationAuthority,
    googleReviewCheck,
    googleCheckRateLimit: createGoogleCheckRateLimitAdapter(input.rateLimiter),
    propertyLookup,
    staffPublicApi: input.staffPublicApi,
    aiInsights: input.aiInsights,
    logger: input.logger,
    clock: input.clock,
    idGen: input.idGen,
  })
  const publicApi: InboxPublicApi = projectInboxRequestApi(useCases, responseTargetStore)
  const lifecycle = Object.freeze({
    getInboxResponseTarget: useCases.getInboxResponseTarget,
  })
  const maintenance = Object.freeze({
    rebuildInboxProjection: useCases.rebuildInboxProjection,
    responseTargetExclusions: createRestatedRevisionTargetExclusionStore(input.db),
  })

  // Durable consumer registration is the single cross-context delivery path.
  const registerOutboxConsumers = (consumerRegistry: ConsumerRegistry) => {
    registerInboxConsumers(consumerRegistry, {
      commandStore,
      handlingCycleStore,
      replyObservationAuthority,
      responseTargetAuthority,
      sourceTransitionAuthority,
      reviewLookup: input.reviewLookup,
      reviewSourceLookup,
      inboxRepo,
      idGen: () => inboxItemId(input.idGen()),
      clock: input.clock,
      logger: input.logger,
    })
    registerGuestFeedbackConsumer(consumerRegistry, {
      commandStore,
      feedbackLookup,
      inboxRepo,
      idGen: () => inboxItemId(input.idGen()),
      clock: input.clock,
    })
    registerInboxPropertyLifecycleConsumers(consumerRegistry, {
      responseTargetStore,
      clock: input.clock,
    })
    registerInboxMemberOffboardingConsumers(consumerRegistry, {
      db: input.db,
      commandStore,
      clock: input.clock,
    })
  }

  return {
    publicApi,
    lifecycle,
    maintenance,
    worker: Object.freeze({ registerOutboxConsumers }),
    assignments: createInboxAssignmentRuntime(commandStore),
    runtime: Object.freeze({
      releaseDueResponseTargetReminders: useCases.releaseDueResponseTargetReminders,
    }),
    internal: {
      repos: {
        inboxRepo,
        inboxNoteRepo,
        inboxViewRepo,
        staffPublicApi: input.staffPublicApi,
      },
      commandStore,
      handlingCycleStore,
      feedbackHandlingStore,
      responseTargetStore,
      responseTargetPolicyStore,
      useCases,
    },
  }
}
