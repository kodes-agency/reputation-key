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
import { Job as BullmqJob } from 'bullmq'
import type { Job, JobProgress, JobsOptions, Queue } from 'bullmq'
import {
  confirmQuarantineFailure,
  quarantineExhaustedJob,
  quarantineFinalAttemptJob,
  createRedriveJob,
  findQuarantinedJob,
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
  progress: JobProgress
  state: string
  removed: boolean
  updateProgress: (progress: JobProgress) => Promise<void>
  getState: () => Promise<string>
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
        progress: 0,
        state: 'waiting',
        removed: false,
        updateProgress: async (progress) => {
          stored.progress = progress
        },
        getState: async () => stored.state,
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

/** A BullMQ Job Scheduler firing on its last attempt, as the worker receives it. */
function scheduleFiring(over: Record<string, unknown> = {}): Job {
  return fakeJob({
    id: 'repeat:schedule-property-ai-trends-recurring:1791090138172',
    name: 'schedule-property-ai-trends',
    queueName: 'background',
    repeatJobKey: 'schedule-property-ai-trends-recurring',
    data: {},
    attemptsMade: 2,
    opts: { attempts: 3 },
    ...over,
  })
}

/**
 * BullMQ's own add-time rule for a custom job id, run without Redis. The
 * fakes above accept any id, so only the library can say an id is storable.
 */
function assertBullmqAcceptsJobId(jobId: string): void {
  const queue = { opts: {}, keys: {}, toKey: () => '', name: QUARANTINE_QUEUE_NAME }
  const job = new BullmqJob(queue as never, 'probe', {}, { jobId }, jobId)
  const validator = job as unknown as { validateOptions(json: unknown): void }
  validator.validateOptions(job.asJSON())
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

  it('keeps a named Review snapshot failure content-free in failedReason', async () => {
    const quarantine = fakeQueue()
    const error = Object.assign(new Error('authorization_denied'), {
      name: 'ReviewProviderSnapshotFailure',
    })

    await quarantineExhaustedJob(quarantine, fakeJob(), error)

    const env = envelopeOf(quarantine.added[0]!)
    expect(env.failedReason).toBe('ReviewProviderSnapshotFailure: authorization_denied')
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

describe('terminal-failure publication barrier', () => {
  it('refuses a provisional ghost until the original failure is confirmed', async () => {
    const quarantine = fakeQueue()
    const target = fakeQueue()
    const original = fakeJob({ attemptsMade: 0, opts: { attempts: 8 } })
    const poison = Object.assign(new Error('schema poison'), {
      name: 'UnrecoverableError',
    })

    const staged = await quarantineFinalAttemptJob(quarantine, original, poison)
    expect(staged.quarantined).toBe(true)
    expect(envelopeOf(quarantine.added[0]!)).toMatchObject({
      publicationState: 'pending_failure',
      attemptsMade: 1,
    })

    const redrive = createRedriveJob(quarantine, () => target)
    await expect(redrive(staged.quarantineJobId!)).resolves.toEqual({
      redriven: false,
      reason: 'failure-not-confirmed',
    })
    expect(target.add).not.toHaveBeenCalled()

    await expect(confirmQuarantineFailure(quarantine, original)).resolves.toBe(true)
    await expect(redrive(staged.quarantineJobId!)).resolves.toMatchObject({
      redriven: true,
      targetQueue: 'default',
    })
    expect(target.add).toHaveBeenCalledTimes(1)
  })

  it('repairs a pending copy only when the original job is proven failed', async () => {
    const quarantine = fakeQueue()
    const target = fakeQueue()
    const original = fakeJob({ attemptsMade: 2, opts: { attempts: 3 } })
    const staged = await quarantineFinalAttemptJob(
      quarantine,
      original,
      new Error('terminal'),
    )
    await target.add(original.name, original.data, { jobId: original.id })
    target.jobs.get(original.id!)!.state = 'failed'

    const redrive = createRedriveJob(quarantine, () => target)
    await expect(redrive(staged.quarantineJobId!)).resolves.toMatchObject({
      redriven: true,
      targetQueue: 'default',
    })
    expect(target.add).toHaveBeenCalledTimes(2)
    expect(quarantine.jobs.size).toBe(0)
  })

  it('does not stage BullMQ non-failure control-flow errors', async () => {
    const quarantine = fakeQueue()
    const finalAttempt = fakeJob({ attemptsMade: 2, opts: { attempts: 3 } })
    for (const name of ['DelayedError', 'WaitingError', 'WaitingChildrenError']) {
      const control = Object.assign(new Error('control flow'), { name })
      await expect(
        quarantineFinalAttemptJob(quarantine, finalAttempt, control),
      ).resolves.toEqual({ quarantined: false })
    }
    await expect(
      quarantineFinalAttemptJob(
        quarantine,
        finalAttempt,
        Object.assign(new Error('bullmq:rateLimitExceeded'), { name: 'RateLimitError' }),
      ),
    ).resolves.toEqual({ quarantined: false })
    expect(quarantine.add).not.toHaveBeenCalled()
  })
})

// ── Schedule firings ────────────────────────────────────────────────

// A schedule is enumeration-only: its next firing repeats the whole pass, so
// a failed firing is neither lost work nor a unit an operator could redrive.
describe('schedule firings', () => {
  it('does not dead-letter a terminally failed schedule firing', async () => {
    const quarantine = fakeQueue()
    const failure = new Error('lock timeout')

    await expect(
      quarantineFinalAttemptJob(quarantine, scheduleFiring(), failure),
    ).resolves.toEqual({ quarantined: false, skipped: 'schedule_firing' })
    await expect(
      quarantineExhaustedJob(quarantine, scheduleFiring({ attemptsMade: 3 }), failure),
    ).resolves.toEqual({ quarantined: false, skipped: 'schedule_firing' })
    expect(quarantine.add).not.toHaveBeenCalled()
  })

  it('reports no skip while a schedule firing still has attempts left', async () => {
    const quarantine = fakeQueue()

    await expect(
      quarantineFinalAttemptJob(
        quarantine,
        scheduleFiring({ attemptsMade: 0 }),
        new Error('transient'),
      ),
    ).resolves.toEqual({ quarantined: false })
  })

  it('has no staged copy to confirm for a schedule firing', async () => {
    const quarantine = fakeQueue()

    await expect(
      confirmQuarantineFailure(quarantine, scheduleFiring({ attemptsMade: 3 })),
    ).resolves.toBe(false)
    expect(quarantine.getJob).not.toHaveBeenCalled()
  })

  it('still dead-letters on-demand work on the background queue', async () => {
    const quarantine = fakeQueue()

    await expect(
      quarantineFinalAttemptJob(
        quarantine,
        fakeJob({ queueName: 'background', attemptsMade: 2 }),
        new Error('terminal'),
      ),
    ).resolves.toEqual({
      quarantined: true,
      quarantineJobId: 'quarantine:background:orig-1',
    })
  })
})

// ── Dead-letter ids ─────────────────────────────────────────────────

// BullMQ refuses a custom id containing ':' unless it has exactly three
// segments, and a refused add is a dead letter that is never written.
describe('dead-letter id', () => {
  it('is refused by BullMQ in the shape a colon-carrying original id used to give', () => {
    expect(() => assertBullmqAcceptsJobId('quarantine:default:orig-1')).not.toThrow()
    expect(() => assertBullmqAcceptsJobId('quarantine:default:a:b:c')).toThrow(
      'Custom Id cannot contain :',
    )
  })

  it('stays storable for an original id that carries colons', async () => {
    const quarantine = fakeQueue()

    const outcome = await quarantineExhaustedJob(
      quarantine,
      fakeJob({ id: 'a:b:c' }),
      new Error('boom'),
    )

    expect(outcome.quarantineJobId).toBe('quarantine:default:a%3Ab%3Ac')
    expect(() => assertBullmqAcceptsJobId(outcome.quarantineJobId!)).not.toThrow()
    // The envelope keeps the real id: redrive proves the original by it.
    expect(envelopeOf(quarantine.added[0]!).originalJobId).toBe('a:b:c')
  })

  it('never gives two original ids the same dead-letter id', async () => {
    const quarantine = fakeQueue()

    const escaped = await quarantineExhaustedJob(
      quarantine,
      fakeJob({ id: 'a:b' }),
      new Error('boom'),
    )
    const literal = await quarantineExhaustedJob(
      quarantine,
      fakeJob({ id: 'a%3Ab' }),
      new Error('boom'),
    )

    expect(escaped.quarantineJobId).not.toBe(literal.quarantineJobId)
    expect(quarantine.jobs.size).toBe(2)
  })

  it('confirms and redrives a staged copy under the id it was staged with', async () => {
    const quarantine = fakeQueue()
    const target = fakeQueue()
    const original = fakeJob({ id: 'a:b:c', attemptsMade: 2 })

    const staged = await quarantineFinalAttemptJob(
      quarantine,
      original,
      new Error('terminal'),
    )
    await expect(confirmQuarantineFailure(quarantine, original)).resolves.toBe(true)

    expect(quarantine.getJob).toHaveBeenLastCalledWith(staged.quarantineJobId)
    const redrive = createRedriveJob(quarantine, () => target)
    await expect(redrive(staged.quarantineJobId!)).resolves.toMatchObject({
      redriven: true,
      targetQueue: 'default',
    })
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

  it('refuses generic redrive for fenced domain-owned import items', async () => {
    const { quarantine, id } = await seedQuarantinedJob({
      name: 'import-gbp-property-item-v2',
      data: {
        organizationId: 'org-1',
        itemId: '00000000-0000-4000-8000-000000000001',
        retryRevision: 0,
      },
      attemptsMade: 5,
      opts: { attempts: 5 },
    })
    const target = fakeQueue()
    const redrive = createRedriveJob(quarantine, () => target)

    await expect(redrive(id)).resolves.toEqual({
      redriven: false,
      reason: 'domain-redrive-required',
    })
    expect(target.add).not.toHaveBeenCalled()
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

// Redrive and discard name one entry. Looking it up in the bounded listing
// left whichever end the page did not cover unreachable: once the listing read
// oldest-first, a fresh dead letter behind 100 older ones could not be acted on.
describe('findQuarantinedJob', () => {
  it('finds the newest entry however many older ones precede it', async () => {
    const quarantine = fakeQueue()
    const ids: string[] = []
    for (let i = 0; i < 150; i++) {
      const result = await quarantineExhaustedJob(
        quarantine,
        fakeJob({ id: `orig-${i}` }),
        new Error('x'),
      )
      if (result.quarantineJobId !== undefined) ids.push(result.quarantineJobId)
    }
    expect(ids).toHaveLength(150)

    const entry = await findQuarantinedJob(quarantine, ids[149]!)

    expect(entry).toMatchObject({
      quarantineJobId: ids[149],
      envelope: { originalJobId: 'orig-149' },
      publicationState: 'confirmed_failed',
    })
  })

  it('finds nothing for an unknown id or an unreadable envelope', async () => {
    const quarantine = fakeQueue()
    await quarantine.add(
      'insert-notification',
      { not: 'an envelope' },
      {
        jobId: 'malformed',
      },
    )

    expect(await findQuarantinedJob(quarantine, 'missing')).toBeNull()
    expect(await findQuarantinedJob(quarantine, 'malformed')).toBeNull()
  })
})

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
    expect(list[0]!.publicationState).toBe('confirmed_failed')
    expect(list[0]!.envelope.jobName).toBe('sync-property-reviews')
    expect(list[1]!.envelope.jobName).toBe('unknown-x')
    expect(list[1]!.envelope.data).toEqual({ redacted: true })
    expect(typeof list[0]!.quarantineJobId).toBe('string')
  })

  it('lists the OLDEST dead letters first, so an aged entry stays reachable behind newer ones', async () => {
    const quarantine = fakeQueue()
    for (let i = 0; i < 150; i++) {
      await quarantineExhaustedJob(
        quarantine,
        fakeJob({ id: `orig-${i}` }),
        new Error('x'),
      )
    }
    // BullMQ LPUSHes the wait list: its default page is the NEWEST entries.
    const newestFirst = [...quarantine.jobs.values()].reverse()
    vi.mocked(quarantine.getJobs).mockImplementation((async (
      _types: unknown,
      start = 0,
      end = -1,
      asc = false,
    ) =>
      (asc ? [...newestFirst].reverse() : newestFirst).slice(
        start,
        end < 0 ? undefined : end + 1,
      )) as never)

    const list = await listQuarantinedJobs(quarantine)

    expect(list).toHaveLength(100)
    expect(list[0]!.envelope.originalJobId).toBe('orig-0')
    expect(list.map((entry) => entry.envelope.originalJobId)).not.toContain('orig-149')
  })

  it('reports a staged copy as pending until the failed transition is confirmed', async () => {
    const quarantine = fakeQueue()
    const original = fakeJob({ attemptsMade: 2, opts: { attempts: 3 } })
    await quarantineFinalAttemptJob(quarantine, original, new Error('terminal'))

    let [entry] = await listQuarantinedJobs(quarantine)
    expect(entry?.publicationState).toBe('pending_failure')

    await confirmQuarantineFailure(quarantine, original)
    ;[entry] = await listQuarantinedJobs(quarantine)
    expect(entry?.publicationState).toBe('confirmed_failed')
  })
})
