import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { sql } from 'drizzle-orm'
import { getEnv } from '#/shared/config/env'
import { getDb, type Database, type Tx } from '#/shared/db'
import {
  organizationId,
  propertyId,
  portalId,
  ratingId,
  metricReadingId,
} from '#/shared/domain/ids'
import { insertOutboxRow } from '#/shared/outbox/commit'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  checkScopedCapability,
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  createGoalProgramService,
  GoalProgramError,
} from '../../application/use-cases/goal-programs'
import { queryGoalMetric } from '../../application/use-cases/query-goal-metric'
import type { GoalMetricReadPort } from '../../application/use-cases/goal-program-shared'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { createGoalMetricSnapshotReader } from './goal-metric-snapshot'
import { createGoalProgramRepository } from './goal-program.repository'
import { createMetricRegistryRepository } from './metric-registry.repository'
import { createAtomicMetricCommandStore } from '../metric-command-store'
import { createReading } from '../../domain/metric-reading'
import { createGoalOrganizationLifecycleAdapter } from '../adapters/goal-organization-lifecycle.adapter'

const START = new Date('2026-09-01T00:00:00Z')
const NOW = new Date('2026-10-04T00:00:00Z')
const OCCURRED = new Date('2026-09-15T12:00:00Z')
const VERSION = METRIC_VERSION_IDS.portalRatingCountGoal
describe.sequential('Goal result closure barriers (integration)', () => {
  let lease: TestLease
  beforeAll(async () => {
    registerAllEventSchemas()
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })
  afterAll(async () => {
    resetCapabilityPolicyStore()
    await lease?.release()
  })

  async function fixture() {
    const org = organizationId(`goal-closure-${randomUUID()}`)
    const property = propertyId(randomUUID())
    const portal = randomUUID()
    await lease.pool.query(
      `INSERT INTO organization (id, name, slug, "createdAt")
       VALUES ($1, 'Closure organization', $1, $2)`,
      [org, START],
    )
    await lease.pool.query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone)
       VALUES ($1::uuid, $2, 'Closure property', $1::text, 'UTC')`,
      [property, org],
    )
    await lease.pool.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1::uuid, $2, $3::uuid, 'property', $3::text, 'Closure portal', $1::text)`,
      [portal, org, property],
    )
    const installPolicy = (suspended = false) =>
      initCapabilityPolicyStore(
        createEnvCapabilityPolicyStore({
          BETA_ALLOWLIST_ORGS: org,
          BETA_SUSPENDED_ORGS: suspended ? org : '',
        }),
      )
    installPolicy()
    const snapshot = createGoalMetricSnapshotReader(getDb())
    let barrier: (() => Promise<void>) | undefined
    let commitBarrier: (() => Promise<void>) | undefined
    let clock = START
    const metrics: GoalMetricReadPort = {
      getApprovedGoalVersion: async (id) => findMetricVersionById(id),
      queryGoalMetric: queryGoalMetric({
        registry: createMetricRegistryRepository(),
        validateSubject: async () => true,
        clock: () => clock,
        readSnapshot: async (...args) => {
          const completed = await snapshot(...args)
          const pause = barrier
          barrier = undefined
          if (pause) await pause()
          return completed
        },
      }),
    }
    const repository = createGoalProgramRepository(getDb())
    const service = createGoalProgramService({
      repository: {
        ...repository,
        updateResult: (input) => {
          let checks = 0
          return repository.updateResult({
            ...input,
            authorize: async () => {
              if (++checks === 2) {
                const pause = commitBarrier
                commitBarrier = undefined
                if (pause) await pause()
              }
              await input.authorize()
            },
          })
        },
      },
      policy: {
        authorize: async () => {
          if (
            !checkScopedCapability(
              { organizationId: org, propertyId: property },
              'goal.use',
            ).allowed
          )
            throw new GoalProgramError('forbidden')
        },
      },
      subjects: {
        getTimezone: async () => 'UTC',
        subjectBelongsToProperty: async () => true,
      },
      metrics,
      id: randomUUID,
      now: () => clock,
    })
    const actor = {
      organizationId: org,
      userId: 'manager',
      role: 'PropertyManager' as const,
    }
    const created = await service.create(
      {
        propertyId: property,
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 2,
        subjects: [{ kind: 'property', propertyId: property }],
      },
      actor,
    )
    const resultId = created.results[0]!.id
    const reference = { organizationId: org, propertyId: property, resultId }
    clock = NOW
    const source = async (id = randomUUID()) => {
      await lease.pool.query(
        `INSERT INTO outbox_events (id, event_type, event_version, payload, organization_id,
          property_id, source_context, source_aggregate_id, created_at)
         VALUES ($1::uuid, 'guest.rating.submitted', 1, $2, $3, $4, 'guest', $1::text, $5)`,
        [
          id,
          JSON.stringify({ portalId: portal, occurredAt: OCCURRED.toISOString() }),
          org,
          property,
          OCCURRED,
        ],
      )
      return id
    }
    const project = async (sourceId: string) => {
      const readingId = randomUUID()
      await lease.pool.query(
        `INSERT INTO metric_readings (id, organization_id, property_id, portal_id, metric_key,
          value, recorded_at, definition_version_id, source_event_id, source_policy,
          exact_value, sample_count, attribution_quality, event_at, property_local_date,
          data_quality, retention_class)
         VALUES ($1, $2, $3, $4, 'portal.rating_count', 1, $5, $6, $7,
          'first_party_guest_gateway_metric', 1, 1, 'exact', $5, '2026-09-15', 'exact', 'guest_gateway_24_month')`,
        [readingId, org, property, portal, OCCURRED, VERSION, sourceId],
      )
      return readingId
    }
    const receipt = async (id: string) => {
      await lease.pool.query(
        `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
         VALUES ($1, 'metric.guest-analytics', 'applied')`,
        [id],
      )
    }
    const initial = await source()
    const reading = await project(initial)
    await receipt(initial)
    await expect(service.reconcileResult(reference)).resolves.toMatchObject({
      status: 'reconciling',
    })
    const startClosure = () => {
      const reached = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      barrier = async () => {
        reached.resolve()
        await resume.promise
      }
      const pending = service.reconcileResult(reference)
      void pending.catch(reached.reject)
      return { reached: reached.promise, resume: resume.resolve, pending }
    }
    const startCommit = () => {
      const reached = Promise.withResolvers<void>()
      const resume = Promise.withResolvers<void>()
      commitBarrier = async () => {
        reached.resolve()
        await resume.promise
      }
      const pending = service.reconcileResult(reference)
      void pending.then(
        () => reached.reject(new Error('Closure finished before the commit barrier')),
        reached.reject,
      )
      return { reached: reached.promise, resume: resume.resolve, pending }
    }
    const persisted = async () => {
      const rows = await lease.pool.query(
        `SELECT status, value, achieved FROM goal_monthly_results WHERE id = $1`,
        [resultId],
      )
      const facts = await lease.pool.query(
        `SELECT id FROM outbox_events WHERE event_type = 'goal.monthly_result.closed'
          AND payload->>'monthlyResultId' = $1`,
        [resultId],
      )
      return { ...rows.rows[0], closureFacts: facts.rowCount }
    }
    return {
      org,
      property,
      reference,
      service,
      source,
      project,
      receipt,
      reading,
      initial,
      portal,
      startClosure,
      startCommit,
      persisted,
      installPolicy,
    }
  }

  it.each(['fact', 'projection', 'correction'] as const)(
    'rejects a late %s committed after the complete snapshot and retries with fresh evidence',
    async (change) => {
      const f = await fixture()
      const closing = f.startClosure()
      let lateSource: string | undefined
      try {
        await closing.reached
        if (change === 'fact') lateSource = await f.source()
        if (change === 'projection') await f.project(randomUUID())
        if (change === 'correction')
          await lease.pool.query(
            `INSERT INTO metric_corrections (id, reading_id, source_event_id, kind, reason,
            actor_type, actor_id, exact_delta, event_at)
           VALUES ($1::uuid, $2, $1::text, 'adjust', 'source_reconciliation', 'system', 'test', 1, $3)`,
            [randomUUID(), f.reading, OCCURRED],
          )
      } finally {
        closing.resume()
      }
      await expect(closing.pending).rejects.toMatchObject({ code: 'revision_conflict' })
      await expect(f.persisted()).resolves.toMatchObject({
        status: 'reconciling',
        closureFacts: 0,
      })
      if (lateSource) {
        await expect(f.service.reconcileResult(f.reference)).resolves.toMatchObject({
          status: 'reconciling',
          evaluation: { state: 'updating' },
        })
        await f.project(lateSource)
        await f.receipt(lateSource)
      }
      await expect(f.service.reconcileResult(f.reference)).resolves.toMatchObject({
        status: 'closed',
        evaluation: { value: 2, achieved: true },
      })
      await expect(f.persisted()).resolves.toMatchObject({
        status: 'closed',
        closureFacts: 1,
      })
    },
  )

  it('rejects suspension after authorization and a complete snapshot, without a closure fact', async () => {
    const f = await fixture()
    const closing = f.startClosure()
    try {
      await closing.reached
      f.installPolicy(true)
    } finally {
      closing.resume()
    }
    await expect(closing.pending).rejects.toMatchObject({ code: 'forbidden' })
    await expect(f.persisted()).resolves.toMatchObject({
      status: 'reconciling',
      closureFacts: 0,
    })
    f.installPolicy()
    await expect(f.service.reconcileResult(f.reference)).resolves.toMatchObject({
      status: 'closed',
    })
    await expect(f.persisted()).resolves.toMatchObject({ closureFacts: 1 })
  })

  it('rolls back the result and its closure fact when suspension arrives before commit', async () => {
    const f = await fixture()
    const closing = f.startCommit()
    try {
      await closing.reached
      f.installPolicy(true)
    } finally {
      closing.resume()
    }
    await expect(closing.pending).rejects.toMatchObject({ code: 'forbidden' })
    await expect(f.persisted()).resolves.toMatchObject({
      status: 'reconciling',
      closureFacts: 0,
    })
  })

  it('rejects an in-flight fact and retries with its newly committed evidence', async () => {
    const f = await fixture()
    const closing = f.startClosure()
    const written = Promise.withResolvers<void>()
    const commit = Promise.withResolvers<void>()
    let writing: Promise<void> | undefined
    try {
      await closing.reached
      writing = getDb().transaction(async (tx) => {
        await insertOutboxRow(tx, {
          _tag: 'guest.rating.submitted',
          eventId: randomUUID(),
          correlationId: null,
          organizationId: f.org,
          propertyId: f.property,
          portalId: portalId(f.portal),
          ratingId: ratingId(randomUUID()),
          value: 5,
          occurredAt: OCCURRED,
        })
        written.resolve()
        await commit.promise
      })
      void writing.catch(written.reject)
      await written.promise
      closing.resume()
      await expect(closing.pending).rejects.toMatchObject({ code: 'revision_conflict' })
      await expect(f.persisted()).resolves.toMatchObject({
        status: 'reconciling',
        closureFacts: 0,
      })
    } finally {
      closing.resume()
      commit.resolve()
      await closing.pending.catch(() => undefined)
      await writing?.catch(() => undefined)
    }
    await writing
    await expect(f.service.reconcileResult(f.reference)).resolves.toMatchObject({
      status: 'reconciling',
      evaluation: { state: 'updating' },
    })
    await expect(f.persisted()).resolves.toMatchObject({ closureFacts: 0 })
  })

  it.each(['fact', 'projection', 'correction'] as const)(
    'holds a concurrent %s writer until the closure and its event commit',
    async (change) => {
      const f = await fixture()
      const closing = f.startCommit()
      const started = Promise.withResolvers<number>()
      const writerDb = new Proxy(getDb(), {
        get(target, key) {
          if (key !== 'transaction') return Reflect.get(target, key)
          return (work: (tx: Tx) => Promise<unknown>) =>
            target.transaction(async (tx) => {
              const result = await tx.execute(sql`SELECT pg_backend_pid() AS pid`)
              started.resolve(Number(result.rows[0]!['pid']))
              return work(tx)
            })
        },
      }) satisfies Database
      let writing: Promise<unknown> | undefined
      try {
        await closing.reached
        const store = createAtomicMetricCommandStore(writerDb, randomUUID)
        writing =
          change === 'fact'
            ? writerDb.transaction((tx) =>
                insertOutboxRow(tx, {
                  _tag: 'guest.rating.submitted',
                  eventId: randomUUID(),
                  correlationId: null,
                  organizationId: f.org,
                  propertyId: f.property,
                  portalId: portalId(f.portal),
                  ratingId: ratingId(randomUUID()),
                  value: 5,
                  occurredAt: OCCURRED,
                }),
              )
            : change === 'projection'
              ? store.recordMetric({
                  reading: createReading({
                    id: metricReadingId(randomUUID()),
                    definitionVersionId: VERSION,
                    metricKey: 'portal.rating_count',
                    organizationId: f.org,
                    propertyId: f.property,
                    portalId: portalId(f.portal),
                    value: 1,
                    sampleCount: 1,
                    sourceEventId: randomUUID(),
                    sourcePolicy: 'first_party_guest_gateway_metric',
                    occurredAt: OCCURRED,
                    propertyLocalDate: '2026-09-15',
                    attributionQuality: 'exact',
                    retentionClass: 'guest_gateway_24_month',
                    now: NOW,
                  }),
                })
              : store.retractMetric({
                  organizationId: f.org,
                  propertyId: f.property,
                  portalId: portalId(f.portal),
                  definitionVersionId: VERSION,
                  sourceEventId: randomUUID(),
                  supersedesSourceEventId: f.initial,
                  occurredAt: OCCURRED,
                  staffAttribution: null,
                })
        void writing.catch(started.reject)
        const pid = await started.promise
        await vi.waitFor(
          async () => {
            const waiting = await lease.pool.query<{ blocked: boolean }>(
              `SELECT cardinality(pg_blocking_pids($1)) > 0 AS blocked`,
              [pid],
            )
            expect(waiting.rows[0]?.blocked).toBe(true)
          },
          { timeout: 5_000 },
        )
        await expect(f.persisted()).resolves.toMatchObject({
          status: 'reconciling',
          closureFacts: 0,
        })
      } finally {
        closing.resume()
        await closing.pending.catch(() => undefined)
        await writing?.catch(() => undefined)
      }
      await expect(closing.pending).resolves.toMatchObject({ status: 'closed' })
      if (!writing) throw new Error('Concurrent source writer was not started')
      if (change === 'fact') await writing
      else
        await expect(writing).resolves.toMatchObject({
          status: change === 'projection' ? 'recorded' : 'retracted',
        })
      await expect(f.persisted()).resolves.toMatchObject({
        status: 'closed',
        closureFacts: 1,
      })
    },
  )

  it('retries a concurrent organization hold, then drains the month to reach purge readiness', async () => {
    const f = await fixture()
    const closureLineageId = randomUUID()
    const recoverableUntil = new Date('2026-11-01T00:00:00Z')
    const closing = f.startClosure()
    const suspender = await lease.pool.connect()
    let committed = false
    try {
      await closing.reached
      await suspender.query('BEGIN')
      await suspender.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        `organization-lifecycle:${f.org}`,
      ])
      const updated = await suspender.query(
        `UPDATE organization_lifecycle_authority SET state = 'closure_requested',
          revision = revision + 1, closure_lineage_id = $2, closure_requested_at = $3,
          recoverable_until = $4, reactivation_required = true, requested_by = 'operator',
          request_reason_code = 'test_workspace', request_support_evidence_ref = 'test:closure',
          last_transition_at = $3, last_actor_id = 'operator', last_reason_code = 'test_workspace',
          last_support_evidence_ref = 'test:closure'
         WHERE organization_id = $1`,
        [f.org, closureLineageId, NOW, recoverableUntil],
      )
      expect(updated.rowCount).toBe(1)
      closing.resume()
      await expect(closing.pending).rejects.toMatchObject({ code: 'revision_conflict' })
      await expect(f.persisted()).resolves.toMatchObject({
        status: 'reconciling',
        closureFacts: 0,
      })
      await suspender.query('COMMIT')
      committed = true
    } finally {
      if (!committed) await suspender.query('ROLLBACK')
      closing.resume()
      await closing.pending.catch(() => undefined)
      suspender.release()
    }
    const contributor = createGoalOrganizationLifecycleAdapter(getDb())
    const request = {
      organizationId: f.org,
      closureLineageId,
      lifecycleRevision: 1,
      recoverableUntil,
      occurredAt: NOW,
    }
    await expect(contributor.prepareClosing(request)).resolves.toMatchObject({
      outcome: 'complete',
    })
    await lease.pool.query(
      `UPDATE organization_lifecycle_authority SET state = 'closing',
        revision = revision + 1, last_transition_at = $2,
        last_actor_id = 'system', last_reason_code = 'closing_prepared',
        last_support_evidence_ref = 'test:closing'
       WHERE organization_id = $1`,
      [f.org, NOW],
    )
    const readinessRequest = { ...request, lifecycleRevision: 2 }
    await expect(contributor.verifyPurgeReadiness(readinessRequest)).rejects.toThrow(
      'goal purge readiness blocked: 0 active program(s), 1 reconciling result(s)',
    )
    await expect(f.service.reconcileResult(f.reference)).resolves.toMatchObject({
      status: 'closed',
      evaluation: { value: 1, achieved: false },
    })
    await expect(f.persisted()).resolves.toMatchObject({
      status: 'closed',
      closureFacts: 1,
    })
    await expect(
      contributor.verifyPurgeReadiness(readinessRequest),
    ).resolves.toMatchObject({
      outcome: 'complete',
    })
  })
})
