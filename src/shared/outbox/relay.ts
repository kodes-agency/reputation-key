// Admit facts into PostgreSQL work before touching Redis. Lost queue jobs are
// recovered by the independent work reconciler; enqueueing spends no attempt.
import type { Queue } from 'bullmq'
import type {
  DurableConsumerExpectation,
  OutboxRepository,
} from './infrastructure/outbox-repository'
import { deliveryWorkJobOptions } from './dispatch-job-options'
import { getLogger } from '#/shared/observability/logger'
import { trace } from '#/shared/observability/trace'

export type OutboxRelay = Readonly<{
  poll: () => Promise<void>
  start: (intervalMs: number) => () => Promise<void>
}>

export type RelayConfig = Readonly<{
  batchSize: number
  consumerExpectations?: readonly DurableConsumerExpectation[]
}>

export function createOutboxRelay(
  repo: OutboxRepository,
  queue: Pick<Queue, 'add'> | undefined,
  config: Partial<RelayConfig> = {},
): OutboxRelay {
  const cfg = { batchSize: 50, ...config }
  const logger = getLogger()
  const claimAndPublish = (): Promise<number> =>
    trace('outbox.relay.poll', async () => {
      const work = await repo.delivery.schedulePending(
        cfg.batchSize,
        cfg.consumerExpectations,
      )
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
      return work.length
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
  }
}
