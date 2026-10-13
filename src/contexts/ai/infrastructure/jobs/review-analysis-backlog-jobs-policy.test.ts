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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
import { reviewCreated } from '#/contexts/review/application/public-api'
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
import {
  AI_REVIEW_LANGUAGE_ICU_VERSION,
  AI_REVIEW_LANGUAGE_UNICODE_VERSION,
} from '#/shared/ai-review-language-catalogue'
import { organizationId, propertyId, reviewId } from '#/shared/domain/ids'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { DomainEvent } from '#/shared/events/events'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { AI_REVIEW_LANGUAGE_REGION_NODE_VERSION } from '#/shared/generated/ai-review-language-canonical-regions-v1'
import {
  createGatedJobHandler,
  createScheduledScopeAuthorizer,
} from '#/shared/jobs/delayed-execution-gate'
import { createJobRegistry } from '#/shared/jobs/registry'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { createConsumerRegistry, type OutboxRepository } from '#/shared/outbox'
import { createDispatcherHandler } from '#/shared/outbox/dispatcher'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import { toOutboxEvent } from '#/shared/outbox/event-adapter'
import { createMockLogger } from '#/shared/testing/mock-logger'
import type {
  AiReviewAnalysisBacklogEntry,
  AiReviewAnalysisBacklogOrigin,
  AiReviewAnalysisBacklogPort,
} from '../../application/ports/ai-review-analysis-backlog.port'
import {
  createAnalyzeReviewEvent,
  type AnalyzeReviewEventDependencies,
} from '../../application/use-cases/analyze-review-event'
import { createDrainReviewAnalysisBacklog } from '../../application/use-cases/drain-review-analysis-backlog'
import { AI_REVIEW_ANALYSIS_CONSUMER, registerAiConsumers } from '../outbox-consumers'
import {
  ANALYZE_REVIEW_NOW_JOB_NAME,
  createAnalyzeReviewNowJobHandler,
} from './analyze-review-now.job'
import {
  createDrainReviewAnalysisBacklogJobHandler,
  DRAIN_REVIEW_ANALYSIS_BACKLOG_JOB_NAME,
} from './drain-review-analysis-backlog.job'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => createMockLogger(),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, work: () => unknown) => work()),
}))

const NOW = Date.parse('2026-10-12T09:00:00.000Z')
/**
 * How long the drain holds an entry it could not run: refused by policy (its
 * DENIED_RETRY_DELAY_MILLIS) or stopped by an AI control (STOPPED_RETRY_DELAY_MILLIS).
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

/** The Review Analysis capability head of the AI execution controls. */
type ReviewAnalysisControl = Readonly<{
  executionState: 'enabled' | 'killed'
  generation: number
}>

/**
 * An operator's transition of the control. Every one moves its generation by
 * one, a restore as much as a kill (`transition_ai_execution_control_v1`).
 */
function transitioned(
  control: ReviewAnalysisControl,
  executionState: ReviewAnalysisControl['executionState'],
): ReviewAnalysisControl {
  return { executionState, generation: control.generation + 1 }
}

const NEVER_TRANSITIONED: ReviewAnalysisControl = {
  executionState: 'enabled',
  generation: 1,
}

/** What an operator and a merchant can switch, as the tests move it. */
type AiSwitches = {
  reviewAnalysisControl: ReviewAnalysisControl
  /** Properties whose merchant never enabled AI: no enablement row at all. */
  neverEnabled: ReadonlySet<PropertyId>
  /** The background lane has no room: an analysis claims its operation and waits. */
  laneBusy: boolean
}

type StoredOperation = {
  id: string
  idempotencyKey: string
  requestFingerprint: string
  binding: unknown
  state: 'pending' | 'executing' | 'failed'
  executionAttempt: number
  executionPermitId: string | null
  failureCode: string | null
  createdAtEpochMillis: number
}

const PERMIT_ID = '7a000000-0000-4000-8000-0000000000ff'

/**
 * The operations table as a list, with the store's own rules: one operation
 * per idempotency key, a later claim under that key a replay only when its
 * request fingerprint is the recorded one, and every write a compare-and-set
 * on state, attempt and failure code. The answers are copies, as rows are.
 */
function inMemoryOperations() {
  const operations: StoredOperation[] = []
  const byId = (operationId: string) =>
    operations.find((operation) => operation.id === operationId)
  const port = {
    claim: async (
      request: Readonly<{
        idempotencyKey: string
        requestFingerprint: string
        binding: unknown
        nowEpochMillis: number
      }>,
    ) => {
      const existing = operations.find(
        (operation) => operation.idempotencyKey === request.idempotencyKey,
      )
      if (existing !== undefined) {
        const status =
          existing.requestFingerprint === request.requestFingerprint
            ? ('replayed' as const)
            : ('conflict' as const)
        return { status, operation: { ...existing } }
      }
      const operation: StoredOperation = {
        id: `7a000000-0000-4000-8000-${String(operations.length + 1).padStart(12, '0')}`,
        idempotencyKey: request.idempotencyKey,
        requestFingerprint: request.requestFingerprint,
        binding: request.binding,
        state: 'pending',
        executionAttempt: 0,
        executionPermitId: null,
        failureCode: null,
        createdAtEpochMillis: request.nowEpochMillis,
      }
      operations.push(operation)
      return { status: 'created' as const, operation: { ...operation } }
    },
    claimExecution: async (
      input: Readonly<{ operationId: string; expectedAttempt: number }>,
    ) => {
      const operation = byId(input.operationId)
      if (
        operation?.state !== 'pending' ||
        operation.executionAttempt !== input.expectedAttempt - 1
      ) {
        return null
      }
      operation.state = 'executing'
      operation.executionAttempt = input.expectedAttempt
      operation.executionPermitId = PERMIT_ID
      operation.failureCode = null
      return { ...operation }
    },
    recordFailure: async (
      input: Readonly<{
        operationId: string
        expectedAttempt: number
        expectedState?: StoredOperation['state']
        expectedFailureCode?: string | null
        failureCode: string
        retryAtEpochMillis: number | null
      }>,
    ) => {
      const operation = byId(input.operationId)
      if (
        operation?.state !== (input.expectedState ?? 'executing') ||
        operation.executionAttempt !== input.expectedAttempt ||
        operation.failureCode !== (input.expectedFailureCode ?? null)
      ) {
        return false
      }
      operation.state = input.retryAtEpochMillis === null ? 'failed' : 'pending'
      operation.failureCode = input.failureCode
      return true
    },
  }
  return { port, stored: () => operations.map((operation) => ({ ...operation })) }
}

/**
 * The analysis use case with every gate it owns open unless a test closes one:
 * the merchant has enabled Review Analysis and the AI control heads accept
 * work. With them open, whatever stops a review is the platform policy and
 * nothing else. The provider answers "unavailable", which is all the path after
 * the call needs.
 */
function analysisWithOpenGates(clock: Readonly<{ now: number }>, switches: AiSwitches) {
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
  const settleOutcome = vi.fn(async () => ({
    terminalAnalysisSequence: 7,
    aggregateRevision: 1,
  }))
  const head = (
    scope: Readonly<Record<string, string>>,
    index: number,
    control: ReviewAnalysisControl = NEVER_TRANSITIONED,
  ) => ({
    scope,
    controlId: `7c000000-0000-4000-8000-00000000000${index}`,
    generation: control.generation,
    executionState: control.executionState,
    admissionState: 'accepting' as const,
    updatedAtEpochMillis: NOW,
  })
  const operations = inMemoryOperations()
  const enabledFor = (
    scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
  ) => ({
    organizationId: scope.organizationId,
    propertyId: scope.propertyId,
    state: 'enabled' as const,
    stateVersion: 1,
    authorizationLineageId: '7b000000-0000-4000-8000-000000000001',
    authorizedSourceEpoch: 2,
    capabilities: ['review_analysis'] as const,
    capabilityRuntimeProfileVersions: {
      review_analysis: 'review-analysis-runtime-v1',
    },
    capabilityEpochs: {
      review_analysis: { epoch: 1, changedAtEpochMillis: NOW },
      reply_drafting: { epoch: 1, changedAtEpochMillis: NOW },
      property_trends: { epoch: 1, changedAtEpochMillis: NOW },
    },
    reviewAnalysisStartSequence: 1,
    noticeVersion: MERCHANT_AI_NOTICE_VERSION,
    noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
    sourcePolicyId: 'google-business-profile-source-policy-v1',
    sourceCanonicalizerDigest: SHA,
    redactionProfileFamily: 'gbp-review-global-v1',
    providerDeploymentProfileVersion: 'private-beta-global-v1',
  })
  const dependencies = {
    authorization: {
      readMerchantAuthorization: async (
        scope: Readonly<{ organizationId: OrganizationId; propertyId: PropertyId }>,
      ) => (switches.neverEnabled.has(scope.propertyId) ? null : enabledFor(scope)),
    },
    control: {
      readHeads: async () => [
        head({ kind: 'global' }, 1),
        head(
          {
            kind: 'provider_deployment_profile',
            providerDeploymentProfileVersion: 'private-beta-global-v1',
          },
          2,
        ),
        head(
          { kind: 'capability', capability: 'review_analysis' },
          3,
          switches.reviewAnalysisControl,
        ),
      ],
    },
    inference: { analyzeReview },
    operations: operations.port,
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
      settleOutcome,
    },
    aggregates: {
      advanceWithoutAnalysis: async () => ({
        status: 'applied' as const,
        aggregateRevision: 1,
      }),
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
      ) => ({
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
      }),
    },
    subjectHmac: { sign: () => ({ digest: SHA, keyVersion: 'ai-subject-hmac-v1' }) },
    nowEpochMillis: () => clock.now,
  } as unknown as AnalyzeReviewEventDependencies
  return {
    analyzeReviewEvent: createAnalyzeReviewEvent(dependencies),
    analyzeReview,
    settleOutcome,
    operations: operations.stored,
  }
}

/** The envelope the relay builds from a fact's outbox row. */
function delivered(fact: DomainEvent, recordedAtEpochMillis: number) {
  const row = toOutboxEvent(fact)
  return buildConsumerEvent({
    id: fact.eventId,
    eventType: row.eventType,
    eventVersion: row.eventVersion ?? 1,
    payload: JSON.parse(JSON.stringify(row.payload)),
    organizationId: row.organizationId,
    propertyId: row.propertyId ?? null,
    sourceContext: row.sourceContext,
    sourceAggregateId: row.sourceAggregateId,
    recordedAt: new Date(recordedAtEpochMillis),
  })
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
    enqueuePropertyTrend: async () => {},
    authorizeScope: createScheduledScopeAuthorizer(
      'system:ai.review_analysis_backlog_drain',
    ),
  })
  const dispatchEvent = createDispatcherHandler(receiptStore, { consumers })
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
    const envelope = delivered(fact, wiring.clock.now)
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

/** The worker's dispatch of both backlog jobs and of review events, under `env` as policy. */
function worker(env: Readonly<Record<string, string>>, rows: QueuedEntry[]) {
  /** The environment policy store is read at boot: a change is a restart. */
  const restartUnder = (policy: Readonly<Record<string, string>>) =>
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore(policy))
  restartUnder(env)
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
  const clock = { now: NOW }
  const switches: AiSwitches = {
    reviewAnalysisControl: NEVER_TRANSITIONED,
    neverEnabled: new Set(),
    laneBusy: false,
  }
  /** `pnpm ops ai-control kill capability review_analysis`, and its restore. */
  const killReviewAnalysis = () => {
    switches.reviewAnalysisControl = transitioned(
      switches.reviewAnalysisControl,
      'killed',
    )
  }
  const restoreReviewAnalysis = () => {
    switches.reviewAnalysisControl = transitioned(
      switches.reviewAnalysisControl,
      'enabled',
    )
  }
  const analysis = analysisWithOpenGates(clock, switches)
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
      logger: createMockLogger(),
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
    killReviewAnalysis,
    restoreReviewAnalysis,
    ...analysis,
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

describe('Review Analysis backlog jobs under platform policy', () => {
  it('sends a queued review to the provider when policy allows its Organization', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = worker({ BETA_ALLOWLIST_ORGS: STOPPED_ORGANIZATION }, rows)

    await run.fire()

    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
    expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      internalSubjectId: '7f000000-0000-4000-8000-000000000001',
    })
  })

  it.each(PLATFORM_STOPS)(
    'sends nothing to the provider and leaves the review queued while %s',
    async (_stop, env) => {
      const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
      const run = worker(env, rows)

      await run.fire()

      expect(run.analyzeReview).not.toHaveBeenCalled()
      // Still waiting, exactly as it was: no attempt counted, nothing settled
      // as "not analysable", and no horizon running against it.
      expect(run.settleOutcome).not.toHaveBeenCalled()
      expect(rows).toEqual([
        {
          ...queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }),
          state: 'queued',
          attempts: 0,
          firstStartedAtEpochMillis: null,
          nextAttemptAtEpochMillis: expect.any(Number),
        },
      ])
      expect(rows[0]?.nextAttemptAtEpochMillis).toBeGreaterThan(NOW)
    },
  )

  it('keeps analysing the other Organizations while one is suspended', async () => {
    const rows = [
      queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }),
      queued(2, { org: OTHER_ORGANIZATION, prop: OTHER_PROPERTY }),
    ]
    const run = worker(
      { BETA_ALLOWLIST_ORGS: '*', BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION },
      rows,
    )

    await run.fire()

    expect(
      run.analyzeReview.mock.calls.map(([request]) => request.organizationId),
    ).toEqual([OTHER_ORGANIZATION])
    expect(rows.find((row) => row.organizationId === STOPPED_ORGANIZATION)).toMatchObject(
      { state: 'queued', attempts: 0, firstStartedAtEpochMillis: null },
    )
  })

  it('analyses a refused review once the stop is lifted and its hold has passed', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = worker(
      { BETA_ALLOWLIST_ORGS: '*', BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION },
      rows,
    )
    await run.fire()
    const callsWhileStopped = run.analyzeReview.mock.calls.length

    run.restartUnder({ BETA_ALLOWLIST_ORGS: '*' })
    run.advance(REFUSAL_HOLD_MILLIS - 1)
    await run.fire()
    const callsWhileHeld = run.analyzeReview.mock.calls.length
    run.advance(1)
    await run.fire()

    expect({ callsWhileStopped, callsWhileHeld }).toEqual({
      callsWhileStopped: 0,
      callsWhileHeld: 0,
    })
    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
    expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      internalSubjectId: '7f000000-0000-4000-8000-000000000001',
    })
  })

  // The other way into the same backlog. Its job is Property-scoped, so the
  // dispatch gate decides it for the review's own Organization and Property
  // and the handler never runs for a stopped one.
  it('analyses an opened review on demand when policy allows its Organization', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = worker({ BETA_ALLOWLIST_ORGS: '*' }, rows)

    await run.analyzeNow(queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }))

    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
  })

  it('refuses the on-demand job for a suspended Organization before it claims the review', async () => {
    const rows = [queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })]
    const run = worker(
      { BETA_ALLOWLIST_ORGS: '*', BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION },
      rows,
    )

    await expect(
      run.analyzeNow(queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY })),
    ).resolves.toEqual({
      gate: 'denied',
      reason: 'org_suspended',
      executionKind: 'worker',
    })
    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(rows).toEqual([
      queued(1, { org: STOPPED_ORGANIZATION, prop: STOPPED_PROPERTY }),
    ])
  })
})

// Everything above starts from a review already in the backlog. A review
// Google shows RepKey during the stop used to never get there: platform
// policy refused its consumer at the dispatcher, which records an obsolete
// receipt and is never retried, and a stopped AI control settled it as
// "not analysable" with no operation, which nothing reopens. Either way the
// review stayed outside the Property's analysis after the stop was lifted.
describe('Review Analysis for a review that arrives during a stop', () => {
  it('analyses a new review on delivery when nothing is stopped', async () => {
    const rows: QueuedEntry[] = []
    const run = worker({ BETA_ALLOWLIST_ORGS: '*' }, rows)

    await run.arrive(1, STOPPED_SCOPE)

    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
    expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      internalSubjectId: reviewIdFor(1),
    })
    expect(rows).toEqual([])
  })

  it.each(PLATFORM_STOPS)(
    'queues a review that arrives while %s, and analyses it once the stop is lifted',
    async (_stop, env) => {
      const rows: QueuedEntry[] = []
      const run = worker(env, rows)

      const arrival = await run.arrive(1, STOPPED_SCOPE)
      await run.fire()

      // Nothing left for the provider, nothing was settled "not analysable",
      // and the review waits as an untried entry the drain has already been
      // refused once.
      expect(run.analyzeReview).not.toHaveBeenCalled()
      expect(run.settleOutcome).not.toHaveBeenCalled()
      expect(arrival).toMatchObject({ delivery: 'completed', receipt: 'applied' })
      expect(rows).toEqual([
        {
          eventEnvelopeId: arrival.eventId,
          organizationId: STOPPED_ORGANIZATION,
          propertyId: STOPPED_PROPERTY,
          reviewId: reviewIdFor(1),
          state: 'queued',
          attempts: 0,
          nextAttemptAtEpochMillis: NOW + REFUSAL_HOLD_MILLIS,
          firstStartedAtEpochMillis: null,
          origin: 'deferred_live',
        },
      ])

      run.restartUnder({ BETA_ALLOWLIST_ORGS: '*' })
      run.advance(REFUSAL_HOLD_MILLIS)
      await run.fire()

      expect(run.analyzeReview).toHaveBeenCalledTimes(1)
      expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
        organizationId: STOPPED_ORGANIZATION,
        propertyId: STOPPED_PROPERTY,
        internalSubjectId: reviewIdFor(1),
      })
    },
  )

  it('keeps analysing another Organization on delivery while one is suspended', async () => {
    const rows: QueuedEntry[] = []
    const run = worker(
      { BETA_ALLOWLIST_ORGS: '*', BETA_SUSPENDED_ORGS: STOPPED_ORGANIZATION },
      rows,
    )

    await run.arrive(1, STOPPED_SCOPE)
    await run.arrive(2, { org: OTHER_ORGANIZATION, prop: OTHER_PROPERTY })

    expect(
      run.analyzeReview.mock.calls.map(([request]) => request.organizationId),
    ).toEqual([OTHER_ORGANIZATION])
    expect(rows.map((row) => row.organizationId)).toEqual([STOPPED_ORGANIZATION])
  })

  // An Organization that is off the allowlist is refused for good, and most of
  // its Properties never enabled AI. Their reviews must not pile up in the
  // backlog waiting for a stop that is not one.
  it('queues nothing for a Property that never enabled AI, refused or not', async () => {
    const rows: QueuedEntry[] = []
    const run = worker({ BETA_ALLOWLIST_ORGS: OTHER_ORGANIZATION }, rows)
    run.switches.neverEnabled = new Set([STOPPED_PROPERTY, OTHER_PROPERTY])

    const refused = await run.arrive(1, STOPPED_SCOPE)
    const allowed = await run.arrive(2, { org: OTHER_ORGANIZATION, prop: OTHER_PROPERTY })

    expect([refused, allowed]).toMatchObject([
      { delivery: 'completed', receipt: 'applied' },
      { delivery: 'completed', receipt: 'applied' },
    ])
    expect(rows).toEqual([])
    expect(run.analyzeReview).not.toHaveBeenCalled()
  })

  it('holds a review that arrives while the Review Analysis control is killed, and analyses it after the restore', async () => {
    const rows: QueuedEntry[] = []
    const run = worker({ BETA_ALLOWLIST_ORGS: '*' }, rows)
    run.killReviewAnalysis()

    const arrival = await run.arrive(1, STOPPED_SCOPE)
    const queuedOnArrival = rows.map((row) => ({ ...row }))
    await run.fire()

    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(run.settleOutcome).not.toHaveBeenCalled()
    expect(arrival).toMatchObject({ delivery: 'completed', receipt: 'applied' })
    const waiting = {
      eventEnvelopeId: arrival.eventId,
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      reviewId: reviewIdFor(1),
      state: 'queued',
      attempts: 0,
      firstStartedAtEpochMillis: null,
      origin: 'deferred_live',
    }
    expect(queuedOnArrival).toEqual([{ ...waiting, nextAttemptAtEpochMillis: NOW }])
    // The drain asked, was told the control is stopped, and put it back
    // untried: no attempt counted and no horizon running against it.
    expect(rows).toEqual([
      { ...waiting, nextAttemptAtEpochMillis: NOW + REFUSAL_HOLD_MILLIS },
    ])

    run.restoreReviewAnalysis()
    run.advance(REFUSAL_HOLD_MILLIS - 1)
    await run.fire()
    const callsWhileHeld = run.analyzeReview.mock.calls.length
    run.advance(1)
    await run.fire()

    expect(callsWhileHeld).toBe(0)
    expect(run.analyzeReview).toHaveBeenCalledTimes(1)
    expect(run.analyzeReview.mock.calls[0]?.[0]).toMatchObject({
      organizationId: STOPPED_ORGANIZATION,
      propertyId: STOPPED_PROPERTY,
      internalSubjectId: reviewIdFor(1),
    })
  })

  it('leaves a review that was already queued untried while the control is killed', async () => {
    const rows = [queued(1, STOPPED_SCOPE)]
    const run = worker({ BETA_ALLOWLIST_ORGS: '*' }, rows)
    run.killReviewAnalysis()

    await run.fire()

    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(run.settleOutcome).not.toHaveBeenCalled()
    expect(rows).toEqual([
      {
        ...queued(1, STOPPED_SCOPE),
        nextAttemptAtEpochMillis: NOW + REFUSAL_HOLD_MILLIS,
      },
    ])
  })

  it('leaves an opened review queued when its on-demand analysis meets a killed control', async () => {
    const rows = [queued(1, STOPPED_SCOPE)]
    const run = worker({ BETA_ALLOWLIST_ORGS: '*' }, rows)
    run.killReviewAnalysis()

    await run.analyzeNow(queued(1, STOPPED_SCOPE))

    expect(run.analyzeReview).not.toHaveBeenCalled()
    expect(run.settleOutcome).not.toHaveBeenCalled()
    expect(rows).toMatchObject([
      { state: 'queued', attempts: 0, firstStartedAtEpochMillis: null },
    ])
  })

  // A review that was tried before the stop already has an operation, claimed
  // under the control generations of that moment. The kill moves a generation
  // and the restore moves it again, the request fingerprint covers them, and
  // the idempotency key is the review's event, so after the restore the same
  // claim can only answer `conflict`. Settled "disabled" with no operation, the
  // review waited for the reaper to abandon the stale operation at its 24-hour
  // expiry. Closed as suspended, it is the reopen pass's at the next sweep
  // (`ai-review-analysis-reopen.adapter.integration.test.ts`).
  describe.each([
    [
      'its lane was full',
      { laneBusy: true },
      { executionAttempt: 0, failureCode: null, providerCalls: 0 },
    ],
    [
      'the provider said to come back later',
      { laneBusy: false },
      { executionAttempt: 1, failureCode: 'provider_unavailable', providerCalls: 1 },
    ],
  ])(
    'for a queued review that was tried before the kill, when %s',
    (_case, before, tried) => {
      async function triedThenKilledThenRestored() {
        const rows = [queued(1, STOPPED_SCOPE)]
        const run = worker({ BETA_ALLOWLIST_ORGS: '*' }, rows)
        run.switches.laneBusy = before.laneBusy
        await run.fire()
        const beforeTheKill = run.operations()

        run.killReviewAnalysis()
        run.advance(REFUSAL_HOLD_MILLIS)
        await run.fire()
        const duringTheStop = {
          operations: run.operations(),
          settlements: run.settleOutcome.mock.calls.length,
          rows: rows.map((row) => ({ ...row })),
        }

        run.switches.laneBusy = false
        run.restoreReviewAnalysis()
        run.advance(REFUSAL_HOLD_MILLIS)
        await run.fire()
        return { run, rows, beforeTheKill, duringTheStop }
      }

      it('holds the review and its operation untouched while the control is killed', async () => {
        const { beforeTheKill, duringTheStop } = await triedThenKilledThenRestored()

        expect(beforeTheKill).toMatchObject([
          {
            state: 'pending',
            executionAttempt: tried.executionAttempt,
            failureCode: tried.failureCode,
          },
        ])
        expect(duringTheStop.operations).toEqual(beforeTheKill)
        expect(duringTheStop.settlements).toBe(0)
        expect(duringTheStop.rows).toMatchObject([
          { state: 'queued', firstStartedAtEpochMillis: null },
        ])
      })

      it('closes that operation as suspended at the restore and settles the review against it', async () => {
        const { run, rows, beforeTheKill } = await triedThenKilledThenRestored()

        // What the reopen pass selects: the review's operation failed with a
        // reopen code, its sequence settled, and no backlog entry left.
        expect(run.operations()).toEqual([
          { ...beforeTheKill[0], state: 'failed', failureCode: 'execution_suspended' },
        ])
        expect(run.settleOutcome.mock.calls).toEqual([
          [
            expect.objectContaining({
              state: 'terminal_no_result',
              operationId: beforeTheKill[0]?.id,
              dispositionCode: 'operation_abandoned',
            }),
          ],
        ])
        expect(rows).toEqual([])
        // Nothing was sent under the stale operation.
        expect(run.analyzeReview).toHaveBeenCalledTimes(tried.providerCalls)
      })
    },
  )

  // The consumer's catalogue row is ungated so that the review above can be
  // queued. What keeps it from analysing a stopped Organization's review on
  // delivery is the policy question it is handed, so the worker's composition
  // must hand it the drain's own.
  it('is given the scope authorizer of the drain where the worker is composed', () => {
    const composition = readFileSync(join(process.cwd(), 'src/composition.ts'), 'utf8')
    const build = readFileSync(join(process.cwd(), 'src/contexts/ai/build.ts'), 'utf8')

    expect(composition).toMatch(
      /authorizeReviewAnalysisScope: createScheduledScopeAuthorizer\(\s*'system:ai\.review_analysis_backlog_drain',?\s*\)/u,
    )
    expect(build).toMatch(/authorizeScope: input\.authorizeReviewAnalysisScope,/u)
  })
})
