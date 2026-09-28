// Recovery for dispatch jobs a Queue Redis loss took with it.
//
// Queue Redis is disposable (ADR 0053): a restart without persistence, or a
// failover to an empty replica, drops every waiting, delayed and retrying
// domain-events job. Their outbox rows are already published, so the relay
// never claims them again, and the published-event redelivery sweep waits two
// hours before it looks — a new-review notice or an approval request in the
// queue at the moment of loss arrived hours late. This pass reads the recent
// published facts still owed a catalogued receipt (the window the sweep has not
// reached) and republishes exactly those whose job Redis no longer holds,
// under the fact's own id, so a job that is still there — queued, retrying,
// kept after failure — is never doubled. The dispatcher's receipt gate skips
// consumers that already committed.
//
// It runs when the worker boots and when the scheduler watchdog finds Queue
// Redis emptied — the two moments a loss is noticed.

import type { JobsOptions } from 'bullmq'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { buildConsumerEvent } from './envelope'
import { dispatchJobAddOptions } from './dispatch-job-options'
import type { DurableConsumerExpectation } from './infrastructure/outbox-repository'
import type {
  PublishedAwaitingReceiptsCursor,
  ReadPublishedAwaitingReceipts,
} from './infrastructure/published-awaiting-receipts'
import {
  CATALOGUED_CONSUMER_EXPECTATIONS,
  PUBLISHED_EVENT_REDELIVERY_HORIZON_MS,
} from './published-event-redelivery.job'

export type { PublishedAwaitingReceipt } from './infrastructure/published-awaiting-receipts'

export type LostDispatchQueue = Readonly<{
  add: (name: string, data: unknown, options: JobsOptions) => Promise<unknown>
  getJob: (id: string) => Promise<unknown>
}>

type LostDispatchRecoveryConfig = Readonly<{
  /** How far back to look: the redelivery sweep owns everything older. */
  windowMs: number
  pageSize: number
  /** A bound on one pass; the sweep still owns whatever it leaves. */
  maxEvents: number
}>

const LOST_DISPATCH_RECOVERY_CONFIG: LostDispatchRecoveryConfig = Object.freeze({
  windowMs: PUBLISHED_EVENT_REDELIVERY_HORIZON_MS,
  pageSize: 200,
  maxEvents: 20_000,
})

export type LostDispatchRecoveryResult = Readonly<{
  checked: number
  republished: number
  failures: number
}>

export async function republishLostDispatches(
  deps: Readonly<{
    readPublishedAwaitingReceipts: ReadPublishedAwaitingReceipts
    queue: LostDispatchQueue
    clock: Clock
    logger: Pick<LoggerPort, 'info' | 'warn'>
    consumerExpectations?: readonly DurableConsumerExpectation[]
    config?: Partial<LostDispatchRecoveryConfig>
  }>,
): Promise<LostDispatchRecoveryResult> {
  const config = { ...LOST_DISPATCH_RECOVERY_CONFIG, ...deps.config }
  const publishedAfter = new Date(deps.clock().getTime() - config.windowMs)
  let after: PublishedAwaitingReceiptsCursor | null = null
  let checked = 0
  let republished = 0
  let failures = 0

  while (checked < config.maxEvents) {
    const limit = Math.min(config.pageSize, config.maxEvents - checked)
    const page = await deps.readPublishedAwaitingReceipts({
      consumerExpectations: deps.consumerExpectations ?? CATALOGUED_CONSUMER_EXPECTATIONS,
      publishedAfter,
      after,
      limit,
    })
    for (const event of page) {
      checked += 1
      try {
        if (await deps.queue.getJob(event.id)) continue
        await deps.queue.add(
          event.eventType,
          buildConsumerEvent(event),
          dispatchJobAddOptions(event),
        )
        republished += 1
      } catch {
        // The redelivery sweep still owns it. Redis errors can name job ids.
        failures += 1
      }
    }
    const last = page.at(-1)
    if (page.length < limit || !last) break
    after = { publishedAt: last.publishedAt, id: last.id }
  }

  const fields = { checked, republished, failures, windowMs: config.windowMs }
  if (republished > 0 || failures > 0) {
    deps.logger.warn(fields, 'Dispatch jobs missing from Queue Redis were republished')
  } else {
    deps.logger.info(fields, 'Lost dispatch recovery found nothing missing')
  }
  return { checked, republished, failures }
}
