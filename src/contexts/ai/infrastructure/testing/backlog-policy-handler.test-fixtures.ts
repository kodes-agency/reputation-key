import {
  createAiHandlerHarness,
  useAiHandlerDatabase,
} from '#/contexts/ai/infrastructure/testing/handler-harness.test-fixtures'
const handlerDatabase = useAiHandlerDatabase()
// The Review Analysis backlog jobs under platform policy.
//
// The drain's schedule is tenant-cross: its firing names no Organization, so
// the delayed policy admits it as an enumeration boundary before any capability
// check (system-execution-policy.ts). The stop therefore has to apply where the
// drain meets a concrete Organization and Property, or a kill switch, a
// suspension or an allowlist removal leaves queued reviews flowing to the
// provider while the operator's stop reads as applied.
//
// So this suite runs both jobs the way the worker does and stops only at the
// provider port: the real dispatch gate, the real delayed policy over a real
// environment policy store, the job handlers wired as bootstrap wires them,
// the real drain and the real analysis use case. The provider is the
// observation point, and the backlog is a small in-memory queue whose rows the
// assertions read back.
//
// The second half is the review that ARRIVES during a stop. The backlog is
// where a stopped review waits, so its event has to reach the backlog: the
// real outbox dispatcher delivers a fact from Review's own constructor to the
// AI consumers, registered as composition registers them. That holds for both
// kinds of stop: platform policy, and the AI execution controls an operator
// kills and restores.

import type {
  AiReviewAnalysisBacklogEntry,
  AiReviewAnalysisBacklogOrigin,
  AiReviewAnalysisBacklogPort,
} from '#/contexts/ai/replay/contracts'
import {
  createAnalyzeReviewEvent,
  type AnalyzeReviewEventDependencies,
} from '#/contexts/ai/application/use-cases/analyze-review-event'
import { createDrainReviewAnalysisBacklog } from '#/contexts/ai/replay/drain-backlog.server'
import {
  ANALYZE_REVIEW_NOW_JOB_NAME,
  createAnalyzeReviewNowJobHandler,
} from '#/contexts/ai/infrastructure/jobs/analyze-review-now.job'
import {
  createDrainReviewAnalysisBacklogJobHandler,
  DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME,
} from '#/contexts/ai/infrastructure/jobs/drain-review-analysis-backlog.job'
import {
  AI_REVIEW_ANALYSIS_CONSUMER,
  registerAiConsumers,
} from '#/contexts/ai/infrastructure/outbox-consumers'
import { reviewCreated } from '#/contexts/review/application/public-api'
import {
  AI_REVIEW_LANGUAGE_ICU_VERSION,
  AI_REVIEW_LANGUAGE_UNICODE_VERSION,
} from '#/shared/ai-review-language-catalogue'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createDelayedExecutionPolicy,
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { AI_REVIEW_LANGUAGE_REGION_NODE_VERSION } from '#/shared/generated/ai-review-language-canonical-regions-v1'
import {
  createGatedJobHandler,
  createScheduledScopeAuthorizer,
} from '#/shared/jobs/delayed-execution-gate'
import { createJobRegistry } from '#/shared/jobs/registry'
import {
  createConsumerRegistry,
  type ConsumerEvent,
  type ConsumerRegistry,
  type OutboxRepository,
} from '#/shared/outbox'
import type { Job } from 'bullmq'
import { afterEach, beforeEach, vi } from 'vitest'

const NOW = Date.parse('2026-10-12T09:00:00.000Z')
/**
 * How long the drain holds an entry it could not run, refused by policy or
 * stopped by an AI control (its HELD_RETRY_DELAY_MILLIS).
 */
const REFUSAL_HOLD_MILLIS = 60_000
/** When a full lane tells an analysis to ask again. */
const LANE_RETRY_MILLIS = 15_000
const SHA = 'a'.repeat(64)
const STOPPED_ORGANIZATION = organizationId('drain-policy-stopped-org')
const STOPPED_PROPERTY = propertyId('7d000000-0000-4000-8000-000000000001')
const OTHER_ORGANIZATION = organizationId('drain-policy-other-org')
const OTHER_PROPERTY = propertyId('7d000000-0000-4000-8000-000000000002')

type QueuedEntry = {
  eventEnvelopeId: string
  organizationId: OrganizationId
  propertyId: PropertyId
  reviewId: ReturnType<typeof reviewId>
  state: 'queued' | 'claimed'
  attempts: number
  nextAttemptAtEpochMillis: number
  firstStartedAtEpochMillis: number | null
  origin: AiReviewAnalysisBacklogOrigin
}

type Scope = Readonly<{ org: OrganizationId; prop: PropertyId }>

const STOPPED_SCOPE: Scope = { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }

const reviewIdFor = (index: number) =>
  reviewId(`7f000000-0000-4000-8000-${String(index).padStart(12, '0')}`)

function queued(index: number, scope: Scope) {
  const suffix = String(index).padStart(12, '0')
  return {
    eventEnvelopeId: `7e000000-0000-4000-8000-${suffix}`,
    organizationId: scope.org,
    propertyId: scope.prop,
    reviewId: reviewIdFor(index),
    state: 'queued',
    attempts: 0,
    nextAttemptAtEpochMillis: NOW,
    firstStartedAtEpochMillis: null,
    origin: 'historical_onboarding',
  } satisfies QueuedEntry
}

/** The backlog table as a list: enough of the port for the two jobs to act on. */
function inMemoryBacklog(rows: QueuedEntry[]) {
  const find = (eventEnvelopeId: string) =>
    rows.find((row) => row.eventEnvelopeId === eventEnvelopeId)
  const claim = (
    row: QueuedEntry,
    nowEpochMillis: number,
    priority: AiReviewAnalysisBacklogEntry['priority'],
  ): AiReviewAnalysisBacklogEntry => {
    row.state = 'claimed'
    row.firstStartedAtEpochMillis ??= nowEpochMillis
    return {
      eventEnvelopeId: row.eventEnvelopeId,
      organizationId: row.organizationId,
      propertyId: row.propertyId,
      reviewId: row.reviewId,
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 7,
      origin: row.origin,
      priority,
      attempts: row.attempts,
      firstStartedAtEpochMillis: row.firstStartedAtEpochMillis,
    }
  }
  const port: AiReviewAnalysisBacklogPort = {
    // Idempotent by origin event, like the table's primary key.
    enqueue: async (input) => {
      if (find(input.eventEnvelopeId)) return
      rows.push({
        eventEnvelopeId: input.eventEnvelopeId,
        organizationId: input.organizationId,
        propertyId: input.propertyId,
        reviewId: input.reviewId,
        state: 'queued',
        attempts: 0,
        nextAttemptAtEpochMillis: input.nowEpochMillis,
        firstStartedAtEpochMillis: null,
        origin: input.origin,
      })
    },
    claimReady: async (input) =>
      rows
        .filter(
          (row) =>
            row.state === 'queued' &&
            row.nextAttemptAtEpochMillis <= input.nowEpochMillis,
        )
        .slice(0, input.limit)
        .map((row) => claim(row, input.nowEpochMillis, 'background')),
    claimForReview: async (input) => {
      const row = rows.find(
        (candidate) =>
          candidate.state === 'queued' &&
          candidate.organizationId === input.organizationId &&
          candidate.propertyId === input.propertyId &&
          candidate.reviewId === input.reviewId,
      )
      return row ? claim(row, input.nowEpochMillis, 'interactive') : null
    },
    complete: async (input) => {
      const index = rows.findIndex((row) => row.eventEnvelopeId === input.eventEnvelopeId)
      if (index >= 0) rows.splice(index, 1)
    },
    reschedule: async (input) => {
      const row = find(input.eventEnvelopeId)
      if (!row) return
      row.state = 'queued'
      row.attempts += 1
      row.nextAttemptAtEpochMillis = input.nextAttemptAtEpochMillis
    },
    release: async (input) => {
      const row = find(input.eventEnvelopeId)
      if (!row) return
      row.state = 'queued'
      row.nextAttemptAtEpochMillis = input.nextAttemptAtEpochMillis
      row.firstStartedAtEpochMillis = null
    },
    readProgress: async () => ({ queued: 0, inProgress: 0, analysed: 0, settled: 0 }),
    hasPendingForReview: async () => false,
  }
  return port
}

type AiSwitches = {
  /** The background lane has no room: an analysis claims its operation and waits. */
  laneBusy: boolean
  profileUnavailable?: boolean
}

/**
 * The analysis use case with every gate it owns open unless a test closes one:
 * the merchant has enabled Review Analysis and the AI control heads accept
 * work. With them open, whatever stops a review is the platform policy and
 * nothing else. The provider answers "unavailable", which is all the path after
 * the call needs.
 */
async function analysisWithOpenGates(
  clock: Readonly<{ now: number }>,
  switches: AiSwitches,
  neverEnabled: ReadonlySet<PropertyId>,
) {
  const analyzeReview = vi.fn(
    async (
      _request: Readonly<{
        organizationId: string
        propertyId: string
        internalSubjectId: string
      }>,
    ) => ({
      route: 'review-analysis' as const,
      status: 'error' as const,
      code: 'provider_unavailable' as const,
      retryAfterEpochMillis: null,
    }),
  )
  const advanceWithoutAnalysis = vi.fn(async () => ({
    status: 'applied' as const,
    aggregateRevision: 1,
  }))
  const fixtures: Awaited<ReturnType<typeof createAiHandlerHarness>>[] = []
  for (const [index, scope] of [
    STOPPED_SCOPE,
    { org: OTHER_ORGANIZATION, prop: OTHER_PROPERTY },
  ].entries()) {
    fixtures.push(
      await createAiHandlerHarness(handlerDatabase(), {
        organizationId: scope.org,
        propertyId: scope.prop,
        operationId: `7a000000-0000-4000-8000-00000000000${index + 1}`,
        permitId: `7a000000-0000-4000-8000-00000000001${index + 1}`,
        lineageId: `7b000000-0000-4000-8000-00000000000${index + 1}`,
        now: NOW,
        capability: 'review_analysis',
        authorization: neverEnabled.has(scope.prop) ? 'absent' : undefined,
      }),
    )
  }
  const persistence = fixtures[0]!
  const dependencies = {
    authorization: persistence.authorization,
    control: persistence.control,
    inference: { analyzeReview },
    operations: persistence.operations,
    admission: {
      acquire: async () =>
        switches.laneBusy
          ? {
              ok: false as const,
              code: 'admission_busy' as const,
              retryAfterEpochMillis: clock.now + LANE_RETRY_MILLIS,
            }
          : {
              ok: true as const,
              admissionId: 'admission-1',
              expiresAtEpochMillis: clock.now + 90_000,
            },
      release: async () => {},
    },
    reviewEvents: {
      consumeNext: async () => ({
        status: 'accepted' as const,
        consumedSequence: 7,
        terminalAnalysisSequence: 6,
      }),
    },
    aggregates: {
      advanceWithoutAnalysis,
    },
    reviewSources: {
      readForAi: async (
        request: Readonly<{
          organizationId: OrganizationId
          propertyId: PropertyId
          reviewId: ReturnType<typeof reviewId>
        }>,
      ) => ({
        status: 'available' as const,
        observation: {
          kind: 'review' as const,
          reviewId: request.reviewId,
          organizationId: request.organizationId,
          propertyId: request.propertyId,
          text: 'The kitchen made several guests sick.',
          rating: 1,
          languageCode: 'en-US',
          reviewedAtEpochMillis: NOW - 1_000,
          contentExpiresAtEpochMillis: NOW + 3_600_000,
          sourceEpoch: 2,
          sourceRevision: 5,
          analysisSequence: 7,
        },
      }),
    },
    processingProfiles: {
      readForAi: async (
        scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
      ) =>
        switches.profileUnavailable
          ? { status: 'not_found' as const }
          : {
              status: 'available' as const,
              profile: {
                organizationId: scope.organizationId,
                propertyId: scope.propertyId,
                countryCode: 'US',
                timezone: 'America/New_York',
                processingRegion: 'global' as const,
                routingPolicyVersion: 1,
                sourceEpoch: 2,
                profileVersion: 3,
                lifecycleState: 'active' as const,
              },
            },
    },
    subjectHmac: { sign: () => ({ digest: SHA, keyVersion: 'ai-subject-hmac-v1' }) },
    nowEpochMillis: () => clock.now,
  } as unknown as AnalyzeReviewEventDependencies
  return {
    analyzeReviewEvent: createAnalyzeReviewEvent(dependencies),
    analyzeReview,
    advanceWithoutAnalysis,
    operations: async () => {
      const rows = (
        await Promise.all(fixtures.map((fixture) => fixture.storedOperations()))
      ).flat()
      return rows.map((row) => ({
        id: row.id,
        idempotencyKey: row.idempotencyKey,
        requestFingerprint: row.requestFingerprint,
        // Compare every persisted binding column across a stop, independently
        // of the operation mapper; only mutable attempt metadata is excluded.
        binding: Object.fromEntries(
          Object.entries(row).filter(
            ([key]) =>
              ![
                'state',
                'executionAttempt',
                'executionPermitId',
                'failureCode',
                'updatedAt',
                'nextAttemptAt',
              ].includes(key),
          ),
        ),
        state: row.state,
        executionAttempt: row.executionAttempt,
        executionPermitId: row.executionPermitId,
        failureCode: row.failureCode,
        createdAtEpochMillis: row.createdAt.getTime(),
      }))
    },
    killReviewAnalysis: () => persistence.transition('killed'),
    restoreReviewAnalysis: () => persistence.transition('enabled'),
    authorizations: () =>
      Promise.all(fixtures.map((fixture) => fixture.readAuthorization())),
  }
}

/**
 * The worker's delivery of review events: the real outbox dispatcher over the
 * AI consumers, which get the drain's own policy question, as composition
 * gives it to them (asserted on the source at the end of this file).
 */
function reviewEventDelivery(
  wiring: Readonly<{
    analyzeReviewEvent: ReturnType<typeof createAnalyzeReviewEvent>
    backlog: AiReviewAnalysisBacklogPort
    clock: Readonly<{ now: number }>
    helpers: WorkerHelpers
  }>,
) {
  const receipts = new Map<string, string>()
  const receiptKey = (eventId: string, consumerName: string) =>
    `${eventId}:${consumerName}`
  const receiptStore = {
    hasReceipt: async (eventId: string, consumerName: string) =>
      receipts.has(receiptKey(eventId, consumerName)),
    insertReceipt: async (eventId: string, consumerName: string, status: string) => {
      receipts.set(receiptKey(eventId, consumerName), status)
    },
  } as unknown as OutboxRepository
  const consumers = createConsumerRegistry()
  registerAiConsumers(consumers, {
    analyzeReviewEvent: wiring.analyzeReviewEvent,
    receipts: receiptStore,
    backlog: wiring.backlog,
    nowEpochMillis: () => wiring.clock.now,

    authorizeScope: createScheduledScopeAuthorizer(
      'system:ai.review_analysis_backlog_drain',
    ),
  })
  const dispatchEvent = wiring.helpers.createDispatcher(receiptStore, { consumers })
  /**
   * Google shows RepKey a new review and Review commits `review.created`. The
   * answer says what became of the delivery: the receipt the analysis
   * consumer holds, and whether the dispatch job completed or will be retried.
   */
  return async (index: number, scope: Scope) => {
    const fact = reviewCreated({
      reviewId: reviewIdFor(index),
      organizationId: scope.org,
      propertyId: scope.prop,
      platform: 'google',
      sourceEpoch: 2,
      sourceRevision: 5,
      analysisSequence: 7,
      observationOrigin: 'ongoing',
      occurredAt: new Date(wiring.clock.now),
    })
    const envelope = wiring.helpers.delivered(fact, wiring.clock.now)
    const job = {
      id: envelope.eventId,
      name: envelope.eventType,
      data: envelope,
    } as unknown as Job
    const delivery = await dispatchEvent(job).then(
      () => 'completed' as const,
      () => 'retried' as const,
    )
    return {
      eventId: fact.eventId,
      delivery,
      receipt: receipts.get(receiptKey(fact.eventId, AI_REVIEW_ANALYSIS_CONSUMER)),
    }
  }
}

type WorkerHelpers = Readonly<{
  delivered: (fact: DomainEvent, recordedAtEpochMillis: number) => ConsumerEvent
  createDispatcher: (
    receipts: OutboxRepository,
    options: Readonly<{ consumers: ConsumerRegistry }>,
  ) => (job: Job) => Promise<unknown>
  logger: LoggerPort
}>

function createWorker(helpers: WorkerHelpers) {
  /** The worker's dispatch of both backlog jobs and of review events, under `env` as policy. */
  return async function worker(
    env: Readonly<Record<string, string>>,
    rows: QueuedEntry[],
    options: Readonly<{ neverEnabled?: readonly PropertyId[] }> = {},
  ) {
    /** The environment policy store is read at boot: a change is a restart. */
    const restartUnder = (policy: Readonly<Record<string, string>>) =>
      initCapabilityPolicyStore(createEnvCapabilityPolicyStore(policy))
    restartUnder(env)
    initDelayedExecutionPolicy(
      createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
    )
    const clock = { now: NOW }
    const switches: AiSwitches = {
      laneBusy: false,
    }
    const analysis = await analysisWithOpenGates(
      clock,
      switches,
      new Set(options.neverEnabled ?? []),
    )
    const backlog = inMemoryBacklog(rows)
    const drainer = createDrainReviewAnalysisBacklog({
      backlog,
      analyzeReviewEvent: analysis.analyzeReviewEvent,
      nowEpochMillis: () => clock.now,
    })
    const arrive = reviewEventDelivery({
      analyzeReviewEvent: analysis.analyzeReviewEvent,
      backlog,
      clock,
      helpers,
    })
    const registry = createJobRegistry()
    // As bootstrap registers it.
    registry.register(
      DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME,
      createDrainReviewAnalysisBacklogJobHandler({
        drain: drainer.drain,
        authorizeScope: createScheduledScopeAuthorizer(
          'system:ai.review_analysis_backlog_drain',
        ),
        logger: helpers.logger,
      }),
    )
    registry.register(
      ANALYZE_REVIEW_NOW_JOB_NAME,
      createAnalyzeReviewNowJobHandler({ drainReview: drainer.drainReview }),
    )
    const dispatch = createGatedJobHandler('background', registry)
    /** One firing of the recurring drain. */
    const fire = () =>
      dispatch({
        name: DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME,
        data: {},
        repeatJobKey: `${DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME}-recurring`,
        opts: {},
      } as unknown as Job)
    /** The on-demand job for one review, with the payload its enqueue writes. */
    const analyzeNow = (row: QueuedEntry) =>
      dispatch({
        name: ANALYZE_REVIEW_NOW_JOB_NAME,
        data: {
          organizationId: row.organizationId,
          propertyId: row.propertyId,
          reviewId: row.reviewId,
        },
        opts: { jobId: `ai-analysis-now-${row.reviewId}` },
      } as unknown as Job)
    const advance = (millis: number) => {
      clock.now += millis
    }
    return {
      fire,
      analyzeNow,
      arrive,
      restartUnder,
      advance,
      switches,
      ...analysis,
    }
  }
}

const ACTUAL_VERSIONS = process.versions

/** The four ways platform policy stops Review Analysis for one Organization. */
const PLATFORM_STOPS: ReadonlyArray<readonly [string, Readonly<Record<string, string>>]> =
  [
    [
      'ai.analyze is switched off',
      { BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: 'ai.analyze' },
    ],
    [
      'every capability is switched off',
      { BETA_ALLOWLIST_ORGS: '*', BETA_CAPABILITIES_OFF: 'all' },
    ],
    [
      'the Organization is suspended',
      { BETA_ALLOWLIST_ORGS: '*', BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION },
    ],
    [
      'the Organization is no longer allowlisted',
      { BETA_ALLOWLIST_ORGS: OTHER_ORGANIZATION },
    ],
  ]

beforeEach(() => {
  registerAllEventSchemas()
  // The analysis fails closed on a language runtime other than the pinned
  // one, which would hide the provider call this suite is looking for.
  Object.defineProperty(process, 'versions', {
    value: {
      ...ACTUAL_VERSIONS,
      node: AI_REVIEW_LANGUAGE_REGION_NODE_VERSION,
      icu: AI_REVIEW_LANGUAGE_ICU_VERSION,
      unicode: AI_REVIEW_LANGUAGE_UNICODE_VERSION.replace(/\.0$/u, ''),
    },
    configurable: true,
    writable: false,
    enumerable: true,
  })
})

afterEach(() => {
  Object.defineProperty(process, 'versions', {
    value: ACTUAL_VERSIONS,
    configurable: true,
    writable: false,
    enumerable: true,
  })
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  clearEventSchemas()
})

export {
  NOW,
  OTHER_ORGANIZATION,
  OTHER_PROPERTY,
  PLATFORM_STOPS,
  queued,
  REFUSAL_HOLD_MILLIS,
  reviewIdFor,
  STOPPED_ORGANIZATION,
  STOPPED_PROPERTY,
  STOPPED_SCOPE,
  createWorker,
  type AiSwitches,
  type QueuedEntry,
  type Scope,
}
