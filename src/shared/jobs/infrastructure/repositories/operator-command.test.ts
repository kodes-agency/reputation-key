// BQC-7.5 — operator command integration proof (real PostgreSQL + real Redis).
//
// fallow-ignore-file boundary-violation
// Cross-zone proof (BQC-7.5) — deliberate, no expiry. This end-to-end proof
// BY DESIGN wires the identity-owned policy boot against the shared jobs
// quarantine contract and the shared operator-command harness (the same
// wiring scripts/ops performs);
// no single context's zone can own it, and the integration project discovers
// it via the infrastructure/repositories glob. Same posture as
// durable-cutover.test.ts (BQC-3.9).
//
// Proves the operator-command chain end to end, mirroring the ops:quarantine
// command (scripts/ops/quarantine-redrive.ts):
//   1. list (a READ) — evaluated through the REAL ExecutionPolicy operator
//      branch (named operator from OPS_OPERATOR_IDENTITIES);
//   2. redrive --apply --reason — the seeded quarantined job moves back to
//      its original queue through the BQC-3 contract (createRedriveJob);
//   3. unregistered operator — denies with operator_not_registered;
//   4. mutation without --apply — dry-run report, nothing redriven.
//
// The policy boot below is the exact wiring scripts/ops/operator-command.ts
// runs (initPersistedCapabilityPolicyStore + strong read + the installed
// ExecutionPolicy singleton) — replicated rather than imported because the
// shim lives outside tsconfig and owns process.exit. The quarantine mechanics
// themselves are proven by failure-quarantine.integration.test.ts (BQC-3.6);
// suite-unique queue names per the Redis lease contract.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { Queue, type Job } from 'bullmq'
import { getDb } from '#/shared/db'
import {
  getExecutionPolicy,
  resetExecutionPolicy,
  type DecisionRequest,
} from '#/shared/auth/execution-policy'
import { resetCapabilityPolicyStore } from '#/shared/auth/beta-capabilities'
import { resetDelayedExecutionPolicy } from '#/shared/auth/system-execution-policy'
import {
  bindProcessPolicies,
  releaseProcessPolicies,
} from '#/shared/auth/process-policy-binding'
import { initPersistedCapabilityPolicyStore } from '#/contexts/identity/infrastructure/policy-store-init'
import {
  createRedriveJob,
  listQuarantinedJobs,
  quarantineExhaustedJob,
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


async function obliterateQuietly(queue: Queue | undefined): Promise<void> {
  if (!queue) return
  try {
    await queue.obliterate({ force: true })
  } catch {
    // best-effort cleanup — the queue may not exist yet
  }
}

/** Seed one already-failed job through the surviving exhausted-attempt path. */
async function seedQuarantined(originalJobId: string): Promise<string> {
  const fakeJob = {
    id: originalJobId,
    name: 'sync-property-reviews',
    queueName: TARGET,
    data: { propertyId: 'prop-1', organizationId: 'org-1' },
    attemptsMade: 3,
    opts: { attempts: 3 },
  } as unknown as Job
  const outcome = await quarantineExhaustedJob(
    quarantineQueue as Queue,
    fakeJob,
    new Error('seeded exhausted failure'),
  )
  if (!outcome.quarantined || !outcome.quarantineJobId) {
    throw new Error('seed failed — job not quarantined')
  }
  return outcome.quarantineJobId
}


beforeAll(async () => {
  // The production operator boot: policy store + both policies + strong read.
  resetCapabilityPolicyStore()
  resetExecutionPolicy()
  resetDelayedExecutionPolicy()
  const handle = initPersistedCapabilityPolicyStore({
    db,
    env: { NODE_ENV: 'test', OPS_OPERATOR_IDENTITIES: OPERATOR },
    clock: () => new Date(),
    logger: { warn: () => {} },
  })
  // ARC-03-T8: the real operator boot now binds the handle explicitly —
  // building it installs nothing.
  bindProcessPolicies(handle)
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
  releaseProcessPolicies()
  resetExecutionPolicy()
  resetDelayedExecutionPolicy()
  resetCapabilityPolicyStore()
  await obliterateQuietly(quarantineQueue)
  await obliterateQuietly(targetQueue)
  await quarantineQueue?.close()
  await targetQueue?.close()
  redisLease?.release()
})

describe('operator command proof (BQC-7.5)', () => {
  it('list (read): returns an allow decision', async () => {
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
    expect(result.decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
      action: 'system:ops',
    })
    expect(result.correlationId).toBeTruthy()
  })

  it('redrive --apply --reason: moves the seeded job back', async () => {
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
    expect(result.decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
      action: 'system:ops',
    })
    expect(await listQuarantinedJobs(quarantineQueue)).toHaveLength(0)
    const waiting = await targetQueue.getJobs(['waiting', 'delayed'])
    expect(waiting).toHaveLength(1)
    const data = waiting[0]!.data as Record<string, unknown>
    expect(data.propertyId).toBe('prop-1')
    expect(data.redriveMetadata).toMatchObject({ originalQuarantineId: quarantineJobId })
  })

  it('redrive without --apply: dry-run report leaves the job in place', async () => {
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
    expect(result.decision).toMatchObject({
      allowed: true,
      reason: 'allowed',
      action: 'system:ops',
    })
    const entries = await listQuarantinedJobs(quarantineQueue)
    expect(entries.map((entry) => entry.quarantineJobId)).toContain(quarantineJobId)
  })

  it('unregistered operator: returns operator_not_registered and skips the action', async () => {
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
  })
})
