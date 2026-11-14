import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { EXECUTION_POLICY_VERSION } from '../../src/shared/auth/execution-policy'
import {
  fixtureJobOutcomesSince,
  settledFixtureJobOutcome,
  unfinishedFixtureJobs,
  type FixtureJobOutcome,
} from './fixture-jobs'
import { TEST_ENV } from './fixture-db'
import { waitFor } from './wait-for'

export async function drainFixtureQueue(name = 'default'): Promise<void> {
  const queue = fixtureQueue(name)
  await queue.drain(true)
  await queue.clean(0, 10_000, 'failed')
  await queue.clean(0, 10_000, 'delayed')
}

/**
 * Wait until the background queues have nothing left to do.
 *
 * An SLO measurement is arrival-to-projection latency, not "latency while an
 * unrelated spec's events are still draining". Two Google journeys in one run
 * left the worker chewing through the first one's domain events while the
 * second started its clock, so a 10-second budget expired on contention rather
 * than on the product. Starting from a quiescent worker measures what the SLO
 * is actually about.
 */
export async function waitForQueuesIdle(timeoutMs = 10_000): Promise<void> {
  // `background` is excluded and DELAYED is not counted: the recurring jobs
  // (reapers, sweeps, reconcilers) always have a delayed entry scheduled, so a
  // queue carrying them is never "empty" and waiting for that would hang.
  // Waiting and active on the two work queues is what "the worker is busy with
  // the previous spec" actually means.
  const names = ['default', 'domain-events'] as const
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const counts = await Promise.all(
      names.map(async (name) => {
        const queue = fixtureQueue(name)
        const [waiting, active] = await Promise.all([
          queue.getWaitingCount(),
          queue.getActiveCount(),
        ])
        return waiting + active
      }),
    )
    if (counts.every((count) => count === 0)) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error(`the background queues were not idle within ${timeoutMs} ms`)
}

// ── BullMQ enqueues (same queue names + default prefix as the app) ────

const _queues = new Map<string, Queue>()

/**
 * A BullMQ queue on the QUEUE Redis, which is a different server from the cache.
 *
 * compose runs two: `redis` holds cache and rate-limit state, `queue-redis`
 * holds BullMQ. Connecting to REDIS_URL put every fixture-enqueued job into a
 * queue no worker consumes -- `sync-property-reviews`, the review purge and the
 * publish-reply jobs all sat there while the specs waited out their budgets on
 * work that had never been picked up.
 */
function fixtureQueue(name: string): Queue {
  let queue = _queues.get(name)
  if (!queue) {
    const connection = new Redis(TEST_ENV.QUEUE_REDIS_URL, {
      maxRetriesPerRequest: null,
    })
    queue = new Queue(name, {
      connection: connection as unknown as import('bullmq').ConnectionOptions,
    })
    _queues.set(name, queue)
  }
  return queue
}

/** What review's on-property-created enqueues for the initial sync. */
export async function enqueueReviewSync(data: {
  propertyId: string
  organizationId: string
  connectionId: string
  locationName: string
}): Promise<void> {
  await fixtureQueue('default').add('sync-property-reviews', data, {
    removeOnComplete: { count: 100 },
    removeOnFail: { count: 50 },
  })
}

/**
 * Stop the worker taking new jobs from a queue. A job added meanwhile, by the
 * app or by a fixture, waits on the queue until `resumeFixtureQueue`. This is
 * how a spec holds real protected work still: the job is the one production
 * enqueued, with its payload, and nothing has started it.
 *
 * The pause is a flag in the queue Redis, so it outlives the test that set it:
 * always pair it with `resumeFixtureQueue` in an `afterEach`.
 */
export async function pauseFixtureQueue(name: string): Promise<void> {
  await fixtureQueue(name).pause()
}

/** Let the worker take jobs from a queue again. Safe when it is not paused. */
export async function resumeFixtureQueue(name: string): Promise<void> {
  await fixtureQueue(name).resume()
}

/**
 * The job of one name whose payload matches and that no worker has started
 * yet; null when there is none. Found by what it carries, not by its id, so a
 * spec does not repeat how production names its jobs.
 */
export async function findUnstartedFixtureJob(
  name: string,
  jobName: string,
  matches: (data: Record<string, unknown>) => boolean,
): Promise<{ jobId: string } | null> {
  const jobs = await fixtureQueue(name).getJobs(['waiting', 'delayed', 'prioritized'])
  const job = jobs.find(
    (candidate) =>
      candidate.name === jobName &&
      !candidate.processedOn &&
      matches(candidate.data as Record<string, unknown>),
  )
  return job?.id ? { jobId: job.id } : null
}

/**
 * Wait until the worker has settled a fixture job, and say how. BullMQ stamps
 * `finishedOn` only on completion or on a failure with no attempts left, so a
 * job waiting out a retry backoff is not settled yet.
 *
 * Settled is not "ran": a job that failed for good is settled, and so is one
 * the delayed-execution gate refused, which BullMQ completes without calling
 * the handler. A spec that needs the job to have run asserts the outcome is
 * `completed`.
 */
export async function waitForFixtureJobSettled(
  name: string,
  jobId: string,
  description: string,
): Promise<FixtureJobOutcome> {
  const queue = fixtureQueue(name)
  return waitFor(() => settledFixtureJobOutcome(queue, jobId), {
    description,
    diagnose: async () => {
      const job = await queue.getJob(jobId)
      if (!job) return { state: 'missing' }
      return {
        state: await job.getState(),
        attemptsMade: job.attemptsMade,
        failedReason: job.failedReason,
      }
    },
  })
}

/**
 * Wait until no job of one name is queued, backing off or running on a queue,
 * then say how each one that finished at or after `since` ended.
 *
 * For work that continues itself: a job that reads one page and enqueues the
 * next page under a new id before it returns. Waiting for the job a spec
 * enqueued covers the first page only. Once that job has settled, "none left
 * that can still run" is the end of the whole chain, because every page adds
 * its continuation while it is still running.
 *
 * `since` is the first job's `startedAt`, so the outcomes are this chain's and
 * not a failure kept from an earlier run.
 */
export async function waitForFixtureJobsFinished(
  name: string,
  jobName: string,
  options: { since: number; description: string },
): Promise<ReadonlyArray<FixtureJobOutcome>> {
  const queue = fixtureQueue(name)
  await waitFor(async () => (await unfinishedFixtureJobs(queue, jobName)).length === 0, {
    description: options.description,
    diagnose: () => unfinishedFixtureJobs(queue, jobName),
  })
  return fixtureJobOutcomesSince(queue, jobName, options.since)
}

const PURGE_EXPIRED_REVIEWS_JOB = 'purge-expired-reviews'

/**
 * The retention purge, invoked on demand through the real worker path with a
 * bare payload. Returns the job's id and name so the caller can wait for the
 * worker.
 *
 * That takes two waits, because this job is only the first page. It reads 100
 * reviews, oldest first, across every tenant, and hands the rest to a
 * continuation job under another id (the purge handler in
 * src/contexts/review/infrastructure/worker-runtime.ts). The e2e seed inserts
 * 100 reviews before any spec runs, so the first page is the seed's and a
 * review a spec has just created is read by a continuation.
 * `waitForFixtureJobSettled('background', jobId, …)` says how the first page
 * ended; `waitForFixtureJobsFinished('background', jobName, …)` waits for the
 * rest. An assertion that the purge removed nothing means nothing before both.
 */
export async function enqueuePurgeExpiredReviews(): Promise<{
  jobId: string
  jobName: string
}> {
  const job = await fixtureQueue('background').add(
    PURGE_EXPIRED_REVIEWS_JOB,
    {},
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  )
  if (!job.id) throw new Error('purge-expired-reviews was enqueued without a job id')
  return { jobId: job.id, jobName: PURGE_EXPIRED_REVIEWS_JOB }
}

/** The canonical Goal maintenance sweep, invoked through its production queue. */
export async function enqueueGoalProgramMaintenance(data: {
  organizationId: string
  propertyId: string
}): Promise<void> {
  await fixtureQueue('background').add(
    'goal-program.maintain',
    {
      organizationId: data.organizationId,
      propertyId: data.propertyId,
      capability: 'goal.use',
      policyVersionAtEnqueue: EXECUTION_POLICY_VERSION,
      initiator: { kind: 'system', id: 'e2e:goal-program.maintain' },
    },
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    },
  )
}
