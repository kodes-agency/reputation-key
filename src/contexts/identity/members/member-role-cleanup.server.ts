// Identity context — the cleanup a committed role change owes.
//
// The role, its permission version and the role_changed fact commit together;
// what the member may no longer be responsible for is released afterwards.
// The request runs this cleanup itself, and the durable consumer of the fact
// runs it again if the request never got that far. Both record the same
// receipt, which is how a retried request knows whether the cleanup finished.

import type { IdentityCommandStore } from '../application/ports/identity-command-store.port'

export const MEMBER_ROLE_CLEANUP_CONSUMER = 'identity.on-member-role-changed'

export type RoleChangeCleanupInput = Readonly<{
  eventId: string
  organizationId: string
  memberUserId: string
  actorUserId: string
}>

export type RoleChangeCleanup = (input: RoleChangeCleanupInput) => Promise<void>

export type RoleChangeCleanupDeps = Readonly<{
  commandStore: Pick<IdentityCommandStore, 'completeRoleChangeCleanup'>
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

/** Safe to repeat: a second reconcile finds nothing left to release. */
export const roleChangeCleanup =
  (deps: RoleChangeCleanupDeps): RoleChangeCleanup =>
  async (input) => {
    await deps.reconcileResponsibleManagerEligibility?.(
      input.organizationId,
      input.memberUserId,
      input.actorUserId,
    )
    await deps.commandStore.completeRoleChangeCleanup(input.eventId)
  }
