// Feed notification surface — the "needs a responsible manager" notice.
//
// A Property or Portal left without a responsible manager has nobody to tell
// but the AccountAdmins, who can choose one. The notice names the gap it is
// about, so delivery rechecks it: a manager chosen meanwhile retires it.

import type { OrganizationId, PropertyId, UserId } from '#/shared/domain/ids'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { UserLookupPort } from '../application/ports/notification-user-lookup.port'
import type { Notice } from '../notify/consumers.server'
import { findAccountAdminRecipients } from '../notify/consumers.server'
import {
  buildPropertyPayload,
  type PropertyPayloadDeps,
} from './notification-payload-facts'

export type ResponsibilityGapNoticeDeps = PropertyPayloadDeps &
  Readonly<{
    userLookup: Pick<UserLookupPort, 'findByRole'>
    logger: LoggerPort
  }>

/** The fact that opened the gap. */
type ResponsibilityGapFact = Readonly<{
  eventId: string
  correlationId: string | null
  organizationId: OrganizationId
  propertyId: PropertyId
  /** Whose action opened it, when a person's did. */
  actorUserId?: UserId | null
}>

type ResponsibilityGapScope =
  | Readonly<{ kind: 'portal'; portalId: string }>
  | Readonly<{ kind: 'property'; propertyId: string }>

const GAP_NOTICES = {
  portal: {
    type: 'portal.responsibility_needed',
    noRecipients: 'Portal responsibility notification has no AccountAdmin recipients',
  },
  property: {
    type: 'property.responsibility_needed',
    noRecipients: 'Property responsibility notification has no AccountAdmin recipients',
  },
} as const

/** One notice per AccountAdmin for a Portal or Property left unstaffed. */
export async function responsibilityGapNotices(
  deps: ResponsibilityGapNoticeDeps,
  fact: ResponsibilityGapFact,
  scope: ResponsibilityGapScope,
): Promise<ReadonlyArray<Notice>> {
  const notice = GAP_NOTICES[scope.kind]
  // Removing a manager who owned ten Properties sent the removing admin ten
  // identical urgent emails about work they had just caused (I17).
  const recipients = await findAccountAdminRecipients(deps, fact.organizationId, {
    context: { correlationId: fact.correlationId ?? undefined },
    message: notice.noRecipients,
    except: fact.actorUserId,
  })
  if (recipients.length === 0) return []
  const where = await buildPropertyPayload(deps, fact.organizationId, fact.propertyId)
  return recipients.map((recipientId) => ({
    userId: recipientId,
    organizationId: fact.organizationId,
    propertyId: fact.propertyId,
    type: notice.type,
    resourceType: scope.kind,
    resourceId: scope.kind === 'portal' ? scope.portalId : scope.propertyId,
    payload: where,
    // Rechecked on delivery: a manager chosen meanwhile retires it.
    audience: { kind: 'responsibility_gap', scope },
  }))
}
