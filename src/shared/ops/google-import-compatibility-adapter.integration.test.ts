import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import {
  createGoogleImportCompatibilityAdapter,
  GOOGLE_CONNECTED_EVENT_TYPE,
  LEGACY_IMPORT_JOB_NAME,
  type CompatibilityBullJob,
  type CompatibilityBullQueue,
} from './google-import-compatibility-adapter'
import {
  GOOGLE_OAUTH_V1_STATE_DRAIN_MS,
  createGoogleImportCompatibilityLifecycle,
} from './google-import-compatibility-lifecycle'

class MemoryJob implements CompatibilityBullJob {
  removed = false

  constructor(
    readonly name: string,
    readonly data: unknown = {},
  ) {}

  async remove(): Promise<void> {
    this.removed = true
  }
}

class MemoryQueue implements CompatibilityBullQueue {
  readonly jobs = new Map<string, MemoryJob[]>()
  readonly schedulers = new Map<string, string>()
  readonly repeatables = new Map<string, string>()

  add(type: string, job: MemoryJob): MemoryJob {
    const entries = this.jobs.get(type) ?? []
    entries.push(job)
    this.jobs.set(type, entries)
    return job
  }

  async getJobs(types: readonly string[]): Promise<readonly MemoryJob[]> {
    return types
      .flatMap((type) => this.jobs.get(type) ?? [])
      .filter((job) => !job.removed)
  }

  async getJobSchedulers(): Promise<readonly { key: string; name: string }[]> {
    return [...this.schedulers].map(([key, name]) => ({ key, name }))
  }

  async removeJobScheduler(key: string): Promise<boolean> {
    return this.schedulers.delete(key)
  }

  async getRepeatableJobs(): Promise<readonly { key: string; name: string }[]> {
    return [...this.repeatables].map(([key, name]) => ({ key, name }))
  }

  async removeRepeatableByKey(key: string): Promise<boolean> {
    return this.repeatables.delete(key)
  }
}

const OPERATOR = {
  operatorId: 'operator-r1',
  reason: 'R1 compatibility drill',
}

describe('Google import compatibility adapter', () => {
  let lease: TestLease
  let legacySchemaPresent = false
  const environment = `r1-${randomUUID()}`
  const organizationId = `org-${randomUUID()}`
  const legacyJobId = randomUUID()
  const outboxEventId = randomUUID()

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
    const schema = await lease.pool.query<{ present: boolean }>(`
      SELECT
        to_regclass('public.legacy_import_control') IS NOT NULL
        AND to_regclass('public.legacy_import_effect_leases') IS NOT NULL
        AND to_regclass('public.gbp_import_jobs') IS NOT NULL
        AND to_regclass('public.gbp_import_legacy_history') IS NOT NULL
        AS present
    `)
    legacySchemaPresent = schema.rows[0]?.present === true
    if (!legacySchemaPresent) return
    await lease.pool.query(
      `INSERT INTO legacy_import_control (environment) VALUES ($1)`,
      [environment],
    )
  })

  afterAll(async () => {
    if (!lease) return
    if (!legacySchemaPresent) {
      await lease.release()
      return
    }
    await lease.pool.query(`DELETE FROM event_consumer_receipts WHERE event_id = $1`, [
      outboxEventId,
    ])
    await lease.pool.query(`DELETE FROM outbox_events WHERE id = $1`, [outboxEventId])
    await lease.pool.query(
      `DELETE FROM gbp_import_legacy_history WHERE organization_id = $1`,
      [organizationId],
    )
    await lease.pool.query(`DELETE FROM gbp_import_jobs WHERE organization_id = $1`, [
      organizationId,
    ])
    await lease.pool.query(
      `DELETE FROM legacy_import_effect_leases WHERE environment = $1`,
      [environment],
    )
    await lease.pool.query(`DELETE FROM legacy_import_control WHERE environment = $1`, [
      environment,
    ])
    await lease.release()
  })

  it('fences issuance, drains every dormant Bull state, and archives with parity', async () => {
    if (!legacySchemaPresent) {
      const dropped = await lease.pool.query<{
        control: string | null
        leases: string | null
        jobs: string | null
        history: string | null
      }>(`
        SELECT
          to_regclass('public.legacy_import_control')::text AS control,
          to_regclass('public.legacy_import_effect_leases')::text AS leases,
          to_regclass('public.gbp_import_jobs')::text AS jobs,
          to_regclass('public.gbp_import_legacy_history')::text AS history
      `)
      expect(dropped.rows[0]).toEqual({
        control: null,
        leases: null,
        jobs: null,
        history: null,
      })
      return
    }
    const defaultQueue = new MemoryQueue()
    const domainEventsQueue = new MemoryQueue()
    const dormant = [
      'waiting',
      'delayed',
      'prioritized',
      'waiting-children',
      'paused',
      'completed',
      'failed',
    ].map((state) => defaultQueue.add(state, new MemoryJob(LEGACY_IMPORT_JOB_NAME)))
    defaultQueue.schedulers.set('scheduler-legacy', LEGACY_IMPORT_JOB_NAME)
    defaultQueue.repeatables.set('repeatable-legacy', LEGACY_IMPORT_JOB_NAME)
    domainEventsQueue.add(
      'waiting',
      new MemoryJob(GOOGLE_CONNECTED_EVENT_TYPE, { eventVersion: 1 }),
    )

    await lease.pool.query(
      `INSERT INTO gbp_import_jobs (
         id, organization_id, initiated_by, status, total_count,
         imported_count, skipped_count, failed_count, created_at, updated_at
       ) VALUES ($1,$2,$3,'completed_with_skips',3,2,1,0,$4,$4)`,
      [legacyJobId, organizationId, 'user-r1', new Date('2026-08-12T10:00:00.000Z')],
    )
    await lease.pool.query(
      `INSERT INTO outbox_events (
         id, event_type, event_version, payload, organization_id,
         property_id, source_context, source_aggregate_id, created_at
       ) VALUES ($1,$2,1,$3::jsonb,$4,NULL,'integration',$5,$6)`,
      [
        outboxEventId,
        GOOGLE_CONNECTED_EVENT_TYPE,
        JSON.stringify({ connectionId: randomUUID(), organizationId }),
        organizationId,
        randomUUID(),
        new Date('2026-08-12T10:00:00.000Z'),
      ],
    )

    const lifecycle = createGoogleImportCompatibilityLifecycle(
      createGoogleImportCompatibilityAdapter({
        pool: lease.pool,
        defaultQueue,
        domainEventsQueue,
        environment,
      }),
    )
    const initial = await lifecycle.inspect()
    expect(initial.blockers).toEqual(
      expect.arrayContaining([
        'connected_event_v1_issuance',
        'oauth_state_v1_issuance',
        'v1_events_not_drained',
        'legacy_queue_not_empty',
        'legacy_scheduler_not_empty',
        'legacy_repeatable_not_empty',
        'v1_event_queue_not_drained',
        'v1_outbox_not_drained',
      ]),
    )
    expect(initial.legacyRows).toMatchObject({
      total: 1,
      nonterminal: 0,
      statuses: { completed_with_skips: 1 },
    })
    expect(initial.queues.legacyJobs).toMatchObject({
      waiting: 1,
      delayed: 1,
      prioritized: 1,
      waitingChildren: 1,
      paused: 1,
      completed: 1,
      failed: 1,
      active: 0,
    })

    const connectedAt = new Date('2026-08-12T10:01:00.000Z')
    await lifecycle.switchConnectedEvents({ ...OPERATOR, now: connectedAt })
    const oauthAt = new Date('2026-08-12T10:02:00.000Z')
    await lifecycle.switchOauthState({ ...OPERATOR, now: oauthAt })
    await expect(
      lifecycle.markV1EventsDrained({
        ...OPERATOR,
        now: new Date('2026-08-12T10:03:00.000Z'),
      }),
    ).rejects.toThrow('v1 connected events remain in outbox or Bull delivery')

    domainEventsQueue.jobs.clear()
    await lease.pool.query(`UPDATE outbox_events SET published_at = $2 WHERE id = $1`, [
      outboxEventId,
      new Date('2026-08-12T10:03:00.000Z'),
    ])
    await lease.pool.query(
      `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
       VALUES ($1,'activity.event-handlers','applied')`,
      [outboxEventId],
    )
    const drainedAt = new Date('2026-08-12T10:04:00.000Z')
    await lifecycle.markV1EventsDrained({ ...OPERATOR, now: drainedAt })

    await expect(lifecycle.quiesce({ ...OPERATOR, now: drainedAt })).rejects.toThrow(
      'v1 OAuth state drain lifetime has not elapsed',
    )
    const quiescedAt = new Date(oauthAt.getTime() + GOOGLE_OAUTH_V1_STATE_DRAIN_MS)
    await lifecycle.quiesce({ ...OPERATOR, now: quiescedAt })
    await lifecycle.drainLegacyQueues({
      ...OPERATOR,
      now: new Date(quiescedAt.getTime() + 1),
    })
    expect(dormant.every((job) => job.removed)).toBe(true)
    expect(defaultQueue.schedulers.size).toBe(0)
    expect(defaultQueue.repeatables.size).toBe(0)

    await lifecycle.close({
      ...OPERATOR,
      now: new Date(quiescedAt.getTime() + 2),
    })
    const archived = await lifecycle.archive({
      ...OPERATOR,
      now: new Date(quiescedAt.getTime() + 3),
    })
    expect(archived).toMatchObject({
      sourceCount: 1,
      archivedCount: 1,
      deletedCount: 1,
    })
    expect(archived.sourceDigest).toBe(archived.archivedDigest)

    const history = await lease.pool.query<{
      normalized_status: string
      row_digest: string
    }>(
      `SELECT normalized_status, row_digest
       FROM gbp_import_legacy_history WHERE id = $1`,
      [legacyJobId],
    )
    expect(history.rows[0]).toMatchObject({
      normalized_status: 'completed_with_issues',
      row_digest: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    const source = await lease.pool.query(`SELECT 1 FROM gbp_import_jobs WHERE id = $1`, [
      legacyJobId,
    ])
    expect(source.rowCount).toBe(0)
  })
})
