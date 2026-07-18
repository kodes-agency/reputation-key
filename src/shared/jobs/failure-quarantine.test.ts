// BQC-3.6 — failure quarantine + redrive tests.
//
// Max-attempt jobs move to a dedicated 'quarantine' BullMQ queue (no worker
// ever processes it — it IS the dead letter) with a content-safe envelope:
// catalogue-known payloads pass through (identifier-only by construction),
// unknown-job payloads are redacted, failedReason is error name + first
// message line (no stack, no protected content). Redrive moves a quarantined
// job back to its original queue with a fresh attempt budget and
// redriveMetadata in the payload.

import { describe, it, expect, vi } from 'vitest'
import type { Job, JobsOptions, Queue } from 'bullmq'
import {
  quarantineExhaustedJob,
  quarantineJobDirect,
  createRedriveJob,
  listQuarantinedJobs,
  QUARANTINE_QUEUE_NAME,
  type QuarantineEnvelope,
} from './failure-quarantine'
import { GateDenyRetryError } from './errors'
import { jobEnqueueOptions } from './job-policy'

// ── Fakes ───────────────────────────────────────────────────────────

type FakeStoredJob = {
  id: string
  name: string
  data: unknown
  opts?: JobsOptions
  removed: boolean
  remove: () => Promise<void>
}

function fakeQueue() {
  const added: Array<{ name: string; data: unknown; opts?: JobsOptions }> = []
  const jobs = new Map<string, FakeStoredJob>()
  const queue = {
    added,
    jobs,
    add: vi.fn(async (name: string, data: unknown, opts?: JobsOptions) => {
      const stored: FakeStoredJob = {
        id: (opts?.jobId as string | undefined) ?? `job-${jobs.size + 1}`,
        name,
        data,
        opts,
        removed: false,
        remove: async () => {
          stored.removed = true
          jobs.delete(stored.id)
        },
      }
      added.push({ name, data, opts })
      jobs.set(stored.id, stored)
      return stored
    }),
    getJob: vi.fn(async (id: string) => jobs.get(id)),
    getJobs: vi.fn(async () => [...jobs.values()]),
  }
  return queue as unknown as Queue & {
    added: typeof added
    jobs: typeof jobs
  }
}

function fakeJob(over: Record<string, unknown> = {}): Job {
  return {
    id: 'orig-1',
    name: 'sync-property-reviews',
    queueName: 'default',
    data: { propertyId: 'prop-1', organizationId: 'org-1' },
    attemptsMade: 3,
    opts: { attempts: 3 },
    ...over,
  } as unknown as Job
}

function envelopeOf(entry: { data: unknown }): QuarantineEnvelope {
  return entry.data as QuarantineEnvelope
}

// ── quarantineExhaustedJob ──────────────────────────────────────────

describe('quarantineExhaustedJob (BQC-3.6)', () => {
  it('does nothing when attempts are not exhausted', async () => {
    const quarantine = fakeQueue()
    const result = await quarantineExhaustedJob(
      quarantine,
      fakeJob({ attemptsMade: 1 }),
      new Error('transient'),
    )

    expect(result.quarantined).toBe(false)
    expect(quarantine.add).not.toHaveBeenCalled()
  })

  it('uses the queue-factory default (3) when the job carries no attempts opt', async () => {
    const quarantine = fakeQueue()
    const result = await quarantineExhaustedJob(
      quarantine,
      fakeJob({ attemptsMade: 2, opts: {} }),
      new Error('transient'),
    )
    expect(result.quarantined).toBe(false)

    const exhausted = await quarantineExhaustedJob(
      quarantine,
      fakeJob({ attemptsMade: 3, opts: {} }),
      new Error('transient'),
    )
    expect(exhausted.quarantined).toBe(true)
  })

  it('quarantines an exhausted catalogue-known job with a full content-safe envelope', async () => {
    const quarantine = fakeQueue()
    const before = Date.now()
    const result = await quarantineExhaustedJob(
      quarantine,
      fakeJob(),
      new Error('provider timeout'),
    )

    expect(result.quarantined).toBe(true)
    expect(quarantine.add).toHaveBeenCalledTimes(1)
    const call = quarantine.added[0]!
    // Job is named by the ORIGINAL job name.
    expect(call.name).toBe('sync-property-reviews')

    const env = envelopeOf(call)
    expect(env.originalQueue).toBe('default')
    expect(env.originalJobId).toBe('orig-1')
    expect(env.jobName).toBe('sync-property-reviews')
    // Catalogue-known payloads are identifier-only by construction — pass through.
    expect(env.data).toEqual({ propertyId: 'prop-1', organizationId: 'org-1' })
    expect(env.failedReason).toBe('Error: provider timeout')
    expect(env.attemptsMade).toBe(3)
    expect(Date.parse(env.quarantinedAt)).toBeGreaterThanOrEqual(before)
    expect(env.policyReason).toBeUndefined()
  })

  it('redacts the payload of unknown jobs (content-safety proof)', async () => {
    const quarantine = fakeQueue()
    const result = await quarantineExhaustedJob(
      quarantine,
      fakeJob({ name: 'mystery-job', data: { secret: 'dox' } }),
      new Error('boom'),
    )

    expect(result.quarantined).toBe(true)
    const env = envelopeOf(quarantine.added[0]!)
    expect(env.jobName).toBe('mystery-job')
    expect(env.data).toEqual({ redacted: true })
    expect(JSON.stringify(env)).not.toContain('dox')
  })

  it('strips stack and newlines from failedReason and caps it at 200 chars', async () => {
    const quarantine = fakeQueue()
    const err = new Error(`first line\nsecond line with PII ${'x'.repeat(300)}`)
    err.name = 'WeirdError'
    await quarantineExhaustedJob(quarantine, fakeJob(), err)

    const env = envelopeOf(quarantine.added[0]!)
    expect(env.failedReason.startsWith('WeirdError: first line')).toBe(true)
    expect(env.failedReason).not.toContain('second line')
    expect(env.failedReason).not.toContain('at ')
    expect(env.failedReason.length).toBeLessThanOrEqual(200)
  })

  it('carries the gate deny reason as policyReason when the failure came from the gate', async () => {
    const quarantine = fakeQueue()
    await quarantineExhaustedJob(
      quarantine,
      fakeJob(),
      new GateDenyRetryError('sync-property-reviews', 'policy_unavailable'),
    )

    const env = envelopeOf(quarantine.added[0]!)
    expect(env.policyReason).toBe('policy_unavailable')
  })

  it('accepts dispatcher (domain-events) jobs — event envelopes are catalogue-known', async () => {
    const quarantine = fakeQueue()
    const envelope = {
      eventId: 'evt-1',
      eventType: 'review.created',
      eventVersion: 1,
      payload: { reviewId: 'rev-1' },
      organizationId: 'org-1',
      propertyId: 'prop-1',
      sourceContext: 'review',
      sourceAggregateId: 'rev-1',
    }
    const result = await quarantineExhaustedJob(
      quarantine,
      fakeJob({ name: 'review.created', queueName: 'domain-events', data: envelope }),
      new Error('consumer boom'),
    )

    expect(result.quarantined).toBe(true)
    const env = envelopeOf(quarantine.added[0]!)
    expect(env.originalQueue).toBe('domain-events')
    expect(env.data).toEqual(envelope)
  })
})

// ── quarantineJobDirect (BQC-4.2) ───────────────────────────────────

describe('quarantineJobDirect (BQC-4.2)', () => {
  it('quarantines immediately without an attempts check (dispatch-time gate rejections)', async () => {
    const quarantine = fakeQueue()
    const result = await quarantineJobDirect(
      quarantine,
      fakeJob({ attemptsMade: 0, opts: {} }),
      'routing_blocked:region_denied',
    )

    expect(result.quarantined).toBe(true)
    expect(quarantine.add).toHaveBeenCalledTimes(1)
    const call = quarantine.added[0]!
    expect(call.name).toBe('sync-property-reviews')
    expect(call.opts?.jobId).toBe(`${QUARANTINE_QUEUE_NAME}:default:orig-1`)

    const env = envelopeOf(call)
    expect(env.originalQueue).toBe('default')
    expect(env.originalJobId).toBe('orig-1')
    // Catalogue-known payloads are identifier-only by construction — pass through.
    expect(env.data).toEqual({ propertyId: 'prop-1', organizationId: 'org-1' })
    expect(env.policyReason).toBe('routing_blocked:region_denied')
    expect(env.failedReason).toContain('routing_blocked:region_denied')
    expect(env.failedReason.length).toBeLessThanOrEqual(200)
    expect(env.attemptsMade).toBe(0)
    expect(Number.isNaN(Date.parse(env.quarantinedAt))).toBe(false)
  })

  it('redacts the payload of unknown jobs (content-safety proof)', async () => {
    const quarantine = fakeQueue()
    const result = await quarantineJobDirect(
      quarantine,
      fakeJob({ name: 'mystery-job', data: { secret: 'dox' } }),
      'wrong_cell',
    )

    expect(result.quarantined).toBe(true)
    const env = envelopeOf(quarantine.added[0]!)
    expect(env.data).toEqual({ redacted: true })
    expect(env.policyReason).toBe('wrong_cell')
    expect(JSON.stringify(env)).not.toContain('dox')
  })
})

// ── createRedriveJob ────────────────────────────────────────────────

describe('createRedriveJob (BQC-3.6)', () => {
  async function seedQuarantinedJob(over: Record<string, unknown> = {}) {
    const quarantine = fakeQueue()
    await quarantineExhaustedJob(quarantine, fakeJob(over), new Error('boom'))
    return { quarantine, id: quarantine.added[0]!.opts?.jobId as string }
  }

  it('moves a quarantined job back with redrive metadata and a fresh attempt budget', async () => {
    const { quarantine, id } = await seedQuarantinedJob()
    const target = fakeQueue()
    const redrive = createRedriveJob(quarantine, (name) =>
      name === 'default' ? target : undefined,
    )

    const result = await redrive(id)

    expect(result.redriven).toBe(true)
    expect(target.add).toHaveBeenCalledTimes(1)
    const call = target.added[0]!
    expect(call.name).toBe('sync-property-reviews')
    const data = call.data as Record<string, unknown>
    expect(data.propertyId).toBe('prop-1')
    const meta = data.redriveMetadata as Record<string, unknown>
    expect(meta.redrivenFrom).toBe(QUARANTINE_QUEUE_NAME)
    expect(meta.originalQuarantineId).toBe(id)
    expect(typeof meta.redrivenAt).toBe('string')
    // Fresh attempt budget from the catalogue policy.
    expect(call.opts?.attempts).toBe(jobEnqueueOptions('sync-property-reviews').attempts)
    // The quarantine entry is gone (moved, not copied).
    expect(quarantine.jobs.size).toBe(0)
  })

  it('refuses to redrive a redacted envelope (payload is unrecoverable)', async () => {
    const { quarantine, id } = await seedQuarantinedJob({ name: 'mystery-job' })
    const target = fakeQueue()
    const redrive = createRedriveJob(quarantine, () => target)

    const result = await redrive(id)

    expect(result).toEqual({ redriven: false, reason: 'payload-redacted' })
    expect(target.add).not.toHaveBeenCalled()
    // The quarantine entry stays for operator inspection.
    expect(quarantine.jobs.size).toBe(1)
  })

  it('reports not-found for an unknown quarantine job id', async () => {
    const quarantine = fakeQueue()
    const redrive = createRedriveJob(quarantine, () => fakeQueue())

    await expect(redrive('nope')).resolves.toEqual({
      redriven: false,
      reason: 'quarantine-job-not-found',
    })
  })

  it('reports when the original queue is unavailable', async () => {
    const { quarantine, id } = await seedQuarantinedJob()
    const redrive = createRedriveJob(quarantine, () => undefined)

    await expect(redrive(id)).resolves.toEqual({
      redriven: false,
      reason: 'target-queue-unavailable',
    })
    expect(quarantine.jobs.size).toBe(1)
  })
})

// ── listQuarantinedJobs ─────────────────────────────────────────────

describe('listQuarantinedJobs (BQC-3.6)', () => {
  it('lists quarantined envelopes with their quarantine job ids', async () => {
    const quarantine = fakeQueue()
    await quarantineExhaustedJob(quarantine, fakeJob({ id: 'a' }), new Error('one'))
    await quarantineExhaustedJob(
      quarantine,
      fakeJob({ id: 'b', name: 'unknown-x' }),
      new Error('two'),
    )

    const list = await listQuarantinedJobs(quarantine)

    expect(list).toHaveLength(2)
    expect(list[0]!.envelope.jobName).toBe('sync-property-reviews')
    expect(list[1]!.envelope.jobName).toBe('unknown-x')
    expect(list[1]!.envelope.data).toEqual({ redacted: true })
    expect(typeof list[0]!.quarantineJobId).toBe('string')
  })
})
