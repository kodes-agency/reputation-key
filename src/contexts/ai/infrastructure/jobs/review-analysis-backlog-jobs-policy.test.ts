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

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Job } from 'bullmq'
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
import { createMockLogger } from '#/shared/testing/mock-logger'
import type {
  AiReviewAnalysisBacklogEntry,
  AiReviewAnalysisBacklogPort,
} from '../../application/ports/ai-review-analysis-backlog.port'
import {
  createAnalyzeReviewEvent,
  type AnalyzeReviewEventDependencies,
} from '../../application/use-cases/analyze-review-event'
import { createDrainReviewAnalysisBacklog } from '../../application/use-cases/drain-review-analysis-backlog'
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

const NOW = Date.parse('2026-10-12T09:00:00.000Z')
/** How long the drain holds an entry it was refused (its DENIED_RETRY_DELAY_MILLIS). */
const REFUSAL_HOLD_MILLIS = 60_000
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
}

function queued(
  index: number,
  scope: Readonly<{ org: OrganizationId; prop: PropertyId }>,
) {
  const suffix = String(index).padStart(12, '0')
  return {
    eventEnvelopeId: `7e000000-0000-4000-8000-${suffix}`,
    organizationId: scope.org,
    propertyId: scope.prop,
    reviewId: reviewId(`7f000000-0000-4000-8000-${suffix}`),
    state: 'queued',
    attempts: 0,
    nextAttemptAtEpochMillis: NOW,
    firstStartedAtEpochMillis: null,
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
      origin: 'historical_onboarding',
      priority,
      attempts: row.attempts,
      firstStartedAtEpochMillis: row.firstStartedAtEpochMillis,
    }
  }
  const port: AiReviewAnalysisBacklogPort = {
    enqueue: async () => {},
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

/**
 * The analysis use case with every gate it owns open: the merchant has enabled
 * Review Analysis and the AI control heads accept work. Whatever stops a review
 * here is therefore the platform policy and nothing else. The provider answers
 * "unavailable", which is all the path after the call needs.
 */
function analysisWithOpenGates(clock: Readonly<{ now: number }>) {
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
  const head = (scope: Readonly<Record<string, string>>, index: number) => ({
    scope,
    controlId: `7c000000-0000-4000-8000-00000000000${index}`,
    generation: 1,
    executionState: 'enabled' as const,
    admissionState: 'accepting' as const,
    updatedAtEpochMillis: NOW,
  })
  const dependencies = {
    authorization: {
      readMerchantAuthorization: async (
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
      }),
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
        head({ kind: 'capability', capability: 'review_analysis' }, 3),
      ],
    },
    inference: { analyzeReview },
    operations: {
      claim: async (request: Readonly<Record<string, unknown>>) => ({
        status: 'created' as const,
        operation: {
          id: '7a000000-0000-4000-8000-000000000001',
          state: 'pending' as const,
          executionAttempt: 0,
          executionPermitId: null,
          failureCode: null,
          createdAtEpochMillis: request.nowEpochMillis,
        },
      }),
      claimExecution: async () => ({
        id: '7a000000-0000-4000-8000-000000000001',
        executionPermitId: '7a000000-0000-4000-8000-000000000002',
      }),
      recordFailure: async () => true,
    },
    admission: {
      acquire: async () => ({
        ok: true as const,
        admissionId: 'admission-1',
        expiresAtEpochMillis: clock.now + 90_000,
      }),
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
  }
}

/** The worker's dispatch of both backlog jobs, under `env` as policy. */
function worker(env: Readonly<Record<string, string>>, rows: QueuedEntry[]) {
  /** The environment policy store is read at boot: a change is a restart. */
  const restartUnder = (policy: Readonly<Record<string, string>>) =>
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore(policy))
  restartUnder(env)
  initDelayedExecutionPolicy(
    createDelayedExecutionPolicy({ refreshPolicy: async () => {} }),
  )
  const clock = { now: NOW }
  const analysis = analysisWithOpenGates(clock)
  const drainer = createDrainReviewAnalysisBacklog({
    backlog: inMemoryBacklog(rows),
    analyzeReviewEvent: analysis.analyzeReviewEvent,
    nowEpochMillis: () => clock.now,
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
  return { fire, analyzeNow, restartUnder, advance, ...analysis }
}

const ACTUAL_VERSIONS = process.versions

describe('Review Analysis backlog jobs under platform policy', () => {
  beforeEach(() => {
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
  })

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

  it.each([
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
  ])(
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
