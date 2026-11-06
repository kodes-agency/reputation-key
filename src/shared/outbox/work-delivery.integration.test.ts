import { randomUUID } from 'node:crypto'
import type { Job, JobsOptions, Queue } from 'bullmq'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import pino from 'pino'
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import { z } from 'zod/v4'
import { getEnv } from '#/shared/config/env'
import { createWorkItems } from '#/shared/jobs/work-items.server'
import { reconcileWorkItems } from '#/shared/jobs/work-items.server'
import {
  createRetentionSweepHandler,
  RETENTION_RULES,
} from '#/shared/jobs/retention-sweep.job'
import {
  initDelayedExecutionPolicy,
  resetDelayedExecutionPolicy,
} from '#/shared/auth/system-execution-policy'
import { clearEventSchemas, registerEventSchema } from '#/shared/events/schema-registry'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { createOperationsSnapshot } from '#/shared/health/operations-snapshot'
import { createAlertAuxReader } from '#/shared/observability/alert-aux-reads'
import { ALERT_DEFINITIONS } from '#/shared/observability/alert-definitions'
import { createAlertDispatcher } from '#/shared/observability/alert-dispatcher'
import { createConsumerRegistry, type ConsumerEvent } from './consumer-registry'
import { createDispatcherHandler } from './dispatcher'
import { createOutboxRepository } from './infrastructure/outbox-repository'
import { createOutboxRelay } from './relay'

const EVENT_TYPE = 'property.updated'
const KIND = 'outbox-delivery'
const CONSUMERS = [
  'activity.recent-activity',
  'portal.reconcile-health-dependencies',
] as const
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

type Queued = { name: string; data: { workId: string }; options: JobsOptions }
type Work = {
  id: string
  subjectId: string
  state: string
  attempts: number
  maxAttempts: number
}

describe('durable outbox delivery through PostgreSQL', () => {
  let lease: TestLease
  let now: Date
  let organizationId: string
  let otherOrganizationId: string
  let recoveryRunId: string | undefined
  const db = () => drizzle(lease.pool)
  const repository = () => createOutboxRepository(db(), () => now)
  const ledger = () => createWorkItems(db(), () => now)
  const advance = () => {
    now = new Date(now.getTime() + MINUTE)
  }

  beforeAll(async () => {
    lease = await acquireTestLease(getEnv().DATABASE_URL)
  })

  beforeEach(async () => {
    await db().execute(sql`DELETE FROM work_items WHERE kind = ${KIND}`)
    await db().execute(sql`DELETE FROM outbox_events`)
    now = new Date('2026-11-06T10:00:00.000Z')
    organizationId = randomUUID()
    otherOrganizationId = randomUUID()
    recoveryRunId = undefined
    clearEventSchemas()
    registerEventSchema({
      type: EVENT_TYPE,
      version: 1,
      schema: z.object({ resourceId: z.string() }),
    })
    initDelayedExecutionPolicy({
      decide: async (request) => ({
        outcome: 'allow',
        allowed: true,
        reason: 'allowed',
        action: request.action,
        policyVersion: 'test',
        freshRead: false,
      }),
    })
  })

  afterEach(async () => {
    resetDelayedExecutionPolicy()
    clearEventSchemas()
    await db().execute(
      sql`DELETE FROM work_items WHERE organization_id IN (${organizationId}, ${otherOrganizationId})`,
    )
    await db().execute(
      sql`DELETE FROM outbox_events WHERE organization_id IN (${organizationId}, ${otherOrganizationId})`,
    )
    if (recoveryRunId)
      await db().execute(sql`DELETE FROM recovery_runs WHERE id = ${recoveryRunId}::uuid`)
  })

  afterAll(async () => {
    await lease?.release()
  })

  async function fact(input: { publishedAt?: Date; organization?: string } = {}) {
    const eventId = randomUUID()
    await db().execute(sql`
      INSERT INTO outbox_events (id, event_type, event_version, payload, organization_id,
        source_context, source_aggregate_id, created_at, published_at)
      VALUES (${eventId}::uuid, ${EVENT_TYPE}, 1,
        ${JSON.stringify({ resourceId: eventId })}::jsonb,
        ${input.organization ?? organizationId}, 'property', ${eventId},
        ${input.publishedAt ?? now}, ${input.publishedAt ?? null})`)
    return eventId
  }

  async function workFor(eventId: string): Promise<Work> {
    const result = await db().execute<Work>(sql`
      SELECT id, subject_id AS "subjectId", state, attempts, max_attempts AS "maxAttempts"
      FROM work_items WHERE organization_id = ${organizationId}
        AND kind = ${KIND} AND subject_id = ${eventId}`)
    expect(result.rows).toHaveLength(1)
    return result.rows[0]!
  }

  function transport() {
    const accepted: Queued[] = []
    const add = vi.fn(
      async (name: string, data: { workId: string }, options: JobsOptions) => {
        accepted.push({ name, data, options })
        return { id: options.jobId }
      },
    )
    return { accepted, add, queue: { add } as unknown as Queue }
  }

  function dispatcher(
    effect: (
      event: ConsumerEvent,
      consumerName: string,
    ) => Promise<void> = async () => {},
    repo = repository(),
  ) {
    const consumers = createConsumerRegistry()
    const handled = vi.fn(effect)
    for (const consumerName of CONSUMERS) {
      consumers.registerConsumer({
        eventType: EVENT_TYPE,
        consumerName,
        module: 'inbox.outbox-consumers',
        handler: async (event) => {
          await handled(event, consumerName)
          await repo.insertReceipt(event.eventId, consumerName, 'applied')
          return { status: 'applied' }
        },
      })
    }
    return { dispatch: createDispatcherHandler(repo, { consumers }), handled }
  }

  const job = (queued: Queued) =>
    ({
      id: queued.options.jobId,
      name: queued.name,
      data: queued.data,
      opts: queued.options,
    }) as Job

  async function reconcile(queue: ReturnType<typeof transport>) {
    return reconcileWorkItems({
      clock: () => now,
      reserveDispatch: ledger().reserveDispatch,
      enqueue: (kind, data, jobId) => queue.add(kind, data, { jobId, attempts: 1 }),
    })
  }

  async function killDuringDelivery(queued: Queued, eventId: string) {
    const applicationName = `outbox-worker-${randomUUID()}`
    const pool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      application_name: applicationName,
    })
    // A terminated worker cannot handle its database socket errors.
    pool.on('error', () => {})
    pool.on('connect', (client) => client.on('error', () => {}))
    const started = Promise.withResolvers<void>()
    const stop = Promise.withResolvers<void>()
    const dying = dispatcher(
      async (_event, consumerName) => {
        if (consumerName !== CONSUMERS[1]) return
        started.resolve()
        await stop.promise
        throw new Error('Worker terminated')
      },
      createOutboxRepository(drizzle(pool), () => now),
    )
    const outcome = dying.dispatch(job(queued)).catch((error: unknown) => error)
    try {
      await Promise.race([
        started.promise,
        outcome.then((cause) => {
          throw new Error('Worker settled before reaching the blocked consumer', {
            cause,
          })
        }),
      ])
      expect(await repository().hasReceipt(eventId, CONSUMERS[0])).toBe(true)
    } finally {
      // End the worker's pool before releasing its handler so no failure or
      // completion write can survive, and kill its session-held advisory lock.
      const ended = pool.end()
      await db().execute(sql`
        SELECT pg_terminate_backend(pid) FROM pg_stat_activity
        WHERE datname = current_database() AND application_name = ${applicationName}`)
      stop.resolve()
      await outcome
      await ended
    }
    return dying.handled
  }

  it('spends no attempt across repeated enqueue failures and delivers when transport recovers', async () => {
    const eventId = await fact()
    const queue = transport()
    queue.add.mockRejectedValue(new Error('transport unavailable'))
    const relay = createOutboxRelay(repository(), queue.queue)
    const { dispatch, handled } = dispatcher()

    await relay.poll()
    const work = await workFor(eventId)
    expect(work).toMatchObject({ state: 'pending', attempts: 0 })
    for (let failure = 0; failure < 3; failure++) {
      advance()
      expect(await reconcile(queue)).toEqual({ queued: 0, failed: 1 })
      expect(await workFor(eventId)).toMatchObject({
        id: work.id,
        state: 'pending',
        attempts: 0,
      })
    }
    expect(queue.add.mock.calls.length).toBeGreaterThanOrEqual(4)
    expect(handled).not.toHaveBeenCalled()

    queue.add.mockImplementation(async (name, data, options) => {
      queue.accepted.push({ name, data, options })
      return { id: options.jobId }
    })
    advance()
    expect(await reconcile(queue)).toEqual({ queued: 1, failed: 0 })
    expect(queue.accepted).toHaveLength(1)
    const accepted = queue.accepted[0]!
    expect(accepted.data).toEqual({ workId: work.id })
    expect(accepted.options.attempts).toBe(1)
    expect((await workFor(eventId)).attempts).toBe(0)

    await dispatch(job(accepted))
    expect(
      handled.mock.calls.map(([event, consumer]) => [event.eventId, consumer]),
    ).toEqual(CONSUMERS.map((consumer) => [eventId, consumer]))
    expect(await workFor(eventId)).toMatchObject({ state: 'succeeded', attempts: 1 })
    for (const consumer of CONSUMERS)
      expect(await repository().hasReceipt(eventId, consumer)).toBe(true)
    await dispatch(job(accepted))
    advance()
    expect(await reconcile(queue)).toEqual({ queued: 0, failed: 0 })
    expect(handled).toHaveBeenCalledTimes(CONSUMERS.length)
  })

  it('recovers accepted jobs lost with Redis, regardless of publication age', async () => {
    const eventId = await fact()
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    expect(queue.accepted).toHaveLength(1)
    const firstJobId = queue.accepted[0]!.options.jobId
    const work = await workFor(eventId)
    queue.accepted.length = 0

    now = new Date(now.getTime() + 40 * DAY)
    expect(await reconcile(queue)).toEqual({ queued: 1, failed: 0 })
    expect(queue.accepted[0]!.options.jobId).not.toBe(firstJobId)
    expect(queue.accepted[0]!.data).toEqual({ workId: work.id })
    const { dispatch, handled } = dispatcher()
    await dispatch(job(queue.accepted[0]!))
    expect(handled).toHaveBeenCalledTimes(CONSUMERS.length)
    expect(await workFor(eventId)).toMatchObject({ state: 'succeeded', attempts: 1 })
  })

  it('recovers a dead worker within the queue recovery window and skips receipts already committed', async () => {
    const eventId = await fact()
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const work = await workFor(eventId)
    const dyingConsumer = await killDuringDelivery(queue.accepted[0]!, eventId)
    expect(await workFor(eventId)).toMatchObject({ state: 'running', attempts: 1 })
    expect(dyingConsumer).toHaveBeenCalledTimes(CONSUMERS.length)
    expect(await repository().hasReceipt(eventId, CONSUMERS[1])).toBe(false)

    now = new Date(now.getTime() + 90_000)
    expect(await reconcile(queue)).toEqual({ queued: 1, failed: 0 })
    expect(queue.accepted[1]!.data).toEqual({ workId: work.id })
    const restarted = dispatcher()
    await restarted.dispatch(job(queue.accepted[1]!))

    expect(restarted.handled.mock.calls.map(([, consumer]) => consumer)).toEqual([
      CONSUMERS[1],
    ])
    expect(await workFor(eventId)).toMatchObject({ state: 'succeeded', attempts: 2 })
    for (const consumer of CONSUMERS)
      expect(await repository().hasReceipt(eventId, consumer)).toBe(true)
  })

  it('alerts on a worker killed in its final attempt without re-executing consumers or losing the fact', async () => {
    const eventId = await fact({ publishedAt: new Date(now.getTime() - 40 * DAY) })
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const work = await workFor(eventId)
    await db().execute(
      sql`UPDATE work_items SET max_attempts = 1 WHERE id = ${work.id}::uuid`,
    )
    await killDuringDelivery(queue.accepted[0]!, eventId)
    expect(await workFor(eventId)).toMatchObject({ state: 'running', attempts: 1 })
    expect(await repository().delivery.readQuarantineMetrics()).toEqual({
      count: 0,
      oldestAgeMs: null,
    })

    now = new Date(now.getTime() + 90_000)
    expect(await reconcile(queue)).toEqual({ queued: 0, failed: 0 })
    expect(await workFor(eventId)).toMatchObject({ state: 'quarantined', attempts: 1 })
    now = new Date(now.getTime() + 16 * MINUTE)
    const snapshot = await createOperationsSnapshot({
      db: db(),
      outboxRepo: repository(),
      queues: { default: null, background: null, domainEvents: null, quarantine: null },
      redis: null,
      clock: () => now,
      versions: {
        capabilityPolicy: 'test',
        executionPolicy: 'test',
        policyStore: () => 1,
        sourceContentPolicy: 1,
      },
      runtime: {
        poolStats: () => ({ max: 5, totalCount: 1, idleCount: 1, waitingCount: 0 }),
        migrationVersion: async () => 1,
        releaseSha: () => 'a'.repeat(40),
        tenantCache: () => ({ hits: 0, misses: 0, evictions: 0, size: 0 }),
      },
    }).read()
    expect(snapshot.degraded).not.toContain('health.quarantine')
    expect(snapshot.quarantine).toMatchObject({ workItems: { count: 1 } })
    expect(snapshot.quarantine!.workItems!.oldestAgeMs).toBeGreaterThan(15 * MINUTE)
    const logger = pino({ level: 'silent' })
    const aux = await createAlertAuxReader({ db: db(), logger }).read()
    const alert = ALERT_DEFINITIONS.find(
      ({ name }) => name === 'queue.quarantine-nonempty',
    )!.evaluate!(snapshot, aux)
    expect(alert).toMatchObject({ severity: 'P1', facts: { count: 1 } })
    const report = vi.fn()
    await createAlertDispatcher({ logger, clock: () => now, report }).dispatch(alert!)
    expect(report).toHaveBeenCalledWith(alert)

    const restarted = dispatcher()
    await restarted.dispatch(job(queue.accepted[0]!))
    expect(restarted.handled).not.toHaveBeenCalled()
    expect(await workFor(eventId)).toMatchObject({ state: 'quarantined', attempts: 1 })
    await createRetentionSweepHandler({
      db: db(),
      clock: () => now,
      rules: RETENTION_RULES.filter(({ table }) => table === 'outbox_events'),
    })({} as Job)
    expect(
      (await db().execute(sql`SELECT id FROM outbox_events WHERE id = ${eventId}::uuid`))
        .rowCount,
    ).toBe(1)
    expect(await repository().hasReceipt(eventId, CONSUMERS[0])).toBe(true)
    expect(await repository().hasReceipt(eventId, CONSUMERS[1])).toBe(false)

    await ledger().operate(
      organizationId,
      work.id,
      'retry',
      'test-operator',
      'Worker recovered',
    )
    expect(await repository().delivery.readQuarantineMetrics()).toEqual({
      count: 0,
      oldestAgeMs: null,
    })
  })

  it('adopts old published facts even after legacy recovery exhausted, without reviving settled facts', async () => {
    const stranded = await fact({ publishedAt: new Date(now.getTime() - 40 * DAY) })
    const settled = await fact({ publishedAt: new Date(now.getTime() - 40 * DAY) })
    await db().execute(sql`UPDATE outbox_events SET consumer_redelivery_attempts = 3,
      consumer_redelivery_next_at = ${new Date(now.getTime() + DAY)} WHERE id = ${stranded}::uuid`)
    for (const consumer of CONSUMERS)
      await repository().insertReceipt(settled, consumer, 'applied')
    const queue = transport()
    const relay = createOutboxRelay(repository(), queue.queue)
    await relay.poll()

    const work = await workFor(stranded)
    expect(work.attempts).toBe(0)
    expect(queue.accepted.map(({ data }) => data)).toEqual([{ workId: work.id }])
    await relay.poll()
    expect(queue.accepted).toHaveLength(1)
    const { dispatch } = dispatcher()
    await dispatch(job(queue.accepted[0]!))
    expect(await workFor(stranded)).toMatchObject({ state: 'succeeded', attempts: 1 })
  })

  it('recovers more than one lost batch in one pass even when dispatch takes over a minute', async () => {
    const events = await Promise.all(Array.from({ length: 205 }, () => fact()))
    const queue = transport()
    const relay = createOutboxRelay(repository(), queue.queue, { batchSize: 1_000 })
    await relay.poll()
    expect(queue.accepted).toHaveLength(events.length)
    const lostWorkIds = new Set(queue.accepted.map(({ data }) => data.workId))
    queue.accepted.length = 0
    advance()
    let delayed = false
    queue.add.mockImplementation(async (name, data, options) => {
      if (!delayed) {
        now = new Date(now.getTime() + 2 * MINUTE)
        delayed = true
      }
      queue.accepted.push({ name, data, options })
      return { id: options.jobId }
    })

    expect(await reconcile(queue)).toEqual({ queued: events.length, failed: 0 })
    expect(queue.accepted).toHaveLength(events.length)
    expect(new Set(queue.accepted.map(({ data }) => data.workId))).toEqual(lostWorkIds)
    const rows = await db().execute(sql`
      SELECT attempts, dispatch_sequence FROM work_items
      WHERE organization_id = ${organizationId} AND kind = ${KIND}`)
    expect(rows.rows).toHaveLength(events.length)
    for (const row of rows.rows)
      expect(row).toMatchObject({ attempts: 0, dispatch_sequence: 1 })
    await relay.poll()
    expect(queue.accepted).toHaveLength(events.length)
    const tail = queue.accepted.at(-1)!
    await dispatcher().dispatch(job(tail))
    expect(await ledger().inspect(organizationId, tail.data.workId)).toMatchObject({
      state: 'succeeded',
      attempts: 1,
    })
  })

  it('quarantines actual failing executions and retains the fact and successful consumer receipt', async () => {
    const eventId = await fact({ publishedAt: new Date(now.getTime() - 40 * DAY) })
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const work = await workFor(eventId)
    await db().execute(
      sql`UPDATE work_items SET max_attempts = 2 WHERE id = ${work.id}::uuid`,
    )
    const { dispatch, handled } = dispatcher(async (_event, consumer) => {
      if (consumer === CONSUMERS[1]) throw new Error('consumer unavailable')
    })

    await expect(dispatch(job(queue.accepted[0]!))).rejects.toMatchObject({
      name: 'AggregateError',
      errors: [new Error('consumer unavailable')],
    })
    expect(await workFor(eventId)).toMatchObject({ state: 'pending', attempts: 1 })
    advance()
    expect(await reconcile(queue)).toEqual({ queued: 1, failed: 0 })
    await expect(dispatch(job(queue.accepted[1]!))).rejects.toMatchObject({
      name: 'UnrecoverableError',
      cause: {
        name: 'AggregateError',
        errors: [new Error('consumer unavailable')],
      },
    })
    expect(await workFor(eventId)).toMatchObject({ state: 'quarantined', attempts: 2 })
    expect(handled.mock.calls.map(([, consumer]) => consumer)).toEqual([
      CONSUMERS[0],
      CONSUMERS[1],
      CONSUMERS[1],
    ])

    advance()
    expect(await reconcile(queue)).toEqual({ queued: 0, failed: 0 })
    await createRetentionSweepHandler({
      db: db(),
      clock: () => now,
      rules: RETENTION_RULES.filter(({ table }) => table === 'outbox_events'),
    })({} as Job)
    const facts = await db().execute(
      sql`SELECT id FROM outbox_events WHERE id = ${eventId}::uuid`,
    )
    expect(facts.rowCount).toBe(1)
    expect(await repository().hasReceipt(eventId, CONSUMERS[0])).toBe(true)
    expect(await repository().hasReceipt(eventId, CONSUMERS[1])).toBe(false)
  })

  it('quarantines a malformed stored payload on its first execution and retains the fact', async () => {
    const eventId = await fact({ publishedAt: new Date(now.getTime() - 40 * DAY) })
    await db().execute(sql`UPDATE outbox_events SET payload = '{"resourceId":123}'::jsonb
      WHERE id = ${eventId}::uuid`)
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const { dispatch, handled } = dispatcher()

    await expect(dispatch(job(queue.accepted[0]!))).rejects.toMatchObject({
      name: 'UnrecoverableError',
    })
    expect(await workFor(eventId)).toMatchObject({
      state: 'quarantined',
      attempts: 1,
    })
    expect(handled).not.toHaveBeenCalled()

    now = new Date(now.getTime() + DAY)
    expect(await reconcile(queue)).toEqual({ queued: 0, failed: 0 })
    await createRetentionSweepHandler({
      db: db(),
      clock: () => now,
      rules: RETENTION_RULES.filter(({ table }) => table === 'outbox_events'),
    })({} as Job)
    const stored = await db().execute(
      sql`SELECT id FROM outbox_events WHERE id = ${eventId}::uuid`,
    )
    expect(stored.rowCount).toBe(1)
    for (const consumer of CONSUMERS)
      expect(await repository().hasReceipt(eventId, consumer)).toBe(false)
  })

  it('retains the two-hour recovery pause after eight failed consumer executions', async () => {
    const eventId = await fact()
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const work = await workFor(eventId)
    let recovered = false
    const { dispatch, handled } = dispatcher(async (_event, consumerName) => {
      if (consumerName === CONSUMERS[0] && !recovered)
        throw new Error('consumer temporarily unavailable')
    })
    let dueAt: Date | undefined

    for (let attempt = 1; attempt <= 8; attempt++) {
      await expect(dispatch(job(queue.accepted.at(-1)!))).rejects.toMatchObject({
        name: 'AggregateError',
        errors: [new Error('consumer temporarily unavailable')],
      })
      const pending = await ledger().inspect(organizationId, work.id)
      expect(pending).toMatchObject({ state: 'pending', attempts: attempt })
      expect(pending!.dueAt.getTime()).toBeGreaterThan(now.getTime())
      dueAt = pending!.dueAt
      if (attempt < 8) {
        now = dueAt
        expect(await reconcile(queue)).toEqual({ queued: 1, failed: 0 })
      }
    }

    expect(dueAt!.getTime()).toBeGreaterThanOrEqual(now.getTime() + 120 * MINUTE)
    recovered = true
    now = new Date(dueAt!.getTime() - 1)
    expect(await reconcile(queue)).toEqual({ queued: 0, failed: 0 })
    expect((await workFor(eventId)).attempts).toBe(8)
    now = dueAt!
    expect(await reconcile(queue)).toEqual({ queued: 1, failed: 0 })
    await dispatch(job(queue.accepted.at(-1)!))

    expect(await workFor(eventId)).toMatchObject({ state: 'succeeded', attempts: 9 })
    expect(
      handled.mock.calls.filter(([, consumer]) => consumer === CONSUMERS[0]),
    ).toHaveLength(9)
    expect(
      handled.mock.calls.filter(([, consumer]) => consumer === CONSUMERS[1]),
    ).toHaveLength(1)
    for (const consumer of CONSUMERS)
      expect(await repository().hasReceipt(eventId, consumer)).toBe(true)
  })

  it('binds concurrent and forged queue deliveries to one ledger tenant and fact', async () => {
    const eventId = await fact()
    const otherEvent = await fact({ organization: otherOrganizationId })
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const work = await workFor(eventId)
    const queued = queue.accepted.find(({ data }) => data.workId === work.id)!
    const forged = {
      ...job(queued),
      data: {
        workId: work.id,
        organizationId: otherOrganizationId,
        eventId: otherEvent,
        subjectId: otherEvent,
        payload: { resourceId: otherEvent },
      },
    } as Job
    const { dispatch, handled } = dispatcher()
    await Promise.all([dispatch(forged), dispatch(forged)])

    expect(handled).toHaveBeenCalledTimes(CONSUMERS.length)
    for (const [event] of handled.mock.calls)
      expect(event).toMatchObject({
        eventId,
        organizationId,
        payload: { resourceId: eventId },
      })
    expect(await workFor(eventId)).toMatchObject({ state: 'succeeded', attempts: 1 })
    expect(await repository().hasReceipt(otherEvent, CONSUMERS[0])).toBe(false)
  })

  it('keeps a live consumer exclusive after its nominal lease expires', async () => {
    const eventId = await fact()
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const work = await workFor(eventId)
    const queued = queue.accepted.find(({ data }) => data.workId === work.id)!
    const started = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const overlap = Promise.withResolvers<void>()
    let liveConsumerCalls = 0
    const { dispatch, handled } = dispatcher(async (_event, consumerName) => {
      if (consumerName !== CONSUMERS[0]) return
      liveConsumerCalls++
      if (liveConsumerCalls > 1) overlap.resolve()
      started.resolve()
      await release.promise
    })
    const primary = dispatch(job(queued))
    const primaryOutcome = primary.then(
      () => undefined,
      (error: unknown) => error,
    )
    let duplicate: Promise<unknown> | undefined

    try {
      await started.promise
      now = new Date(now.getTime() + 90_000)
      expect((await ledger().reserveDispatch()).some(({ id }) => id === work.id)).toBe(
        false,
      )
      now = new Date(now.getTime() + 31 * MINUTE)
      const due = await ledger().reserveDispatch()
      duplicate = dispatch(job(queued))
      const duplicateOutcome = await Promise.race([
        duplicate.then(() => 'settled'),
        overlap.promise.then(() => 'overlap'),
      ])

      expect(duplicateOutcome).toBe('settled')
      expect(due.some(({ id }) => id === work.id)).toBe(false)
      expect(liveConsumerCalls).toBe(1)
      expect(handled).toHaveBeenCalledOnce()
      expect(await workFor(eventId)).toMatchObject({
        state: 'running',
        attempts: 1,
      })
      expect(
        await ledger().operate(
          organizationId,
          work.id,
          'cancel',
          'test-operator',
          'Consumer still running',
        ),
      ).toBeUndefined()
    } finally {
      release.resolve()
      await Promise.allSettled([primary, ...(duplicate ? [duplicate] : [])])
    }

    expect(await primaryOutcome).toBeUndefined()
    expect(await workFor(eventId)).toMatchObject({
      state: 'succeeded',
      attempts: 1,
    })
    expect(liveConsumerCalls).toBe(1)
    expect(handled).toHaveBeenCalledTimes(CONSUMERS.length)
  })

  it('keeps delivery pending when a consumer returns success without its required receipt', async () => {
    const eventId = await fact()
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const consumers = createConsumerRegistry()
    for (const consumerName of CONSUMERS) {
      consumers.registerConsumer({
        eventType: EVENT_TYPE,
        consumerName,
        module: 'inbox.outbox-consumers',
        handler: async () => ({ status: 'applied' }),
      })
    }

    await expect(
      createDispatcherHandler(repository(), { consumers })(job(queue.accepted[0]!)),
    ).rejects.toThrow('Outbox consumer receipt missing')
    expect(await workFor(eventId)).toMatchObject({ state: 'pending', attempts: 1 })
    for (const consumer of CONSUMERS)
      expect(await repository().hasReceipt(eventId, consumer)).toBe(false)

    advance()
    expect(await reconcile(queue)).toEqual({ queued: 1, failed: 0 })
    await dispatcher().dispatch(job(queue.accepted[1]!))
    expect(await workFor(eventId)).toMatchObject({ state: 'succeeded', attempts: 2 })
  })

  it('keeps recovery-fenced facts out of admission and does not execute an already queued fenced fact', async () => {
    const alreadyQueued = await fact()
    const queue = transport()
    await createOutboxRelay(repository(), queue.queue).poll()
    const queuedWork = await workFor(alreadyQueued)
    const eventId = await fact()
    recoveryRunId = randomUUID()
    await db().execute(sql`INSERT INTO recovery_runs (id, generation, source_release_sha,
      source_manifest_sha256, restore_point_at, operator_id, correlation_id, counts,
      completed_at, created_at)
      SELECT ${recoveryRunId}::uuid, COALESCE(MAX(generation), 0) + 1,
        ${'a'.repeat(40)}, ${randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '')},
        ${now}, 'test-operator', ${randomUUID()}, '{}'::jsonb, ${now}, ${now}
      FROM recovery_runs`)
    await db()
      .execute(sql`UPDATE outbox_events SET recovery_fence_run_id = ${recoveryRunId}::uuid,
      recovery_fenced_at = ${now} WHERE id IN (${eventId}::uuid, ${alreadyQueued}::uuid)`)
    const before = queue.accepted.length
    await createOutboxRelay(repository(), queue.queue).poll()
    expect(queue.accepted).toHaveLength(before)
    const { dispatch, handled } = dispatcher()
    await dispatch(job(queue.accepted.find(({ data }) => data.workId === queuedWork.id)!))
    expect(handled).not.toHaveBeenCalled()
    expect(await repository().hasReceipt(alreadyQueued, CONSUMERS[0])).toBe(false)
  })
})
