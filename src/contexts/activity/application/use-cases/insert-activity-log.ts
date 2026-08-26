// Activity context — project a Recent Activity entry
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
  eventId: string
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
    // Rolling invitation-fact safety: a retained legacy queue job may resume
    // after losing its BullMQ lock. Enforce the identifier-only invariant at
    // the persistence use-case boundary as well as at producers/scrubbers.
    const safeInput =
      input.action === 'invited' &&
      input.resourceType === 'member' &&
      input.payload.detail !== null
        ? { ...input, payload: { ...input.payload, detail: null } }
        : input
    const { userId, propertyId, ...activityFields } = safeInput
    const { action, resourceType, resourceId, organizationId, payload, eventId } =
      activityFields

    // 1. Idempotency gate — skip if a duplicate entry already exists
    const duplicate = await deps.repo.findDuplicate({
      eventId,
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
    // ACT-011: track whether the real user was resolved. When lookup fails,
    // actorId must be SYSTEM_USER_ID (not the real userId) so the record is
    // consistently attributed to 'system' — actorName/actorRole already fall
    // back to system defaults, so actorId should match.
    let resolvedUserId: UserId | null = userId

    if (userId) {
      try {
        const user = await deps.userLookup.lookup(
          userId as string,
          organizationId as string,
        )
        actorName = user.name
        actorAvatarUrl = user.avatarUrl
        actorRole = user.role ?? 'Staff'
      } catch (e) {
        deps.logger.warn(
          { error: e },
          'Activity user lookup failed, using system defaults',
        )
        resolvedUserId = null
      }
    }

    // 3. Construct the domain object via the domain constructor
    const result = createActivityLog(
      {
        id: deps.idGen(),
        actorId: resolvedUserId || SYSTEM_USER_ID,
        actorName,
        actorAvatarUrl,
        actorRole,
        propertyId,
        ...activityFields,
      },
      deps.clock,
    )

    if (result.isErr()) {
      // BQC-7.3: the raw input (tenant/entity ids) is never logged.
      deps.logger.warn(
        { error: result.error },
        'Failed to construct Recent Activity entry',
      )
      return
    }

    // 4. Persist the Recent Activity projection entry
    try {
      await deps.repo.insert(result.value)
    } catch (error) {
      deps.logger.error({ error }, 'Failed to persist Recent Activity entry')
      throw error // re-throw so BullMQ retries
    }
  }

export type InsertActivityLog = typeof insertActivityLog
