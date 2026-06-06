import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { ActivityPublicApi } from './application/public-api'
import type { Queue } from 'bullmq'
import { createActivityRepository } from './infrastructure/activity-repository.drizzle'
import { registerActivityHandlers } from './infrastructure/event-handlers'
import { getActivityTimeline } from './queries/get-activity-timeline'
import { getOrgActivity } from './queries/get-org-activity'
import { createDbInboxItemLookupAdapter } from './infrastructure/adapters/db-inbox-item-lookup.adapter'

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  staffPublicApi: StaffPublicApi
  queue: Queue | undefined
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

  // Register per-tag handlers that enqueue BullMQ jobs
  if (input.queue) {
    registerActivityHandlers({
      events: input.events,
      queue: input.queue,
      inboxItemLookup,
    })
  }

  const publicApi: ActivityPublicApi = {
    getActivityTimeline: timeline,
    getOrgActivity: orgActivity,
  }

  return {
    publicApi,
    internal: {
      repos: { activityRepo: repo },
    },
  } as const
}
