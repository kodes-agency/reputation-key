// Identity context — the last-owner UX guard.
// Shared by the removal and role-change use cases, which each refuse to take
// the organization's only owner away.

import type { AuthContext } from '#/shared/domain/auth-context'
import { isOwnerToken } from '#/shared/domain/roles'
import { identityError } from '../../domain/errors'
import type { IdentityPort } from '../ports/identity.port'

/**
 * Throw `forbidden` with `refusal` when the organization has at most one owner.
 * Call it only for a target that is itself an owner. Owners are counted via the
 * raw role string so a multi-role owner ('owner,editor') still counts although
 * its built-in Role is null. The command store re-checks the same invariant
 * under the org advisory lock (TOCTOU backstop).
 */
export async function assertAnotherOwnerRemains(
  identity: Pick<IdentityPort, 'listMembers'>,
  ctx: AuthContext,
  refusal: string,
): Promise<void> {
  const members = await identity.listMembers(ctx)
  const ownerCount = members.filter((m) => isOwnerToken(m.rawRole)).length
  if (ownerCount <= 1) {
    throw identityError('forbidden', refusal)
  }
}
