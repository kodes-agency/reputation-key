import type { Database } from '#/shared/db'
import type { EventBus } from '#/shared/events/event-bus'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from './ports/user-lookup.port'
import type { IdentityPort } from '#/contexts/identity/application/ports/identity.port'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { ActivityPublicApi } from './application/public-api'
import { createActivityRepository } from './infrastructure/activity-repository.drizzle'
import { registerActivityHandlers } from './infrastructure/event-handlers'
import { createIdentityUserLookupAdapter } from './infrastructure/adapters/identity-user-lookup.adapter'
import { getActivityTimeline } from './queries/get-activity-timeline'
import { getOrgActivity } from './queries/get-org-activity'

type BuildInput = Readonly<{
  db: Database
  events: EventBus
  clock: () => Date
  logger: LoggerPort
  staffPublicApi: StaffPublicApi
  identityPort?: IdentityPort
  userLookup?: UserLookupPort
}>

const fallbackUserLookup: UserLookupPort = {
  lookup: async () => ({
    name: 'System',
    avatarUrl: null,
    role: 'Staff' as const,
  }),
}

export const buildActivityContext = (input: BuildInput) => {
  const repo = createActivityRepository(input.db)
  const userLookup: UserLookupPort =
    input.userLookup ??
    (input.identityPort
      ? createIdentityUserLookupAdapter(input.identityPort)
      : fallbackUserLookup)

  const timeline = getActivityTimeline({
    repo,
    staffPublicApi: input.staffPublicApi,
  })
  const orgActivity = getOrgActivity({
    repo,
    staffPublicApi: input.staffPublicApi,
  })

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

  return {
    publicApi,
    internal: { repos: { activityRepo: repo }, useCases: {} as const },
  } as const
}
