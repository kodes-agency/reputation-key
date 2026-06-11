// Activity context — insert activity log use case
// Extracted from in-process handler for BullMQ worker consumption.
// Per architecture: "Use cases are standalone functions that receive deps and return an async function."

import type { ActivityRepository } from '../../ports/activity-repository.port'
import type { UserLookupPort } from '../../ports/user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Role } from '#/shared/domain/roles'
import type {
  UserId,
  OrganizationId,
  PropertyId,
  ActivityLogId,
} from '#/shared/domain/ids'
import { createActivityLog, SYSTEM_USER_ID } from '../../domain/constructors'
import type { ActivityAction, ResourceType, ActivityPayload } from '../../domain/types'

export type InsertActivityLogInput = Readonly<{
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  propertyId: PropertyId | null
  organizationId: OrganizationId
  userId: UserId | null
  source: 'web' | 'import'
  payload: ActivityPayload
}>

export type InsertActivityLogDeps = Readonly<{
  repo: ActivityRepository
  userLookup: UserLookupPort
  clock: () => Date
  logger: LoggerPort
  idGen: () => ActivityLogId
}>

export const insertActivityLog =
  (deps: InsertActivityLogDeps) =>
  async (input: InsertActivityLogInput): Promise<void> => {
    const { userId, propertyId, ...activityFields } = input
    const { action, resourceType, resourceId, organizationId, payload } = activityFields

    // 1. Idempotency gate — skip if a duplicate entry already exists
    const duplicate = await deps.repo.findDuplicate({
      action,
      resourceType,
      resourceId,
      organizationId,
      payload,
    })
    if (duplicate) return

    // 2. Resolve actor info — fall back to system defaults on lookup failure
    let actorName = 'System'
    let actorAvatarUrl: string | null = null
    let actorRole: Role = 'Staff'

    if (userId) {
      try {
        const user = await deps.userLookup.lookup(
          userId as string,
          organizationId as string,
        )
        actorName = user.name
        actorAvatarUrl = user.avatarUrl
        actorRole = user.role
      } catch (e) {
        deps.logger.warn(
          { error: e, userId },
          'Activity user lookup failed, using system defaults',
        )
      }
    }

    // 3. Construct the domain object via the domain constructor
    const result = createActivityLog(
      {
        id: deps.idGen(),
        actorId: userId || SYSTEM_USER_ID,
        actorName,
        actorAvatarUrl,
        actorRole,
        propertyId,
        ...activityFields,
      },
      deps.clock,
    )

    if (result.isErr()) {
      deps.logger.warn(
        { error: result.error, input },
        'Failed to construct activity log entry',
      )
      return
    }

    // 4. Persist the activity log entry
    try {
      await deps.repo.insert(result.value)
    } catch (error) {
      deps.logger.error({ error, input }, 'Failed to persist activity log entry')
      throw error // re-throw so BullMQ retries
    }
  }

export type InsertActivityLog = typeof insertActivityLog
