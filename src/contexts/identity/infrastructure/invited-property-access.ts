// Invited Property access — written inside the acceptance transaction.
//
// An invitation names the Properties its PropertyManager may work on. Identity
// owns `property_access_grant`, so those grants commit with the membership
// they belong to: nobody is accepted without them, and no grant outlives an
// acceptance that rolled back. It takes the per-grant locks and reuses the
// statements of the operator surface and the Members access edit, so all three
// serialize and converge on one active grant.

import type { Tx } from '#/shared/outbox/commit'
import { invitedPropertySelection } from '../domain/invitation-store-rules'
import {
  grantPropertyAccess,
  revokePropertyAccess,
} from './repositories/property-access-grant.repository'
import {
  lockPropertyGrant,
  lockPropertyInOrganization,
  lockUnrevokedGrant,
} from './property-grant-locks'

/** Why a lapsed grant the invitation replaced was retired. */
const SUPERSEDED_REASON = 'superseded'

type InvitedPropertyAccess = Readonly<{
  organizationId: string
  userId: string
  propertyIds: ReadonlyArray<string>
  /** Who sent the invitation; its grants record them as their creator. */
  inviterId: string
  now: Date
}>

/** Grant one invited Property; false when the Organization has no such live Property. */
async function grantInvitedProperty(
  tx: Tx,
  access: InvitedPropertyAccess,
  propertyId: string,
): Promise<boolean> {
  const key = {
    organizationId: access.organizationId,
    propertyId,
    userId: access.userId,
  }
  // Nothing is granted on a Property deleted since the invitation was sent.
  if (!(await lockPropertyInOrganization(tx, { ...key, live: true }))) return false
  const current = await lockUnrevokedGrant(tx, key)
  if (current && (current.expiresAt === null || current.expiresAt > access.now)) {
    return true
  }
  // A lapsed grant still holds the one-active-grant slot: retire it first.
  if (current) await revokePropertyAccess(tx, { ...key, reason: SUPERSEDED_REASON })
  await grantPropertyAccess(tx, {
    ...key,
    source: 'invitation',
    createdBy: access.inviterId,
  })
  return true
}

/**
 * Grant the invitation's Properties to the member this transaction created.
 * Each Property is decided on its own, so a stale selection cannot hold back a
 * valid sibling or the acceptance. Returns the ids that were not granted: a
 * Property deleted since, one of another Organization, or an id that names no
 * Property.
 */
export async function grantInvitedPropertyAccess(
  tx: Tx,
  access: InvitedPropertyAccess,
): Promise<ReadonlyArray<string>> {
  const { candidateIds, malformedIds } = invitedPropertySelection(access.propertyIds)
  for (const propertyId of candidateIds) {
    await lockPropertyGrant(tx, {
      organizationId: access.organizationId,
      propertyId,
      userId: access.userId,
    })
  }
  const absentIds: string[] = []
  for (const propertyId of candidateIds) {
    if (!(await grantInvitedProperty(tx, access, propertyId))) absentIds.push(propertyId)
  }
  return [...malformedIds, ...absentIds]
}
