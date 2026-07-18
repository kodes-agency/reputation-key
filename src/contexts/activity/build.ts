import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { ActivityPublicApi } from './application/public-api'
import type { Queue } from 'bullmq'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { createActivityRepository } from './infrastructure/activity-repository.drizzle'
import { registerActivityHandlers } from './infrastructure/event-handlers'
import { withCatalogueJobOptions } from '#/shared/jobs/job-policy'
import { getActivityTimeline } from './queries/get-activity-timeline'
import { getOrgActivity } from './queries/get-org-activity'
import { createDbInboxItemLookupAdapter } from './infrastructure/adapters/db-inbox-item-lookup.adapter'

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  outboxRepo?: import('#/shared/outbox').OutboxRepository
  staffPublicApi: StaffPublicApi
  queue: Queue | undefined
  clock: () => Date
  logger: LoggerPort
}>

export const buildActivityContext = (input: BuildInput) => {
  const repo = createActivityRepository(input.db)
  const inboxItemLookup = createDbInboxItemLookupAdapter(input.db)

  const timeline = getActivityTimeline({
    repo,
    staffPublicApi: input.staffPublicApi,
  })
  const orgActivity = getOrgActivity({
    repo,
    staffPublicApi: input.staffPublicApi,
  })

  // Register per-tag handlers that enqueue BullMQ jobs.
  // BQC-3.6: the queue is wrapped so every insert-activity-log enqueue
  // inherits the catalogue retry policy (attempts/backoff+jitter/timeout).
  if (input.queue) {
    registerActivityHandlers({
      events: input.events,
      queue: withCatalogueJobOptions(input.queue),
      inboxItemLookup,
    })
  }

  const publicApi: ActivityPublicApi = {
    getActivityTimeline: timeline,
    getOrgActivity: orgActivity,
  }

  // ACT-005: insertActivityLog is NOT constructed here — bootstrap.ts owns the
  // worker-side instantiation (it has the BullMQ job handler). This build
  // function is for the web process (query + handler registration only).
  return {
    publicApi,
    internal: {
      repos: { activityRepo: repo },
    },
  } as const
}
