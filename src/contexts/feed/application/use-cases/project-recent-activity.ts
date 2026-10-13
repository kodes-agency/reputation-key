// Feed activity surface — project a Recent Activity entry
// Shared by durable consumers, recovery, and the drain-only queued-job handler.
// Per architecture: "Use cases are standalone functions that receive deps and return an async function."

import type { RecentActivityRepository } from '../../ports/recent-activity-repository.port'
import type { UserLookupPort } from '../../ports/activity-user-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { Role } from '#/shared/domain/roles'
import type {
  UserId,
  OrganizationId,
  PropertyId,
  RecentActivityEntryId,
} from '#/shared/domain/ids'
import {
  createRecentActivityEntry,
  SYSTEM_USER_ID,
} from '../../domain/activity-constructors'
import type {
  ActivityAction,
  ResourceType,
  ActivityPayload,
} from '../../domain/activity-types'

export type ProjectRecentActivityInput = Readonly<{
  action: ActivityAction
  resourceType: ResourceType
  resourceId: string
  propertyId: PropertyId | null
  organizationId: OrganizationId
  userId: UserId | null
  source: 'web' | 'import'
  eventId: string
  /** Source-fact occurrence time. Legacy queued jobs may omit it. */
  occurredAt?: Date | string
  payload: ActivityPayload
}>

export type ProjectRecentActivityDeps = Readonly<{
  repo: RecentActivityRepository
  userLookup: UserLookupPort
  clock: () => Date
  logger: LoggerPort
  idGen: () => RecentActivityEntryId
}>

type PrepareRecentActivityEntryDeps = Omit<ProjectRecentActivityDeps, 'repo'>

const sanitizedInput = (input: ProjectRecentActivityInput): ProjectRecentActivityInput =>
  input.action === 'invited' &&
  input.resourceType === 'member' &&
  input.payload.detail !== null
    ? { ...input, payload: { ...input.payload, detail: null } }
    : input

export const prepareRecentActivityEntry = async (
  deps: PrepareRecentActivityEntryDeps,
  input: ProjectRecentActivityInput,
) => {
  const safeInput = sanitizedInput(input)
  const { userId, propertyId, occurredAt, ...activityFields } = safeInput

  const { organizationId } = activityFields

  // Resolve the actor. A fact that names no user is the system's own. One that
  // names a user is looked up, and a lookup that FAILS fails the projection:
  // the entry is written once per event, so naming System for an action a
  // person took could never be corrected by a redelivery. The durable consumer
  // retries instead, as it does for a failed Inbox item lookup. An actor the
  // lookup does not find is not a failure: the adapter answers with its
  // fallback and the entry keeps the user's id.
  let actorName = 'System'
  let actorAvatarUrl: string | null = null
  let actorRole: Role = 'Member'

  if (userId) {
    const user = await deps.userLookup.lookup(userId as string, organizationId as string)
    actorName = user.name
    actorAvatarUrl = user.avatarUrl
    actorRole = user.role ?? 'Member'
  }

  const projectionTime =
    occurredAt === undefined
      ? deps.clock()
      : occurredAt instanceof Date
        ? occurredAt
        : new Date(occurredAt)
  if (Number.isNaN(projectionTime.getTime())) {
    throw new Error('Recent Activity source occurrence time is invalid')
  }

  return createRecentActivityEntry(
    {
      id: deps.idGen(),
      actorId: userId || SYSTEM_USER_ID,
      actorName,
      actorAvatarUrl,
      actorRole,
      propertyId,
      ...activityFields,
    },
    () => projectionTime,
  )
}

export const projectRecentActivity =
  (deps: ProjectRecentActivityDeps) =>
  async (input: ProjectRecentActivityInput): Promise<void> => {
    const safeInput = sanitizedInput(input)
    const { action, resourceType, resourceId, organizationId, payload, eventId } =
      safeInput

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

    const result = await prepareRecentActivityEntry(deps, safeInput)

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

export type ProjectRecentActivity = typeof projectRecentActivity
