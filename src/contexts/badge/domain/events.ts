// Badge context — domain events

import { newEventId } from '#/shared/domain/event-id'
import { assert } from '#/shared/domain/assert'
import type {
  BadgeId,
  PortalGroupId,
  PortalId,
  PropertyId,
  OrganizationId,
} from '#/shared/domain/ids'
import type { BadgeTargetType } from './types'

export type BadgeAwarded = Readonly<{
  _tag: 'badge.awarded'
  eventId: string
  correlationId: string | null
  occurredAt: Date
  badgeDefinitionId: BadgeId
  criteriaVersion: number
  targetType: BadgeTargetType
  targetId: PortalId | PortalGroupId
  organizationId: OrganizationId
  propertyId: PropertyId
  awardedAt: Date
}>

export type BadgeEvent = BadgeAwarded

export const badgeAwarded = (
  args: Omit<BadgeAwarded, '_tag' | 'eventId' | 'correlationId'>,
): BadgeAwarded => {
  assert(args.organizationId !== ('' satisfies string), 'organizationId required')
  assert(args.awardedAt instanceof Date, 'awardedAt must be a Date')
  assert(args.occurredAt instanceof Date, 'occurredAt must be a Date')
  return {
    _tag: 'badge.awarded',
    eventId: newEventId(),
    correlationId: null,
    ...args,
  }
}
