// Identity context — invitation and invited-registration wiring.
//
// Split out of build.ts so the context build stays under its file-length
// ratchet: invite, list, resend, accept, cancel, the anonymous link preview,
// invited registration and its recovery job are wired here from the shared
// command store and the deps buildIdentityContext received.

import type { Database } from '#/shared/db'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { invitationId } from '#/shared/domain/ids'
import type { IdentityPort } from './application/ports/identity.port'
import type { IdentityCommandStore } from './application/ports/identity-command-store.port'
import type { PropertyNameLookup } from './application/ports/invitation-read-model.port'
import {
  inviteMember,
  type InvitationEmailSender,
} from './application/use-cases/invite-member'
import { listInvitations } from './application/use-cases/list-invitations'
import { resendInvitation } from './application/use-cases/resend-invitation'
import { acceptInvitation } from './application/use-cases/accept-invitation'
import { cancelInvitation } from './application/use-cases/cancel-invitation'
import { getInvitationPreview } from './application/use-cases/get-invitation-preview'
import { registerUser } from './application/use-cases/register-user'
import { registerInvitedUser } from './application/use-cases/register-invited-user'
import { recoverInvitedRegistrations } from './application/use-cases/recover-invited-registrations'
import { createInvitationReadModel } from './infrastructure/invitation-read-model'
import { createInvitedRegistrationStore } from './infrastructure/invited-registration-store'

export type InvitationUseCaseDeps = Readonly<{
  db: Database
  identityPort: IdentityPort
  commandStore: IdentityCommandStore
  clock: Clock
  idGen: () => string
  sendEmail: InvitationEmailSender
  baseUrl: string
  invitationExpiresInMs: number
  propertyNames: PropertyNameLookup
  logger: LoggerPort
  resolveOrganizationName: (ctx: AuthContext) => Promise<string>
}>

export function buildInvitationUseCases(deps: InvitationUseCaseDeps) {
  const invitations = createInvitationReadModel(deps.db)
  const registrationStore = createInvitedRegistrationStore(deps.db)
  const { commandStore, clock, logger } = deps

  return {
    inviteMember: inviteMember({
      identity: deps.identityPort,
      commandStore,
      clock,
      idGen: () => invitationId(deps.idGen()),
      invitationExpiresInMs: deps.invitationExpiresInMs,
      sendEmail: deps.sendEmail,
      getOrganizationName: deps.resolveOrganizationName,
      baseUrl: deps.baseUrl,
    }),
    listInvitations: listInvitations({
      invitations,
      propertyNames: deps.propertyNames,
      clock,
    }),
    resendInvitation: resendInvitation({
      identity: deps.identityPort,
      sendEmail: deps.sendEmail,
      getOrganizationName: deps.resolveOrganizationName,
      baseUrl: deps.baseUrl,
    }),
    acceptInvitation: acceptInvitation({
      identity: deps.identityPort,
      commandStore,
      clock,
    }),
    cancelInvitation: cancelInvitation({ commandStore, clock }),
    getInvitationPreview: getInvitationPreview({
      invitations,
      propertyNames: deps.propertyNames,
      clock,
    }),
    registerUser: registerUser({ identity: deps.identityPort }),
    registerInvitedUser: registerInvitedUser({
      commandStore,
      registrationStore,
      signUp: deps.identityPort.signUp,
      idGen: deps.idGen,
      runOnAccepted: deps.identityPort.runOnAcceptInvitation,
      clock,
      logger,
    }),
    recoverInvitedRegistrations: recoverInvitedRegistrations({
      commandStore,
      registrationStore,
      runOnAccepted: deps.identityPort.runOnAcceptInvitation,
      clock,
      logger,
    }),
  } as const
}
