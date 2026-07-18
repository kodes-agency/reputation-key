// BQC-3.6 — per-job enqueue policy tests.
//
// jobEnqueueOptions derives BullMQ job options from the event/job family
// catalogue (the single source of truth pinned by the 3.1 guard): attempts,
// exponential backoff WITH jitter (BullMQ BackoffOptions.jitter, verified
// against node_modules/bullmq v5 types), and an explicit per-job timeout.
// withCatalogueJobOptions wraps a queue so handler enqueue sites inherit the
// catalogue policy without each call site repeating it.

import { describe, it, expect, vi } from 'vitest'
import type { JobsOptions, Queue } from 'bullmq'
import {
  jobEnqueueOptions,
  jobTimeoutMs,
  withCatalogueJobOptions,
  isCatalogueKnownWork,
} from './job-policy'
import { JOB_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'

function parseBackoff(row: (typeof JOB_FAMILY_ROWS)[number]): {
  type: string
  delay: number
} {
  const [type, delay] = row.retryBackoff.split(':')
  return { type: type!, delay: Number(delay) }
}

describe('jobEnqueueOptions (BQC-3.6)', () => {
  it('returns catalogue-derived attempts/backoff+jitter for every job family', () => {
    for (const row of JOB_FAMILY_ROWS) {
      const opts = jobEnqueueOptions(row.jobName)
      const backoff = parseBackoff(row)

      expect(opts.attempts, row.jobName).toBe(row.retryAttempts)
      expect(opts.backoff, row.jobName).toEqual({
        type: backoff.type,
        delay: backoff.delay,
        jitter: expect.any(Number),
      })
      const jitter = (opts.backoff as { jitter: number }).jitter
      expect(jitter, row.jobName).toBeGreaterThan(0)
      expect(jitter, row.jobName).toBeLessThanOrEqual(1)
    }
  })

  it('jobTimeoutMs exposes the catalogue timeout (BullMQ v5 has no job timeout opt)', () => {
    for (const row of JOB_FAMILY_ROWS) {
      expect(jobTimeoutMs(row.jobName), row.jobName).toBe(row.timeoutMs)
    }
    // Unknown names fall back to the 120s default instead of throwing —
    // the gate only resolves timeouts for registered (catalogued) jobs.
    expect(jobTimeoutMs('not-a-job')).toBe(120_000)
  })

  it('pins the honest per-job timeouts agreed in the slice', () => {
    expect(jobTimeoutMs('health-check')).toBe(30_000)
    expect(jobTimeoutMs('sync-property-reviews')).toBe(300_000)
    expect(jobTimeoutMs('publish-reply')).toBe(120_000)
    expect(jobTimeoutMs('import-property')).toBe(600_000)
    expect(jobTimeoutMs('refresh-expiring-reviews')).toBe(300_000)
    expect(jobTimeoutMs('purge-expired-reviews')).toBe(300_000)
    expect(jobTimeoutMs('retention-sweep')).toBe(900_000)
  })

  it('keeps the publish-reply fast backoff (exponential:5000)', () => {
    expect(jobEnqueueOptions('publish-reply').backoff).toMatchObject({
      type: 'exponential',
      delay: 5000,
    })
  })

  it('throws on an unknown job name (config failure, not silent default)', () => {
    expect(() => jobEnqueueOptions('not-a-job')).toThrow(/not-a-job/)
  })
})

describe('isCatalogueKnownWork (BQC-3.6)', () => {
  it('knows job names and event types, rejects anything else', () => {
    expect(isCatalogueKnownWork('health-check')).toBe(true)
    expect(isCatalogueKnownWork('review.created')).toBe(true)
    expect(isCatalogueKnownWork('mystery-job')).toBe(false)
  })
})

describe('withCatalogueJobOptions (BQC-3.6)', () => {
  function fakeQueue() {
    return {
      add: vi.fn(async (name: string, data: unknown, opts?: JobsOptions) => ({
        id: 'j1',
        name,
        data,
        opts,
      })),
    } as unknown as Queue
  }

  it('merges catalogue policy into add() calls that carry no opts', async () => {
    const queue = fakeQueue()
    const wrapped = withCatalogueJobOptions(queue)

    await wrapped.add('insert-activity-log', { resourceId: 'r1' })

    expect(queue.add).toHaveBeenCalledWith(
      'insert-activity-log',
      { resourceId: 'r1' },
      expect.objectContaining({
        attempts: 3,
        backoff: expect.objectContaining({ type: 'exponential', delay: 30_000 }),
      }),
    )
  })

  it('explicit call-site opts win over catalogue defaults', async () => {
    const queue = fakeQueue()
    const wrapped = withCatalogueJobOptions(queue)

    await wrapped.add('insert-notification', { n: 1 }, { jobId: 'dedupe-1' })

    const opts = (queue.add as ReturnType<typeof vi.fn>).mock.calls[0]![2] as JobsOptions
    expect(opts.jobId).toBe('dedupe-1')
    expect(opts.attempts).toBe(3)
  })

  it('does not mutate the original queue', async () => {
    const queue = fakeQueue()
    withCatalogueJobOptions(queue)

    await queue.add('insert-activity-log', {})

    expect(queue.add).toHaveBeenCalledWith('insert-activity-log', {})
  })
})
