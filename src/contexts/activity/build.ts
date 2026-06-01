import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from './ports/user-lookup.port'
import type { ActivityPublicApi } from './application/public-api'
import { createActivityRepository } from './infrastructure/activity-repository.drizzle'
import { registerActivityHandlers } from './infrastructure/event-handlers'
import { getActivityTimeline } from './queries/get-activity-timeline'
import { getOrgActivity } from './queries/get-org-activity'

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  logger: LoggerPort
  userLookup?: UserLookupPort
}>

const defaultUserLookup: UserLookupPort = {
  lookup: async () => ({ name: 'System', avatarUrl: null, role: 'Staff' as const }),
}

export const buildActivityContext = (input: BuildInput) => {
  const repo = createActivityRepository(input.db)
  const userLookup = input.userLookup ?? defaultUserLookup

  // TODO: Wire staffPublicApi to getActivityTimeline for property-level
  // permission filtering (PM/Staff should only see their assigned properties).
  const timeline = getActivityTimeline({ repo })
  const orgActivity = getOrgActivity({ repo })

  registerActivityHandlers({
    events: input.events,
    repo,
    userLookup,
    clock: input.clock,
    logger: input.logger,
  })

  const publicApi: ActivityPublicApi = {
    getActivityTimeline: timeline,
    getOrgActivity: orgActivity,
  }

  return { publicApi }
}
