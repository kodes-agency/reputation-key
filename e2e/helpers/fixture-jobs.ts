// What a spec may conclude from a queue after it enqueued a job.
//
// These are the reads behind `waitForFixtureJobSettled` and
// `waitForFixtureJobsFinished` in fixtures.ts. They take the queue as an
// argument so they run without a queue Redis in fixture-jobs.test.ts;
// fixtures.ts binds them to the real one.
//
// Timestamps are BullMQ's `processedOn` and `finishedOn`. The worker stamps
// both from its own clock, so compare them with each other and never with the
// clock of the process that runs the spec.

import type { JobType } from 'bullmq'
import { isGateDeniedResult } from '../../src/shared/jobs/gate-denial'

/** The part of a BullMQ job these reads use. */
type FixtureJobView = Readonly<{
  id?: string
  name: string
  returnvalue: unknown
  failedReason: string
  attemptsMade: number
  processedOn?: number
  finishedOn?: number
  getState(): Promise<string>
}>

/** The part of a BullMQ queue these reads use; a `Queue` satisfies it. */
export type FixtureJobQueue = Readonly<{
  getJob(jobId: string): Promise<FixtureJobView | undefined>
  getJobs(types: JobType[]): Promise<ReadonlyArray<FixtureJobView>>
}>

/**
 * How the worker left a job it will not touch again.
 *
 *   completed — the handler ran and returned.
 *   denied    — the delayed-execution gate refused the job. BullMQ records it
 *               as completed so it does not retry, but nothing ran; the return
 *               value says so (src/shared/jobs/gate-denial.ts).
 *   failed    — the handler threw and no attempt is left.
 */
export type FixtureJobOutcome = Readonly<{
  jobId: string
  outcome: 'completed' | 'denied' | 'failed'
  /** The gate's deny code, or BullMQ's failed reason. */
  reason?: string
  startedAt: number
  finishedAt: number
}>

/** A job the worker has not finished with, as a timed-out wait reports it. */
export type UnfinishedFixtureJob = Readonly<{
  jobId: string
  state: string
  attemptsMade: number
  failedReason?: string
}>

/**
 * Every state from which a job can still run. A queue that is paused keeps its
 * jobs in `waiting`, and a job that failed with attempts left waits out its
 * backoff in `delayed`.
 */
const UNFINISHED_STATES: JobType[] = [
  'waiting',
  'delayed',
  'prioritized',
  'active',
  'waiting-children',
]

const FINISHED_STATES: JobType[] = ['completed', 'failed']

function finishedOutcome(
  job: FixtureJobView,
  state: string,
): Pick<FixtureJobOutcome, 'outcome' | 'reason'> | null {
  if (state === 'failed') return { outcome: 'failed', reason: job.failedReason }
  if (state !== 'completed') return null
  return isGateDeniedResult(job.returnvalue)
    ? { outcome: 'denied', reason: job.returnvalue.reason }
    : { outcome: 'completed' }
}

async function outcomeOf(job: FixtureJobView): Promise<FixtureJobOutcome | null> {
  if (!job.id || !job.finishedOn) return null
  const finished = finishedOutcome(job, await job.getState())
  if (!finished) return null
  return {
    jobId: job.id,
    ...finished,
    startedAt: job.processedOn ?? job.finishedOn,
    finishedAt: job.finishedOn,
  }
}

/**
 * How the worker settled one job; null while it may still run. BullMQ stamps
 * `finishedOn` only on completion or on a failure with no attempts left, so a
 * job waiting out a retry backoff is not settled yet.
 */
export async function settledFixtureJobOutcome(
  queue: FixtureJobQueue,
  jobId: string,
): Promise<FixtureJobOutcome | null> {
  const job = await queue.getJob(jobId)
  return job ? outcomeOf(job) : null
}

/**
 * The jobs of one name that can still run: queued, backing off before a retry,
 * or running now. By name and not by id, because a job that hands the rest of
 * its work to a continuation adds it under an id the spec never sees.
 *
 * BullMQ reads the states in one script, so the list is the queue at one
 * instant. A handler that enqueues its continuation before it returns
 * therefore never shows an empty list between two of its jobs.
 */
export async function unfinishedFixtureJobs(
  queue: FixtureJobQueue,
  jobName: string,
): Promise<ReadonlyArray<UnfinishedFixtureJob>> {
  const jobs = await queue.getJobs(UNFINISHED_STATES)
  return Promise.all(
    jobs
      .filter((job) => job.name === jobName)
      .map(async (job) => ({
        jobId: job.id ?? 'unknown',
        state: await job.getState(),
        attemptsMade: job.attemptsMade,
        ...(job.failedReason ? { failedReason: job.failedReason } : {}),
      })),
  )
}

/**
 * How each job of one name that finished at or after `since` ended, oldest
 * first. `since` is a worker timestamp: a `startedAt` from an earlier outcome.
 *
 * The queue keeps a bounded number of finished jobs (the app's default is the
 * last 100 completed and 50 failed), so after a long run this is its tail. A
 * failure or a gate refusal ends a run, so it is in that tail.
 */
export async function fixtureJobOutcomesSince(
  queue: FixtureJobQueue,
  jobName: string,
  since: number,
): Promise<ReadonlyArray<FixtureJobOutcome>> {
  const jobs = await queue.getJobs(FINISHED_STATES)
  const outcomes = await Promise.all(
    jobs.filter((job) => job.name === jobName).map((job) => outcomeOf(job)),
  )
  return outcomes
    .filter((outcome) => outcome !== null)
    .filter((outcome) => outcome.finishedAt >= since)
    .sort((left, right) => left.finishedAt - right.finishedAt)
}
