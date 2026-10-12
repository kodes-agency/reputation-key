// Identity context — Members access wiring.
//
// Split out of build.ts so the context build stays under its file-length
// ratchet: AccountAdmins read and edit which Properties each PropertyManager
// can work, through one grant store shared with no other request.

import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type { IdentityPort } from './application/ports/identity.port'
import {
  listMemberPropertyAccess,
  setMemberPropertyAccess,
} from './application/use-cases/member-property-access'
import { createMemberPropertyAccessStore } from './infrastructure/member-property-access-store'

export type MemberAccessUseCaseDeps = Readonly<{
  db: Database
  identityPort: IdentityPort
  clock: Clock
  /** Releases Responsible Manager duties a revoke left the member unable to hold. */
  reconcileResponsibleManagerEligibility?: (
    organizationId: string,
    userId: string,
    actorId: string,
  ) => Promise<void>
}>

export function buildMemberAccessUseCases(deps: MemberAccessUseCaseDeps) {
  const store = createMemberPropertyAccessStore(deps.db)
  return {
    setMemberPropertyAccess: setMemberPropertyAccess({
      identity: deps.identityPort,
      store,
      clock: deps.clock,
      reconcileResponsibleManagerEligibility: deps.reconcileResponsibleManagerEligibility,
    }),
    listMemberPropertyAccess: listMemberPropertyAccess({ store, clock: deps.clock }),
  } as const
}
