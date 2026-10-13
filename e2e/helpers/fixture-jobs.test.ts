// What a spec may conclude from a queue after it enqueued a job. Two answers
// used to be missing, and review-expiry.spec.ts passed without either:
//
//   - "settled" said nothing about HOW. BullMQ stamps `finishedOn` on a job
//     that failed for good, and completes a job the delayed-execution gate
//     refused without running it. Neither is "the job ran".
//   - one settled job said nothing about the work it handed on. The Review
//     purge reads one page and enqueues the next page as a new job before it
//     returns, so the first job finishing is not the purge finishing.

import { describe, expect, it } from 'vitest'
import type { GateDeniedResult } from '../../src/shared/jobs/gate-denial'
import {
  fixtureJobOutcomesSince,
  settledFixtureJobOutcome,
  unfinishedFixtureJobs,
  type FixtureJobQueue,
} from './fixture-jobs'

type FakeState =
  | 'waiting'
  | 'delayed'
  | 'prioritized'
  | 'active'
  | 'waiting-children'
  | 'completed'
  | 'failed'
  // What BullMQ answers for a job that is in none of its sets any more.
  | 'unknown'

type FakeJob = {
  id: string
  name: string
  state: FakeState
  returnvalue?: unknown
  failedReason?: string
  attemptsMade?: number
  processedOn?: number
  finishedOn?: number
}

const PURGE = 'purge-expired-reviews'

/** A queue that answers from a list the test can change between reads. */
function fakeQueue(jobs: FakeJob[]): FixtureJobQueue {
  const view = (job: FakeJob) => ({
    id: job.id,
    name: job.name,
    returnvalue: job.returnvalue ?? null,
    failedReason: job.failedReason ?? '',
    attemptsMade: job.attemptsMade ?? 0,
    processedOn: job.processedOn,
    finishedOn: job.finishedOn,
    getState: async () => job.state,
  })
  return {
    getJob: async (jobId) => {
      const job = jobs.find((candidate) => candidate.id === jobId)
      return job ? view(job) : undefined
    },
    getJobs: async (types) => {
      const states: ReadonlyArray<string> = types
      return jobs.filter((job) => states.includes(job.state)).map((job) => view(job))
    },
  }
}

const refusedByTheGate: GateDeniedResult = {
  gate: 'denied',
  reason: 'capability_mismatch',
  executionKind: 'worker',
}

describe('settledFixtureJobOutcome', () => {
  it('is null until the worker has settled the job', async () => {
    const queue = fakeQueue([
      { id: '1', name: PURGE, state: 'waiting' },
      { id: '2', name: PURGE, state: 'active', processedOn: 10 },
      // Failed once and waiting out its backoff: not settled, it runs again.
      {
        id: '3',
        name: PURGE,
        state: 'delayed',
        processedOn: 10,
        failedReason: 'connection reset',
        attemptsMade: 1,
      },
    ])

    expect(await settledFixtureJobOutcome(queue, '1')).toBeNull()
    expect(await settledFixtureJobOutcome(queue, '2')).toBeNull()
    expect(await settledFixtureJobOutcome(queue, '3')).toBeNull()
    expect(await settledFixtureJobOutcome(queue, 'no-such-job')).toBeNull()
  })

  it('is null when a finished stamp is all that says the job ended', async () => {
    // The queue trimmed the job between the read of the job and the read of
    // its state: there is a stamp, and no state left to say how it ended.
    const queue = fakeQueue([
      { id: '1', name: PURGE, state: 'unknown', processedOn: 10, finishedOn: 12 },
    ])

    expect(await settledFixtureJobOutcome(queue, '1')).toBeNull()
  })

  it('says completed when the handler ran and returned', async () => {
    const queue = fakeQueue([
      { id: '1', name: PURGE, state: 'completed', processedOn: 10, finishedOn: 25 },
    ])

    expect(await settledFixtureJobOutcome(queue, '1')).toEqual({
      jobId: '1',
      outcome: 'completed',
      startedAt: 10,
      finishedAt: 25,
    })
  })

  it('says denied, with the gate reason, for a job BullMQ completed without running it', async () => {
    const queue = fakeQueue([
      {
        id: '1',
        name: PURGE,
        state: 'completed',
        returnvalue: refusedByTheGate,
        processedOn: 10,
        finishedOn: 11,
      },
    ])

    expect(await settledFixtureJobOutcome(queue, '1')).toEqual({
      jobId: '1',
      outcome: 'denied',
      reason: 'capability_mismatch',
      startedAt: 10,
      finishedAt: 11,
    })
  })

  it('says failed, with the reason, for a job that threw with no attempts left', async () => {
    const queue = fakeQueue([
      {
        id: '1',
        name: PURGE,
        state: 'failed',
        failedReason: 'Invalid Review source-content lifecycle report mode',
        attemptsMade: 1,
        processedOn: 10,
        finishedOn: 12,
      },
    ])

    expect(await settledFixtureJobOutcome(queue, '1')).toEqual({
      jobId: '1',
      outcome: 'failed',
      reason: 'Invalid Review source-content lifecycle report mode',
      startedAt: 10,
      finishedAt: 12,
    })
  })
})

describe('unfinishedFixtureJobs', () => {
  it('lists every job of the name that is queued, backing off or running', async () => {
    const queue = fakeQueue([
      { id: 'w', name: PURGE, state: 'waiting' },
      { id: 'd', name: PURGE, state: 'delayed', attemptsMade: 1, failedReason: 'boom' },
      { id: 'p', name: PURGE, state: 'prioritized' },
      { id: 'a', name: PURGE, state: 'active', processedOn: 10 },
      { id: 'c', name: PURGE, state: 'waiting-children' },
    ])

    expect(await unfinishedFixtureJobs(queue, PURGE)).toEqual([
      { jobId: 'w', state: 'waiting', attemptsMade: 0 },
      { jobId: 'd', state: 'delayed', attemptsMade: 1, failedReason: 'boom' },
      { jobId: 'p', state: 'prioritized', attemptsMade: 0 },
      { jobId: 'a', state: 'active', attemptsMade: 0 },
      { jobId: 'c', state: 'waiting-children', attemptsMade: 0 },
    ])
  })

  it('ignores finished jobs and the other work on the queue', async () => {
    // The background queue always carries a delayed entry per recurring job,
    // so "nothing delayed on the queue" would never come true.
    const queue = fakeQueue([
      { id: 'done', name: PURGE, state: 'completed', processedOn: 1, finishedOn: 2 },
      { id: 'dead', name: PURGE, state: 'failed', processedOn: 1, finishedOn: 2 },
      { id: 'sweep', name: 'retention-sweep', state: 'delayed' },
      { id: 'discover', name: 'discover-new-reviews', state: 'active' },
    ])

    expect(await unfinishedFixtureJobs(queue, PURGE)).toEqual([])
  })

  it('still sees the next page after the job that enqueued it has settled', async () => {
    // The purge in miniature: each page adds its continuation under another
    // id before it returns. The spec holds only the first id.
    const jobs: FakeJob[] = [
      { id: '41', name: PURGE, state: 'completed', processedOn: 100, finishedOn: 110 },
      { id: 'review-lifecycle-v1-report-100-90-r100', name: PURGE, state: 'waiting' },
    ]
    const queue = fakeQueue(jobs)

    expect(await settledFixtureJobOutcome(queue, '41')).toMatchObject({
      outcome: 'completed',
    })
    expect(await unfinishedFixtureJobs(queue, PURGE)).toEqual([
      {
        jobId: 'review-lifecycle-v1-report-100-90-r100',
        state: 'waiting',
        attemptsMade: 0,
      },
    ])

    // The worker takes the continuation and finishes the window.
    jobs.splice(1, 1, {
      id: 'review-lifecycle-v1-report-100-90-r100',
      name: PURGE,
      state: 'completed',
      processedOn: 115,
      finishedOn: 120,
    })

    expect(await unfinishedFixtureJobs(queue, PURGE)).toEqual([])
  })
})

describe('fixtureJobOutcomesSince', () => {
  it('says how each job of the name that finished since then ended, oldest first', async () => {
    const queue = fakeQueue([
      {
        id: 'page-3',
        name: PURGE,
        state: 'failed',
        failedReason: 'update or delete on table "reviews" violates foreign key',
        attemptsMade: 3,
        processedOn: 130,
        finishedOn: 140,
      },
      {
        id: 'page-1',
        name: PURGE,
        state: 'completed',
        processedOn: 100,
        finishedOn: 110,
      },
      {
        id: 'page-2',
        name: PURGE,
        state: 'completed',
        processedOn: 115,
        finishedOn: 120,
      },
    ])

    expect(await fixtureJobOutcomesSince(queue, PURGE, 100)).toEqual([
      { jobId: 'page-1', outcome: 'completed', startedAt: 100, finishedAt: 110 },
      { jobId: 'page-2', outcome: 'completed', startedAt: 115, finishedAt: 120 },
      {
        jobId: 'page-3',
        outcome: 'failed',
        reason: 'update or delete on table "reviews" violates foreign key',
        startedAt: 130,
        finishedAt: 140,
      },
    ])
  })

  it('leaves out what finished earlier, other jobs, and jobs that are not finished', async () => {
    const queue = fakeQueue([
      // A failure kept from an earlier run of the same spec.
      {
        id: 'old',
        name: PURGE,
        state: 'failed',
        failedReason: 'earlier run',
        processedOn: 40,
        finishedOn: 50,
      },
      {
        id: 'other',
        name: 'retention-sweep',
        state: 'failed',
        processedOn: 100,
        finishedOn: 105,
      },
      { id: 'running', name: PURGE, state: 'active', processedOn: 100 },
      {
        id: 'refused',
        name: PURGE,
        state: 'completed',
        returnvalue: refusedByTheGate,
        processedOn: 100,
        finishedOn: 101,
      },
    ])

    expect(await fixtureJobOutcomesSince(queue, PURGE, 100)).toEqual([
      {
        jobId: 'refused',
        outcome: 'denied',
        reason: 'capability_mismatch',
        startedAt: 100,
        finishedAt: 101,
      },
    ])
  })
})
