// BQC-7.5 — operator command integration proof (real PostgreSQL + real Redis).
//
// fallow-ignore-file boundary-violation
// Cross-zone proof (BQC-7.5) — deliberate, no expiry. This end-to-end proof
// BY DESIGN wires the identity-owned policy boot (initPersistedCapability-
// PolicyStore) + audit table against the shared jobs quarantine contract and
// the shared operator-command harness (the same wiring scripts/ops performs);
// no single context's zone can own it, and the integration project discovers
// it via the infrastructure/repositories glob. Same posture as
// durable-cutover.test.ts (BQC-3.9).
//
// Proves the operator-command chain end to end, mirroring the ops:quarantine
// command (scripts/ops/quarantine-redrive.ts):
//   1. list (a READ) — evaluated through the REAL ExecutionPolicy operator
//      branch (named operator from OPS_OPERATOR_IDENTITIES) and audited in
//      policy_decision_audit with decision 'allow', reason 'read';
//   2. redrive --apply --reason — the seeded quarantined job moves back to
//      its original queue through the BQC-3 contract (createRedriveJob), and
//      the allow audit row carries the operator reason + correlation id;
//   3. unregistered operator — deny operator_not_registered, audited as deny;
//   4. mutation without --apply — dry-run report, nothing redriven, audited
//      with reason 'dry-run'.
//
// The policy boot below is the exact wiring scripts/ops/operator-command.ts
// runs (initPersistedCapabilityPolicyStore + strong read + the installed
// ExecutionPolicy singleton) — replicated rather than imported because the
// shim lives outside tsconfig and owns process.exit. The quarantine mechanics
// themselves are proven by failure-quarantine.integration.test.ts (BQC-3.6);
// suite-unique queue names per the Redis lease contract.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { sql } from 'drizzle-orm'
import { Queue, type Job } from 'bullmq'
import { getDb } from '#/shared/db'
import {
  EXECUTION_POLICY_VERSION,
  getExecutionPolicy,
  resetExecutionPolicy,
  type DecisionRequest,
} from '#/shared/auth/execution-policy'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import { resetDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import { initPersistedCapabilityPolicyStore } from '#/contexts/identity/infrastructure/policy-store-init'
import {
  createRedriveJob,
  listQuarantinedJobs,
  quarantineJobDirect,
} from '#/shared/jobs/failure-quarantine'
import {
  runOperatorCommand,
  type OperatorIO,
  type OperatorRuntime,
} from '#/shared/ops/operator-command'
import {
  acquireRedisTestLease,
  type RedisTestLease,
} from '#/shared/testing/redis-test-lease'

const OPERATOR = 'op-proof@example.com'
const STRANGER = 'stranger@example.com'
const QUARANTINE = 'bqc75-it-quarantine'
const TARGET = 'bqc75-it-target'

const db = getDb()

let redisLease: RedisTestLease | undefined
let redisAvailable = false
let quarantineQueue: Queue | undefined
let targetQueue: Queue | undefined
let stopPolicyPolling: (() => void) | undefined
let runtime: OperatorRuntime

function memoryIO(): OperatorIO & { outLines: string[]; errLines: string[] } {
  const outLines: string[] = []
  const errLines: string[] = []
  return {
    outLines,
    errLines,
    out: (line) => void outLines.push(line),
    err: (line) => void errLines.push(line),
  }
}

async function auditRowsFor(actorId: string, min: number) {
  let rows: Array<Record<string, unknown>> = []
  for (let i = 0; i < 20 && rows.length < min; i++) {
    const result = await db.execute(
      sql`SELECT actor_type, actor_id, action, execution_kind, decision, reason, policy_version, correlation_id
          FROM policy_decision_audit WHERE actor_id = ${actorId} ORDER BY occurred_at`,
    )
    rows = result.rows as Array<Record<string, unknown>>
    if (rows.length >= min) break
    await new Promise((r) => setTimeout(r, 50))
  }
  return rows
}

async function obliterateQuietly(queue: Queue | undefined): Promise<void> {
  if (!queue) return
  try {
    await queue.obliterate({ force: true })
  } catch {
    // best-effort cleanup — the queue may not exist yet
  }
}

/** Seed one quarantined job (direct-gate path) with a unique original id. */
async function seedQuarantined(originalJobId: string): Promise<string> {
  const fakeJob = {
    id: originalJobId,
    name: 'sync-property-reviews',
    queueName: TARGET,
    data: { propertyId: 'prop-1', organizationId: 'org-1' },
    attemptsMade: 0,
    opts: {},
  } as unknown as Job
  const outcome = await quarantineJobDirect(
    quarantineQueue as Queue,
    fakeJob,
    'routing.region_denied',
  )
  if (!outcome.quarantined || !outcome.quarantineJobId) {
    throw new Error('seed failed — job not quarantined')
  }
  return outcome.quarantineJobId
}

beforeAll(async () => {
  await db.execute(
    sql`DELETE FROM policy_decision_audit WHERE actor_id IN (${OPERATOR}, ${STRANGER})`,
  )

  // The production operator boot: policy store + both policies + strong read.
  resetCapabilityPolicyStore()
  resetExecutionPolicy()
  resetDelayedExecutionPolicy()
  const handle = initPersistedCapabilityPolicyStore({
    db,
    env: { NODE_ENV: 'test', OPS_OPERATOR_IDENTITIES: OPERATOR },
  })
  await handle.refresh()
  stopPolicyPolling = handle.stopPolling
  runtime = { decide: (request: DecisionRequest) => getExecutionPolicy().decide(request) }

  redisLease = await acquireRedisTestLease()
  redisAvailable = redisLease.available
  const redis = redisLease.redis
  if (!redisAvailable || !redis) return
  const connection = redis as unknown as import('bullmq').ConnectionOptions
  quarantineQueue = new Queue(QUARANTINE, { connection })
  targetQueue = new Queue(TARGET, { connection })
  await obliterateQuietly(quarantineQueue)
  await obliterateQuietly(targetQueue)
})

afterAll(async () => {
  stopPolicyPolling?.()
  resetExecutionPolicy()
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  await db.execute(
    sql`DELETE FROM policy_decision_audit WHERE actor_id IN (${OPERATOR}, ${STRANGER})`,
  )
  await obliterateQuietly(quarantineQueue)
  await obliterateQuietly(targetQueue)
  await quarantineQueue?.close()
  await targetQueue?.close()
  redisLease?.release()
})

describe('operator command proof (BQC-7.5)', () => {
  it('list (read): evaluates + audits the allow with reason read', async () => {
    if (!redisAvailable || !quarantineQueue) return
    const io = memoryIO()
    const result = await runOperatorCommand(
      { name: 'ops:quarantine', scope: 'global', usage: '...' },
      async (_ctx, _args, actionIo) => {
        const entries = await listQuarantinedJobs(quarantineQueue as Queue)
        actionIo.out(`quarantined: ${entries.length}`)
      },
      runtime,
      ['--operator', OPERATOR],
      io,
    )

    expect(result.exitCode).toBe(0)
    expect(result.decision?.allowed).toBe(true)
    expect(result.correlationId).toBeTruthy()

    const rows = await auditRowsFor(OPERATOR, 1)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[rows.length - 1]).toMatchObject({
      actor_type: 'operator',
      actor_id: OPERATOR,
      action: 'system:ops',
      execution_kind: 'operator',
      decision: 'allow',
      reason: 'read',
      policy_version: EXECUTION_POLICY_VERSION,
      correlation_id: result.correlationId,
    })
  })

  it('redrive --apply --reason: moves the seeded job back and audits the reason', async () => {
    if (!redisAvailable || !quarantineQueue || !targetQueue) return
    const quarantineJobId = await seedQuarantined('bqc75-it-orig-apply')
    const io = memoryIO()

    const result = await runOperatorCommand(
      { name: 'ops:quarantine', scope: 'global', mutation: true, usage: '...' },
      async (ctx, _args, actionIo) => {
        if (ctx.dryRun) return
        const redrive = createRedriveJob(quarantineQueue as Queue, (name) =>
          name === TARGET ? targetQueue : undefined,
        )
        const redriven = await redrive(quarantineJobId)
        actionIo.out(JSON.stringify(redriven))
        if (!redriven.redriven) return 1
      },
      runtime,
      ['--operator', OPERATOR, '--reason', 'proof redrive', '--apply'],
      io,
    )

    expect(result.exitCode).toBe(0)
    // The job moved: quarantine empty, target holds it with redrive metadata.
    expect(await listQuarantinedJobs(quarantineQueue)).toHaveLength(0)
    const waiting = await targetQueue.getJobs(['waiting', 'delayed'])
    expect(waiting).toHaveLength(1)
    const data = waiting[0]!.data as Record<string, unknown>
    expect(data.propertyId).toBe('prop-1')
    expect(
      (data.redriveMetadata as { originalQuarantineId: string }).originalQuarantineId,
    ).toBe(quarantineJobId)

    const rows = await auditRowsFor(OPERATOR, 1)
    const row = rows[rows.length - 1]
    expect(row).toMatchObject({
      actor_type: 'operator',
      actor_id: OPERATOR,
      decision: 'allow',
      reason: 'proof redrive',
      correlation_id: result.correlationId,
    })
  })

  it('redrive without --apply: dry-run report — nothing moves, audited as dry-run', async () => {
    if (!redisAvailable || !quarantineQueue) return
    const quarantineJobId = await seedQuarantined('bqc75-it-orig-dry')
    const io = memoryIO()

    const result = await runOperatorCommand(
      { name: 'ops:quarantine', scope: 'global', mutation: true, usage: '...' },
      async (ctx, _args, actionIo) => {
        if (ctx.dryRun) {
          actionIo.out('report only — re-run with --apply')
          return
        }
        const redrive = createRedriveJob(quarantineQueue as Queue, () => undefined)
        await redrive(quarantineJobId)
      },
      runtime,
      ['--operator', OPERATOR],
      io,
    )

    expect(result.exitCode).toBe(0)
    // Nothing moved — the seeded job is still quarantined.
    const entries = await listQuarantinedJobs(quarantineQueue)
    expect(entries.map((e) => e.quarantineJobId)).toContain(quarantineJobId)

    const rows = await auditRowsFor(OPERATOR, 1)
    expect(rows[rows.length - 1]).toMatchObject({
      actor_id: OPERATOR,
      decision: 'allow',
      reason: 'dry-run',
      correlation_id: result.correlationId,
    })
  })

  it('unregistered operator: deny operator_not_registered, audited as deny', async () => {
    if (!redisAvailable) return
    const io = memoryIO()
    const actionCalled: boolean[] = []
    const result = await runOperatorCommand(
      { name: 'ops:quarantine', scope: 'global', usage: '...' },
      async () => {
        actionCalled.push(true)
      },
      runtime,
      ['--operator', STRANGER],
      io,
    )

    expect(result.exitCode).toBe(1)
    expect(result.decision?.reason).toBe('operator_not_registered')
    expect(actionCalled).toHaveLength(0)

    const rows = await auditRowsFor(STRANGER, 1)
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows[rows.length - 1]).toMatchObject({
      actor_type: 'operator',
      actor_id: STRANGER,
      action: 'system:ops',
      execution_kind: 'operator',
      decision: 'deny',
      reason: 'operator_not_registered',
      correlation_id: result.correlationId,
    })
  })
})
