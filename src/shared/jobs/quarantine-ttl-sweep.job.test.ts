// Quarantine TTL sweep job unit tests (BQC-7.8).
//
// The dead-letter quarantine queue has no consumer by design — without a
// TTL, redacted envelopes accumulate forever. The sweep pages the quarantine
// queue (bounded), removes entries older than the TTL via job.remove()
// (NEVER obliterate/clean — the queue-quarantine containment constraint),
// emits one content-free log line per removal, skips entries whose remove
// fails (an operator actively redriving holds the lock), and writes a
// retention_runs evidence row (subject 'quarantine.ttl').

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}))

vi.mock('#/shared/db/retention/evidence', () => {
  const closeRetentionRun = vi.fn(
    async (_db: unknown, _id: string, _patch: unknown) => {},
  )
  return {
    openRetentionRun: vi.fn(async (_db, subject: string) => `run-${subject}`),
    closeRetentionRun,
    // Delegate so the failed-outcome assertion exercises the real call shape.
    failRetentionRun: vi.fn(
      async (db: unknown, id: string, finishedAt: Date, err: unknown) => {
        await closeRetentionRun(db, id, {
          finishedAt,
          outcome: 'failed',
          errorCode: (err instanceof Error ? err.message : String(err)).slice(0, 200),
        })
      },
    ),
  }
})
vi.mock('#/shared/observability/logger', () => ({
  getLogger: vi.fn(() => mockLogger),
}))
vi.mock('#/shared/observability/trace', () => ({
  trace: vi.fn((_name: string, fn: () => unknown) => fn()),
}))

import { openRetentionRun, closeRetentionRun } from '#/shared/db/retention/evidence'
import {
  createQuarantineTtlSweepHandler,
  QUARANTINE_TTL_SUBJECT,
  type QuarantineTtlJobHandle,
  type QuarantineTtlQueuePort,
} from './quarantine-ttl-sweep.job'

const NOW = new Date('2026-07-31T12:00:00Z')
const DAY_MS = 24 * 60 * 60 * 1000

type FakeJob = QuarantineTtlJobHandle & {
  remove: ReturnType<typeof vi.fn>
  removeFails?: boolean
}

function makeJob(
  id: string,
  ageMs: number,
  opts: { removeFails?: boolean } = {},
): FakeJob {
  return {
    id,
    name: 'sync-property-reviews',
    timestamp: NOW.getTime() - ageMs,
    removeFails: opts.removeFails,
    remove: vi.fn(async () => {}),
  }
}

/** Fake BullMQ queue: getJobs pages the live list; remove() splices. */
function makeQueue(jobs: FakeJob[]): QuarantineTtlQueuePort & { jobs: FakeJob[] } {
  const live = [...jobs]
  for (const job of live) {
    job.remove.mockImplementation(async () => {
      if (job.removeFails) throw new Error(`Job ${job.id} is locked`)
      const idx = live.indexOf(job)
      if (idx >= 0) live.splice(idx, 1)
    })
  }
  return {
    jobs: live,
    getJobs: vi.fn(async (_types: unknown, start = 0, end = -1) =>
      live.slice(start, end < 0 ? undefined : end + 1),
    ) as never,
  }
}

function handlerDeps(
  queue: QuarantineTtlQueuePort,
  overrides: Record<string, unknown> = {},
) {
  return {
    queue,
    clock: () => NOW,
    ttlMs: 30 * DAY_MS,
    db: {} as never,
    pageSize: 100,
    maxRemovals: 500,
    ...overrides,
  } as const
}

describe('quarantine TTL sweep job (BQC-7.8)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('removes entries older than the TTL with content-free log lines + evidence', async () => {
    const old1 = makeJob('q-1', 40 * DAY_MS)
    const old2 = makeJob('q-2', 31 * DAY_MS)
    const fresh = makeJob('q-3', 2 * DAY_MS)
    const queue = makeQueue([old1, old2, fresh])

    const handler = createQuarantineTtlSweepHandler(handlerDeps(queue))
    const result = await handler({} as never)

    expect(old1.remove).toHaveBeenCalledTimes(1)
    expect(old2.remove).toHaveBeenCalledTimes(1)
    expect(fresh.remove).not.toHaveBeenCalled()
    expect(queue.jobs.map((j) => j.id)).toEqual(['q-3'])
    expect(result).toMatchObject({ removed: 2, skipped: 0, capped: false })

    // Content-free per-removal lines: jobName + queue + age only (the BQC-7.3
    // schema bans jobId; payloads are never logged).
    expect(mockLogger.info).toHaveBeenCalledWith(
      { jobName: 'sync-property-reviews', queue: 'quarantine', ageMs: 40 * DAY_MS },
      expect.stringMatching(/TTL/i),
    )
    const infoPayloads = mockLogger.info.mock.calls.map((c) => c[0])
    for (const payload of infoPayloads) {
      expect(Object.keys(payload as object).sort()).toEqual(['ageMs', 'jobName', 'queue'])
    }

    // Evidence row for the run.
    expect(openRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      QUARANTINE_TTL_SUBJECT,
      100,
      NOW,
    )
    expect(closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      `run-${QUARANTINE_TTL_SUBJECT}`,
      expect.objectContaining({ rowsDeleted: 2, outcome: 'completed' }),
    )
  })

  it('skips entries whose remove() fails (locked by an in-flight redrive) without failing the run', async () => {
    const locked = makeJob('q-locked', 60 * DAY_MS, { removeFails: true })
    const old = makeJob('q-old', 45 * DAY_MS)
    const queue = makeQueue([locked, old])

    const handler = createQuarantineTtlSweepHandler(handlerDeps(queue))
    const result = await handler({} as never)

    expect(result).toMatchObject({ removed: 1, skipped: 1 })
    expect(queue.jobs.map((j) => j.id)).toEqual(['q-locked'])
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ jobName: 'sync-property-reviews' }),
      expect.stringMatching(/skip/i),
    )
    expect(closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      `run-${QUARANTINE_TTL_SUBJECT}`,
      expect.objectContaining({ rowsDeleted: 1, outcome: 'completed' }),
    )
  })

  it('stops at the per-run removal cap and reports capped', async () => {
    const jobs = Array.from({ length: 5 }, (_, i) => makeJob(`q-${i}`, (40 + i) * DAY_MS))
    const queue = makeQueue(jobs)

    const handler = createQuarantineTtlSweepHandler(
      handlerDeps(queue, { maxRemovals: 2 }),
    )
    const result = await handler({} as never)

    expect(result).toMatchObject({ removed: 2, capped: true })
    expect(queue.jobs).toHaveLength(3)
    expect(closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      `run-${QUARANTINE_TTL_SUBJECT}`,
      expect.objectContaining({ rowsDeleted: 2, outcome: 'completed' }),
    )
  })

  it('works without a db (no evidence row) and never touches payloads', async () => {
    const old = makeJob('q-1', 90 * DAY_MS)
    const queue = makeQueue([old])
    const deps = handlerDeps(queue)
    const { db: _db, ...noDb } = deps
    const handler = createQuarantineTtlSweepHandler(noDb)
    const result = await handler({} as never)

    expect(result.removed).toBe(1)
    expect(openRetentionRun).not.toHaveBeenCalled()
    // The queue port is only ever asked for paged job metadata.
    const types = (queue.getJobs as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]
    expect(types).toEqual(expect.arrayContaining(['waiting']))
  })

  it('closes the evidence row failed and rethrows when the queue read fails', async () => {
    const queue: QuarantineTtlQueuePort = {
      getJobs: vi.fn(async () => {
        throw new Error('redis gone')
      }),
    }
    const handler = createQuarantineTtlSweepHandler(handlerDeps(queue))

    await expect(handler({} as never)).rejects.toThrow(/redis gone/)
    expect(closeRetentionRun).toHaveBeenCalledWith(
      expect.anything(),
      `run-${QUARANTINE_TTL_SUBJECT}`,
      expect.objectContaining({ outcome: 'failed' }),
    )
  })
})
