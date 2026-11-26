// Invited Property access — written inside the acceptance transaction.
//
// An invitation names the Properties its PropertyManager may work on. Identity
// owns `property_access_grant`, so those grants commit with the membership
// they belong to: nobody is accepted without them, and no grant outlives an
// acceptance that rolled back. It takes the per-grant locks and shares the
// grant write of the operator surface and the Members access edit, so all three
// serialize and converge on one active grant.

import type { Tx } from '#/shared/outbox/commit'
import { invitedPropertySelection } from '../domain/invitation-store-rules'
import {
  lockPropertyGrant,
  lockPropertyInOrganization,
} from './property-grant-locks.server'
import { writePropertyGrant } from './property-grant-write.server'

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
  // A grant the Property already has is kept and still counts as granted.
  await writePropertyGrant(tx, {
    ...key,
    createdBy: access.inviterId,
    source: 'invitation',
    expiresAt: null,
    replacesActiveTerm: false,
    now: access.now,
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
