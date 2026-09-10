// BQC-7.4 — alert injection against the REAL reads (real PostgreSQL).
//
// The unit suite (src/shared/jobs/alert-injection.test.ts) injects every
// implemented alert with synthetic fixtures; this suite is the
// INTEGRATION-level injection the phase doc asks for ("every alert must be
// injected at least once before BQC-8 acceptance" — the real-read half):
// breach state is seeded into the scratch database, the health-check job
// evaluates the REAL OperationsSnapshot + aux reads (no mocked metrics),
// and the dispatched webhook payloads are captured by a fake fetch.
//
// Injections (one describe each):
//   (a) STALLED OUTBOX LEASE — a real unpublished row with an unexpired
//       lease whose leased_at is older than 2× the relay lease: the real
//       health-metrics read computes stalledLeaseCount=1 (delta over the
//       pre-seed baseline) and queue.stalled + queue.oldest-age dispatch.
//   (b) RETENTION FAILURE — a real retention_runs row with outcome='failed'
//       as the subject's latest run: the aux DISTINCT-ON read reports it and
//       retention.failure dispatches naming the subject.
//   (c) BETA-FEEDBACK TRIAGE BACKLOG — one delivered, unresolved content-free
//       receipt older than 72h: the aux aggregate reports count + oldest age
//       and beta-feedback.triage-backlog dispatches without report content.
//   (e) REVIEW ANALYSIS — enabled coverage with four unsettled sequences and
//       an actionable empty enrollment whose fenced eligible set is non-empty.
//
// Determinism/cleanup: rows use a suite-unique org/subject marker and are
// deleted after each test; the integration project runs serially
// (maxWorkers: 1), so no other suite observes the seeded breach state. No
// Redis dependency: the snapshot's heartbeat section reads a fresh fake
// port so worker.heartbeat.stale stays quiet.

import { describe, it, expect, afterEach, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import pino from 'pino'
import { getDb } from '#/shared/db'
import { createOutboxRepository } from '#/shared/outbox/infrastructure/outbox-repository'
import { createOperationsSnapshot } from '#/shared/health/operations-snapshot'
import { createAlertAuxReader } from '#/shared/observability/alert-aux-reads'
import {
  createAlertDispatcher,
  type AlertFetchFn,
} from '#/shared/observability/alert-dispatcher'
import {
  BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
  REVIEW_ANALYSIS_STALLED_ALERT_MS,
} from '#/shared/observability/alert-definitions'
import { isBannedLogKey } from '#/shared/observability/metrics-schema'
import type { AlertStateStore } from '#/shared/health/alert-state'
import type { RedisHeartbeatPort } from '#/shared/health/worker-heartbeat'
import { createHealthCheckHandler } from '#/shared/jobs/health-check.job'
import {
  aiReviewAnalysisEnrollments,
  merchantAiConsentEvidence,
  merchantAiEnablement,
  outboxEvents,
  properties,
  reviewAiAnalysisHeads,
  reviews,
} from '#/shared/db/schema'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_VERSION,
} from '#/shared/merchant-ai-notice-contract'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'

const MARKER_ORG = 'org-bqc74-alert-injection'
const RETENTION_SUBJECT = 'bqc74.test-subject'
const FEEDBACK_REFERENCE = '6108c5d6-3f73-4f06-9b62-1121eeea052f'
const ANALYSIS_ORG = 'org-bqc74-review-analysis-alert'
const STALLED_ANALYSIS_PROPERTY = '6208c5d6-3f73-4f06-9b62-1121eeea0501'
const EMPTY_ENROLLMENT_PROPERTY = '6208c5d6-3f73-4f06-9b62-1121eeea0502'
const NO_ENABLEMENT_PROPERTY = '6208c5d6-3f73-4f06-9b62-1121eeea0508'
const STALLED_ANALYSIS_LINEAGE = '6208c5d6-3f73-4f06-9b62-1121eeea0503'
const EMPTY_ENROLLMENT_LINEAGE = '6208c5d6-3f73-4f06-9b62-1121eeea0504'
const EMPTY_ENROLLMENT_ID = '6208c5d6-3f73-4f06-9b62-1121eeea0505'
const EMPTY_ENROLLMENT_TRIGGER = '6208c5d6-3f73-4f06-9b62-1121eeea0506'
const ELIGIBLE_REVIEW_ID = '6208c5d6-3f73-4f06-9b62-1121eeea0507'
const EMPTY_REVISION_SET_DIGEST =
  'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'

const db = getDb()
const outboxRepo = createOutboxRepository(db)

/** Fresh-heartbeat fake — keeps worker.heartbeat.stale quiet without Redis. */
const freshHeartbeat: RedisHeartbeatPort = {
  set: async () => 'OK',
  get: async () => new Date().toISOString(),
}

function inMemoryStateStore(): AlertStateStore {
  const firing = new Set<string>()
  return {
    currentlyFiring: async (names) =>
      new Set([...firing].filter((n) => names.includes(n))),
    markFiring: async (name) => {
      firing.add(name)
    },
    clearFiring: async (name) => {
      firing.delete(name)
    },
  }
}

/** Build the health-check handler over the REAL snapshot + aux reads. */
function realEvaluationHarness() {
  const logger = pino({ level: 'silent' })
  const warn = vi.spyOn(logger, 'warn')
  const error = vi.spyOn(logger, 'error')
  const fetchFn = vi.fn<AlertFetchFn>(async () => ({ ok: true, status: 200 }))
  const snapshotReader = createOperationsSnapshot({
    db,
    outboxRepo,
    queues: { default: null, background: null, domainEvents: null, quarantine: null },
    redis: freshHeartbeat,
    clock: () => new Date(),
    versions: {
      capabilityPolicy: 'bqc74-test',
      executionPolicy: 'bqc74-test',
      policyStore: () => null,
      sourceContentPolicy: 1,
    },
    readGuestObservationLoss: async () => ({
      monitorAvailable: true,
      windowMs: 24 * 60 * 60 * 1000,
      precisionMs: 5 * 60 * 1000,
      scanLossCount: 0,
      reviewLinkLossCount: 0,
      ratingLossCount: 0,
      totalLossCount: 0,
      ratingDisposition: 'not_applicable_durable',
    }),
  })
  const auxReader = createAlertAuxReader({ db, logger })
  const handler = createHealthCheckHandler({
    dbHealthy: async () => true,
    redisHealthy: async () => true,
    logger,
    clock: () => new Date(),
    readOperationsSnapshot: () => snapshotReader.read(),
    readAlertAux: () => auxReader.read(),
    alertState: inMemoryStateStore(),
    alertDispatcher: createAlertDispatcher({
      logger,
      clock: () => new Date(),
      webhookUrl: 'https://ops.example.test/bqc74-hook',
      fetchFn,
    }),
  })
  return { handler, fetchFn, warn, error, snapshotReader }
}

/** The webhook payloads captured by the fake fetch (parsed bodies). */
function dispatchedPayloads(fetchFn: ReturnType<typeof vi.fn<AlertFetchFn>>) {
  return fetchFn.mock.calls.map((call) => {
    expect(call[0]).toBe('https://ops.example.test/bqc74-hook')
    return JSON.parse(String(call[1]?.body)) as Record<string, unknown>
  })
}

function expectNoBannedKeys(payloads: ReadonlyArray<Record<string, unknown>>) {
  for (const payload of payloads) {
    for (const key of Object.keys(payload)) {
      expect(isBannedLogKey(key), `banned key: ${key}`).toBe(false)
    }
  }
}

afterEach(async () => {
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${ANALYSIS_ORG}`)
  await db.execute(sql`DELETE FROM properties WHERE organization_id = ${ANALYSIS_ORG}`)
  await deleteTestOrganizations(db, [ANALYSIS_ORG])
  await db.execute(sql`DELETE FROM outbox_events WHERE organization_id = ${MARKER_ORG}`)
  await db.execute(sql`DELETE FROM retention_runs WHERE subject = ${RETENTION_SUBJECT}`)
  await db.execute(
    sql`DELETE FROM beta_feedback_triage WHERE reference = ${FEEDBACK_REFERENCE}`,
  )
})

describe('BQC-7.4 alert injection — real reads', () => {
  it('(a) a real stalled outbox lease dispatches queue.stalled + queue.oldest-age', async () => {
    const { handler, fetchFn, warn, snapshotReader } = realEvaluationHarness()

    // Baseline: the shared scratch DB may carry other suites' leftovers.
    const baseline = (await snapshotReader.read()).outbox.stalledLeaseCount

    // Seed: unpublished for ~2h, lease unexpired (+1h) but leased 2h ago —
    // stalled by the real 2× DEFAULT_LEASE_DURATION_MS (30s) predicate.
    const now = Date.now()
    await db.execute(sql`
      INSERT INTO outbox_events
        (event_type, event_version, payload, organization_id, source_context,
         source_aggregate_id, created_at, lease_owner, leased_at, lease_expires_at)
      VALUES
        ('test.bqc74.alert', 1, '{}'::jsonb, ${MARKER_ORG}, 'bqc74', 'agg-1',
         ${new Date(now - 2 * 60 * 60 * 1000)}, 'bqc74-relay',
         ${new Date(now - 2 * 60 * 60 * 1000)}, ${new Date(now + 60 * 60 * 1000)})
    `)

    const result = await handler({ id: 'bqc74-a', data: {} } as never)

    expect(result.alerts?.firing).toContain('queue.stalled')
    expect(result.alerts?.dispatched).toContain('queue.stalled')
    expect(result.alerts?.dispatched).toContain('queue.oldest-age')

    const payloads = dispatchedPayloads(fetchFn)
    const stalled = payloads.find((p) => p.alert === 'queue.stalled')
    expect(stalled).toMatchObject({
      severity: 'P2',
      owner: 'Bozhidar Denev',
      runbook: 'runbooks.md §7',
      threshold: 0,
      // The seeded lease over the pre-seed baseline — causal attribution.
      value: baseline + 1,
    })
    const oldestAge = payloads.find((p) => p.alert === 'queue.oldest-age')
    expect(Number(oldestAge?.value)).toBeGreaterThanOrEqual(
      2 * 60 * 60 * 1000 - 60 * 1000,
    )

    // Every dispatched field is content-free, and no aux read degraded.
    expectNoBannedKeys(payloads)
    expect(
      warn.mock.calls.filter((c) => String(c[1]).match(/alert-aux/)),
      'aux reads must succeed against the real schema',
    ).toEqual([])

    // Edge-trigger: a second run over the same state dispatches nothing.
    fetchFn.mockClear()
    const second = await handler({ id: 'bqc74-a2', data: {} } as never)
    expect(second.alerts?.dispatched).toEqual([])
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('(b) a real failed retention run dispatches retention.failure', async () => {
    const { handler, fetchFn, warn } = realEvaluationHarness()

    // Seed: the subject's LATEST run failed (an earlier completed run proves
    // the DISTINCT-ON latest-per-subject semantics, not just presence).
    await db.execute(sql`
      INSERT INTO retention_runs (subject, started_at, batch_size, batches, outcome)
      VALUES
        (${RETENTION_SUBJECT}, NOW() - INTERVAL '2 hours', 100, 1, 'completed'),
        (${RETENTION_SUBJECT}, NOW() - INTERVAL '1 hour', 100, 0, 'failed')
    `)

    const result = await handler({ id: 'bqc74-b', data: {} } as never)

    expect(result.alerts?.dispatched).toContain('retention.failure')
    const payloads = dispatchedPayloads(fetchFn)
    const retention = payloads.find((p) => p.alert === 'retention.failure')
    expect(retention).toMatchObject({
      severity: 'P1',
      runbook: 'runbooks.md §8',
      threshold: 0,
    })
    // The seeded subject is named in the dispatch — causal attribution
    // (the shared scratch DB may carry other suites' completed rows).
    expect(Number(retention?.value)).toBeGreaterThanOrEqual(1)
    expect(String(retention?.detail)).toContain(RETENTION_SUBJECT)
    expectNoBannedKeys(payloads)
    expect(warn.mock.calls.filter((c) => String(c[1]).match(/alert-aux/))).toEqual([])
  })

  it('(d) a real content-free feedback receipt dispatches beta-feedback.triage-backlog', async () => {
    const { handler, fetchFn, warn } = realEvaluationHarness()

    await db.execute(sql`
      INSERT INTO beta_feedback_triage
        (reference, organization_pseudonym, actor_pseudonym, feedback_type,
         impact_code, route_key, viewport, reporter_role, delivery_state,
         provider_reference, attachment_kind, created_at, updated_at)
      VALUES
        (${FEEDBACK_REFERENCE}, ${'a'.repeat(64)}, ${'b'.repeat(64)}, 'bug',
         'small_issue', 'dashboard', 'regular', 'AccountAdmin', 'delivered',
         ${'c'.repeat(32)}, 'none',
         NOW() - INTERVAL '73 hours', NOW() - INTERVAL '73 hours')
    `)

    const result = await handler({ id: 'bqc74-d', data: {} } as never)

    expect(result.alerts?.dispatched).toContain('beta-feedback.triage-backlog')
    const payloads = dispatchedPayloads(fetchFn)
    const backlog = payloads.find(
      (payload) => payload.alert === 'beta-feedback.triage-backlog',
    )
    expect(backlog).toMatchObject({
      severity: 'P2',
      runbook: 'runbooks.md §16',
      threshold: BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS,
    })
    expect(Number(backlog?.value)).toBeGreaterThan(BETA_FEEDBACK_TRIAGE_BACKLOG_ALERT_MS)
    expectNoBannedKeys(payloads)
    expect(warn.mock.calls.filter((c) => String(c[1]).match(/alert-aux/))).toEqual([])
  })

  it('(e) real Review Analysis ledger/enrollment gaps dispatch both alerts', async () => {
    const { handler, fetchFn, warn } = realEvaluationHarness()
    const baseline = await createAlertAuxReader({
      db,
      logger: pino({ level: 'silent' }),
    }).read()
    const now = new Date()
    const stalledAt = new Date(now.getTime() - 30 * 60 * 1000)

    await db.execute(sql`
      INSERT INTO organization (id, name, slug, "createdAt")
      VALUES (
        ${ANALYSIS_ORG},
        'Review Analysis alert integration',
        ${ANALYSIS_ORG},
        ${stalledAt}
      )
    `)
    await db.insert(properties).values([
      {
        id: STALLED_ANALYSIS_PROPERTY,
        organizationId: ANALYSIS_ORG,
        name: 'Stalled analysis fixture',
        slug: 'stalled-analysis-fixture',
        timezone: 'America/New_York',
        countryCode: 'US',
        profileVersion: 1,
        sourceEpoch: 0,
      },
      {
        id: EMPTY_ENROLLMENT_PROPERTY,
        organizationId: ANALYSIS_ORG,
        name: 'Empty enrollment fixture',
        slug: 'empty-enrollment-fixture',
        timezone: 'America/New_York',
        countryCode: 'US',
        profileVersion: 1,
        sourceEpoch: 0,
      },
      {
        id: NO_ENABLEMENT_PROPERTY,
        organizationId: ANALYSIS_ORG,
        name: 'No AI enablement fixture',
        slug: 'no-ai-enablement-fixture',
        timezone: 'America/New_York',
        countryCode: 'US',
        profileVersion: 1,
        sourceEpoch: 0,
      },
    ])
    await db.insert(reviewAiAnalysisHeads).values([
      {
        organizationId: ANALYSIS_ORG,
        propertyId: STALLED_ANALYSIS_PROPERTY,
        sourceEpoch: 0,
        headSequence: 4,
        createdAt: stalledAt,
        updatedAt: stalledAt,
      },
      {
        organizationId: ANALYSIS_ORG,
        propertyId: EMPTY_ENROLLMENT_PROPERTY,
        sourceEpoch: 0,
        headSequence: 2,
        createdAt: stalledAt,
        updatedAt: stalledAt,
      },
      {
        organizationId: ANALYSIS_ORG,
        propertyId: NO_ENABLEMENT_PROPERTY,
        sourceEpoch: 0,
        headSequence: 1,
        createdAt: stalledAt,
        updatedAt: stalledAt,
      },
    ])
    await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('repkey.merchant_ai_transition', '1', true)`)
      for (const auth of [
        {
          propertyId: STALLED_ANALYSIS_PROPERTY,
          lineageId: STALLED_ANALYSIS_LINEAGE,
          analysisStartSequence: 0,
          idempotencyKey: 'review-analysis-stall-alert-enable',
          requestHash: 'd'.repeat(64),
        },
        {
          propertyId: EMPTY_ENROLLMENT_PROPERTY,
          lineageId: EMPTY_ENROLLMENT_LINEAGE,
          analysisStartSequence: 2,
          idempotencyKey: 'review-analysis-empty-alert-enable',
          requestHash: 'e'.repeat(64),
        },
      ]) {
        await tx.insert(merchantAiConsentEvidence).values({
          organizationId: ANALYSIS_ORG,
          propertyId: auth.propertyId,
          authorizationLineageId: auth.lineageId,
          stateVersion: 1,
          transitionKind: 'enable',
          state: 'enabled',
          capabilities: ['review_analysis'],
          capabilityRuntimeProfileVersions: {
            review_analysis: 'review-analysis-runtime-v1',
          },
          reviewAnalysisEpoch: 1,
          replyDraftingEpoch: 1,
          propertyTrendsEpoch: 1,
          authorizedSourceEpoch: 0,
          analysisStartSequence: auth.analysisStartSequence,
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
          sourcePolicyId: 'google-business-profile-source-policy-v1',
          routingPolicyVersion: 1,
          processingRegion: 'global',
          providerDeploymentProfileVersion: 'private-beta-global-v1',
          redactionProfileFamily: 'gbp-review-global-v1',
          actorUserId: 'review-analysis-alert-test-actor',
          reasonCode: 'merchant_enabled',
          idempotencyKey: auth.idempotencyKey,
          requestHash: auth.requestHash,
          occurredAt: stalledAt,
        })
        await tx.insert(merchantAiEnablement).values({
          propertyId: auth.propertyId,
          organizationId: ANALYSIS_ORG,
          authorizationLineageId: auth.lineageId,
          state: 'enabled',
          capabilities: ['review_analysis'],
          capabilityRuntimeProfileVersions: {
            review_analysis: 'review-analysis-runtime-v1',
          },
          reviewAnalysisEpoch: 1,
          replyDraftingEpoch: 1,
          propertyTrendsEpoch: 1,
          authorizedSourceEpoch: 0,
          analysisStartSequence: auth.analysisStartSequence,
          stateVersion: 1,
          noticeVersion: MERCHANT_AI_NOTICE_VERSION,
          noticeDigest: MERCHANT_AI_NOTICE_DIGEST,
          sourcePolicyId: 'google-business-profile-source-policy-v1',
          routingPolicyVersion: 1,
          processingRegion: 'global',
          providerDeploymentProfileVersion: 'private-beta-global-v1',
          redactionProfileFamily: 'gbp-review-global-v1',
          updatedBy: 'review-analysis-alert-test-actor',
          updatedAt: stalledAt,
        })
      }
    })
    await db.insert(outboxEvents).values(
      [1, 2, 3, 4].map((analysisSequence) => {
        const reviewId = `6208c5d6-3f73-4f06-9b62-${String(600 + analysisSequence).padStart(12, '0')}`
        return {
          id: `6208c5d6-3f73-4f06-9b62-${String(700 + analysisSequence).padStart(12, '0')}`,
          eventType: 'ai.review_analysis.backfill_requested',
          eventVersion: 1,
          payload: {
            reviewId,
            sourceEpoch: 0,
            sourceRevision: 1,
            analysisSequence,
          },
          organizationId: ANALYSIS_ORG,
          propertyId: STALLED_ANALYSIS_PROPERTY,
          sourceContext: 'ai',
          sourceAggregateId: reviewId,
          createdAt: stalledAt,
        }
      }),
    )
    await db.insert(outboxEvents).values({
      id: '6208c5d6-3f73-4f06-9b62-1121eeea0801',
      eventType: 'review.created',
      eventVersion: 1,
      payload: {
        reviewId: '6208c5d6-3f73-4f06-9b62-1121eeea0802',
        sourceEpoch: 0,
        sourceRevision: 1,
        analysisSequence: 1,
      },
      organizationId: ANALYSIS_ORG,
      propertyId: NO_ENABLEMENT_PROPERTY,
      sourceContext: 'review',
      sourceAggregateId: '6208c5d6-3f73-4f06-9b62-1121eeea0802',
      createdAt: stalledAt,
    })
    await db.insert(reviews).values({
      id: ELIGIBLE_REVIEW_ID,
      organizationId: ANALYSIS_ORG,
      propertyId: EMPTY_ENROLLMENT_PROPERTY,
      platform: 'google',
      externalId: 'review-analysis-empty-enrollment-alert',
      reviewerName: 'Synthetic reviewer',
      rating: 5,
      text: 'Synthetic eligibility fixture',
      languageCode: 'en',
      reviewedAt: stalledAt,
      contentExpiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      sourceEpoch: 0,
      sourceRevision: 1,
      analysisSequence: 2,
      aiSourceByteLength: 32,
      aiSourceDigest: 'f'.repeat(64),
    })
    await db.insert(aiReviewAnalysisEnrollments).values({
      id: EMPTY_ENROLLMENT_ID,
      organizationId: ANALYSIS_ORG,
      propertyId: EMPTY_ENROLLMENT_PROPERTY,
      authorizationLineageId: EMPTY_ENROLLMENT_LINEAGE,
      authorizationStateVersion: 1,
      sourceEpoch: 0,
      reviewAnalysisEpoch: 1,
      analysisStartSequence: 2,
      providerDeploymentProfileVersion: 'private-beta-global-v1',
      triggerEventEnvelopeId: EMPTY_ENROLLMENT_TRIGGER,
      state: 'queued',
      snapshotRevisionCount: 0,
      snapshotRevisionSetDigest: EMPTY_REVISION_SET_DIGEST,
      snapshotCapturedAt: stalledAt,
      createdAt: stalledAt,
      updatedAt: stalledAt,
    })

    const observed = await createAlertAuxReader({
      db,
      logger: pino({ level: 'silent' }),
    }).read()
    expect(observed.reviewAnalysis).toMatchObject({
      monitorAvailable: true,
      incompletePropertyCount: baseline.reviewAnalysis.incompletePropertyCount + 1,
      pendingSettlementCount: baseline.reviewAnalysis.pendingSettlementCount + 4,
      zeroSnapshotEnrollmentCount:
        baseline.reviewAnalysis.zeroSnapshotEnrollmentCount + 1,
      eligibleReviewCountMissed: baseline.reviewAnalysis.eligibleReviewCountMissed + 1,
    })
    expect(observed.reviewAnalysis.oldestNoProgressAgeMs).toBeGreaterThan(
      REVIEW_ANALYSIS_STALLED_ALERT_MS,
    )

    const result = await handler({ id: 'bqc74-e', data: {} } as never)
    expect(result.alerts?.dispatched).toContain('ai.review-analysis-stalled')
    expect(result.alerts?.dispatched).toContain('ai.review-analysis-empty-enrollment')
    const payloads = dispatchedPayloads(fetchFn)
    const stalled = payloads.find(
      (payload) => payload.alert === 'ai.review-analysis-stalled',
    )
    expect(stalled).toMatchObject({
      severity: 'P2',
      runbook: 'runbooks.md §22',
      threshold: REVIEW_ANALYSIS_STALLED_ALERT_MS,
    })
    expect(Number(stalled?.value)).toBeGreaterThan(REVIEW_ANALYSIS_STALLED_ALERT_MS)
    const emptyEnrollment = payloads.find(
      (payload) => payload.alert === 'ai.review-analysis-empty-enrollment',
    )
    expect(emptyEnrollment).toMatchObject({
      severity: 'P2',
      runbook: 'runbooks.md §22',
      threshold: 0,
    })
    expect(String(stalled?.detail)).not.toContain('Synthetic eligibility fixture')
    expect(String(emptyEnrollment?.detail)).not.toContain('Synthetic eligibility fixture')
    expectNoBannedKeys(payloads)
    expect(warn.mock.calls.filter((c) => String(c[1]).match(/alert-aux/))).toEqual([])
  })
})
