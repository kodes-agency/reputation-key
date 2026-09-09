// Bounded recovery for outbox rows whose original BullMQ dispatch exhausted.
//
// Publication proves Redis accepted the original job, not that every durable
// consumer committed its receipt. A five-minute sweep therefore redelivers
// stale published events still missing any catalogue receipt through the same
// dispatcher. The dispatcher receipt gate skips consumers that already
// committed, while durable attempt and next-at fields bound permanent failure
// and prevent overlapping dispatch retry windows.

import type { Job, JobsOptions } from 'bullmq'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { EVENT_FAMILY_ROWS } from '#/shared/governance/event-job-catalogue'
import { trace } from '#/shared/observability/trace'
import { buildConsumerEvent } from '#/shared/outbox/envelope'
import type {
  DurableConsumerExpectation,
  OutboxRepository,
} from '#/shared/outbox/infrastructure/outbox-repository'
import { DISPATCH_JOB_OPTIONS } from '#/shared/outbox/relay'

export const JOB_NAME = 'published-event-redelivery' as const

type PublishedEventRedeliveryConfig = Readonly<{
  batchSize: number
  horizonMs: number
  maxAttempts: number
  backoffBaseMs: number
}>

const PUBLISHED_EVENT_REDELIVERY_CONFIG = Object.freeze({
  batchSize: 50,
  // Eight exponential dispatcher attempts can span at most about 95 minutes
  // with the configured jitter. Two hours cannot race that original budget.
  horizonMs: 2 * 60 * 60 * 1_000,
  maxAttempts: 3,
  backoffBaseMs: 2 * 60 * 60 * 1_000,
}) satisfies PublishedEventRedeliveryConfig

const CATALOGUED_CONSUMERS: readonly DurableConsumerExpectation[] =
  EVENT_FAMILY_ROWS.flatMap(({ eventType, consumers }) =>
    consumers.map(({ name }) => ({ eventType, consumerName: name })),
  )

export type PublishedEventRedeliveryQueue = Readonly<{
  add: (name: string, data: unknown, options: JobsOptions) => Promise<unknown>
}>

type PublishedEventRedeliveryDependencies = Readonly<{
  repo: OutboxRepository
  queue: PublishedEventRedeliveryQueue
  clock: Clock
  logger: Pick<LoggerPort, 'info' | 'warn'>
  consumerExpectations?: readonly DurableConsumerExpectation[]
  config?: Partial<PublishedEventRedeliveryConfig>
}>

function assertConfig(config: PublishedEventRedeliveryConfig): void {
  for (const [name, value] of Object.entries(config)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`published event redelivery ${name} must be a positive integer`)
    }
  }
}

export function createPublishedEventRedeliveryHandler(
  dependencies: PublishedEventRedeliveryDependencies,
): (job: Job) => Promise<void> {
  const config = { ...PUBLISHED_EVENT_REDELIVERY_CONFIG, ...dependencies.config }
  assertConfig(config)
  const consumerExpectations = dependencies.consumerExpectations ?? CATALOGUED_CONSUMERS

  return async (_job: Job): Promise<void> =>
    trace(`job.${JOB_NAME}`, async () => {
      const now = dependencies.clock()
      const cutoff = new Date(now.getTime() - config.horizonMs)
      const exhaustedBeforeRun =
        await dependencies.repo.countExhaustedConsumerRedeliveries({
          consumerExpectations,
          cutoff,
          maxAttempts: config.maxAttempts,
        })
      const candidates = await dependencies.repo.claimPublishedForConsumerRedelivery({
        consumerExpectations,
        cutoff,
        now,
        limit: config.batchSize,
        maxAttempts: config.maxAttempts,
        backoffBaseMs: config.backoffBaseMs,
      })

      let enqueued = 0
      let enqueueFailures = 0
      for (const candidate of candidates) {
        try {
          await dependencies.queue.add(
            candidate.eventType,
            buildConsumerEvent(candidate),
            {
              jobId: `${candidate.id}-redelivery-${candidate.redeliveryAttempt}`,
              ...DISPATCH_JOB_OPTIONS,
              removeOnComplete: { count: 1000 },
              removeOnFail: { count: 500 },
            },
          )
          enqueued += 1
        } catch {
          // The durable next-at fence owns another bounded enqueue attempt.
          // Do not include Redis errors here: some clients include job ids.
          enqueueFailures += 1
        }
      }

      const fields = {
        job: JOB_NAME,
        candidatesClaimed: candidates.length,
        eventsEnqueued: enqueued,
        enqueueFailures,
        exhaustedBeforeRun,
        batchFull: candidates.length === config.batchSize,
      }
      if (enqueueFailures > 0 || exhaustedBeforeRun > 0 || fields.batchFull) {
        dependencies.logger.warn(
          fields,
          'Published event redelivery sweep needs attention',
        )
        return
      }
      dependencies.logger.info(fields, 'Published event redelivery sweep completed')
    })
}
