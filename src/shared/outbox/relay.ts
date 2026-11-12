// Admit facts into PostgreSQL work before touching Redis. Lost queue jobs are
// recovered by the independent work reconciler; enqueueing spends no attempt.
// The poll admits new facts; the receipt sweep re-admits published facts that
// still miss an expected receipt and never got delivery work.
import type { Queue } from 'bullmq'
import type {
  DurableConsumerExpectation,
  OutboxRepository,
} from './infrastructure/outbox-repository'
import type {
  AwaitingReceiptsCursor,
  DeliveryWork,
} from './infrastructure/delivery.server'
import { deliveryWorkJobOptions } from './dispatch-job-options'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OutboxRelay = Readonly<{
  poll: () => Promise<void>
  start: (intervalMs: number) => () => Promise<void>
  /** One pass over the whole published backlog; resolves with the work admitted. */
  sweep: () => Promise<readonly DeliveryWork[]>
  /** Sweeps now, then every interval, one pass at a time. */
  startSweep: (intervalMs: number) => () => Promise<void>
}>

export type RelayConfig = Readonly<{
  batchSize: number
  sweepPageSize: number
  consumerExpectations?: readonly DurableConsumerExpectation[]
}>

export function createOutboxRelay(
  repo: OutboxRepository,
  queue: Pick<Queue, 'add'> | undefined,
  config: Partial<RelayConfig> = {},
): OutboxRelay {
  const cfg = { batchSize: 50, sweepPageSize: 1_000, ...config }
  const logger = getLogger()
  const enqueue = async (work: readonly DeliveryWork[]) => {
    for (const item of work) {
      if (!queue) continue
      try {
        await queue.add(
          item.eventType,
          { workId: item.id },
          deliveryWorkJobOptions(item.id, item.eventType),
        )
      } catch {
        // Acceptance may be ambiguous. The ledger stays pending either way;
        // its lease and consumer receipts fence a later dispatch.
        logger.warn({ eventType: item.eventType }, 'Outbox delivery awaits transport')
      }
    }
  }
  const claimAndPublish = (): Promise<number> =>
    trace('outbox.relay.poll', async () => {
      const work = await repo.delivery.schedulePending(cfg.batchSize)
      await enqueue(work)
      return work.length
    })
  // Every pass starts at the oldest published fact and reads to the end: a
  // cursor kept between passes would not survive a worker restart.
  const sweep = (isStopped: () => boolean = () => false): Promise<DeliveryWork[]> =>
    trace('outbox.relay.sweep', async () => {
      const admitted: DeliveryWork[] = []
      let after: AwaitingReceiptsCursor | null = null
      do {
        const page = await repo.delivery.scheduleAwaitingReceipts(
          after,
          cfg.sweepPageSize,
          cfg.consumerExpectations,
        )
        await enqueue(page.scheduled)
        admitted.push(...page.scheduled)
        after = page.next
      } while (after && !isStopped())
      if (admitted.length > 0)
        logger.info({ admitted: admitted.length }, 'Outbox receipt sweep admitted facts')
      return admitted
    })

  return {
    poll: async () => {
      await claimAndPublish()
    },
    start: (intervalMs: number) => {
      let polling: Promise<void> | undefined
      let stopped = false
      const timer = setInterval(() => {
        // One drain at a time: a tick that lands mid-drain leaves it to finish.
        if (polling) return
        polling = (async () => {
          // A full batch means more rows are waiting. Keep publishing until a
          // poll comes back short, instead of one batch per interval: an
          // import writes about four events per review, so one batch a second
          // would cap its burst at 50 events a second.
          let claimed = cfg.batchSize
          while (!stopped && claimed === cfg.batchSize) claimed = await claimAndPublish()
        })()
          .catch((err: unknown) => {
            logger.error({ err }, 'Outbox relay poll failed')
          })
          .finally(() => {
            polling = undefined
          })
      }, intervalMs)

      logger.info({ intervalMs }, 'Outbox relay started')

      return () => {
        stopped = true
        clearInterval(timer)
        logger.info('Outbox relay stopped')
        return polling ?? Promise.resolve()
      }
    },
    sweep: () => sweep(),
    startSweep: (intervalMs: number) => {
      let sweeping: Promise<void> | undefined
      let stopped = false
      const run = () => {
        if (sweeping) return
        sweeping = sweep(() => stopped)
          .then(() => undefined)
          .catch((err: unknown) => {
            logger.error({ err }, 'Outbox receipt sweep failed')
          })
          .finally(() => {
            sweeping = undefined
          })
      }
      run()
      const timer = setInterval(run, intervalMs)
      logger.info({ intervalMs }, 'Outbox receipt sweep started')
      return () => {
        stopped = true
        clearInterval(timer)
        return sweeping ?? Promise.resolve()
      }
    },
  }
}
