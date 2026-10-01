// Portal context — the actor of an operator-run publication.
//
// A bulk republish is run by a named operator, not by a person signed in to the
// organisation. The publication records WHO published, so the operator is
// recorded as an `ops:<operator>` actor: it is never a user identifier, so it
// can never be mistaken for (or resolve to) a person, and the history shows it
// with the neutral placeholder it shows for any actor it cannot name. The
// context it runs under is organisation-wide Portal authority for that one
// organisation, built here and nowhere a request can reach.

import type { AuthContext } from '#/shared/domain/auth-context'
import type { OrganizationId } from '#/shared/domain/ids'
import { userId } from '#/shared/domain/ids'

export const OPS_ACTOR_PREFIX = 'ops:'

/** What an operator identity may look like; it ends up in the activity history. */
const OPERATOR_ID = /^[A-Za-z0-9][A-Za-z0-9_.@/-]{0,120}$/u

export function opsActorId(operatorId: string): string {
  if (!OPERATOR_ID.test(operatorId)) {
    throw new Error('the operator identity cannot be recorded as a publication actor')
  }
  return `${OPS_ACTOR_PREFIX}${operatorId}`
}

export function opsPublicationContext(
  organizationId: OrganizationId,
  operatorId: string,
): AuthContext {
  return {
    userId: userId(opsActorId(operatorId)),
    organizationId,
    role: 'AccountAdmin',
  }
}
