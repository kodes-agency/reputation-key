// Identity context — invitation and invited-registration wiring.
//
// Split out of build.ts so the context build stays under its file-length
// ratchet: invite, list, resend, accept, cancel, the anonymous link preview,
// invited registration and its recovery job are wired here from the shared
// command store and the deps buildIdentityContext received.

import type { Database } from '#/shared/db'
import type { Capability } from '#/shared/auth/beta-capabilities'
import { decidePublicExecution } from '#/shared/auth/execution-policy'
import type { Clock } from '#/shared/domain/clock'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { invitationId, type OrganizationId } from '#/shared/domain/ids'
import type { SystemAction } from '#/shared/governance/entry-point-catalogue'
import type { IdentityPort } from './application/ports/identity.port'
import type { IdentityCommandStore } from './application/ports/identity-command-store.port'
import type { InvitationEmailSender } from './application/ports/invitation-email.port'
import type { PropertyNameLookup } from './application/ports/invitation-read-model.port'
import { inviteMember } from './application/use-cases/invite-member'
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

/** Consuming an invitation creates a member, under the capability that sends it. */
const INVITATION_CAPABILITY: Capability = 'identity.invite'
/** The catalogue action of acceptance; the recovery job is governed under it too. */
const ACCEPT_INVITATION_ACTION: SystemAction = 'system:identity.accept_invitation'

export function buildInvitationUseCases(deps: InvitationUseCaseDeps) {
  const invitations = createInvitationReadModel(deps.db)
  const registrationStore = createInvitedRegistrationStore(deps.db)
  const { commandStore, clock, logger } = deps
  // A joiner has no tenant context yet, so the execution policy decides for
  // the invitation's Organization (ADR 0032): the kill switch, an Organization
  // suspension and isolated restore mode refuse acceptance and registration.
  // The recovery job brings the authorizer of its own schedule to each pass.
  const admission = {
    invitations,
    authorizeOrganization: async (organizationId: OrganizationId) => {
      const decision = await decidePublicExecution({
        action: ACCEPT_INVITATION_ACTION,
        capability: INVITATION_CAPABILITY,
        organizationId,
        now: clock(),
      })
      return decision.allowed
    },
  } as const
  // What both sends (invite, resend) need to compose and mail the invitation.
  const emailDelivery = {
    identity: deps.identityPort,
    sendEmail: deps.sendEmail,
    getOrganizationName: deps.resolveOrganizationName,
    propertyNames: deps.propertyNames,
    baseUrl: deps.baseUrl,
    invitationExpiresInMs: deps.invitationExpiresInMs,
    logger,
  } as const

  return {
    inviteMember: inviteMember({
      ...emailDelivery,
      commandStore,
      clock,
      idGen: () => invitationId(deps.idGen()),
    }),
    listInvitations: listInvitations({
      invitations,
      propertyNames: deps.propertyNames,
      clock,
    }),
    resendInvitation: resendInvitation({ ...emailDelivery, commandStore, clock }),
    acceptInvitation: acceptInvitation({
      ...admission,
      identity: deps.identityPort,
      commandStore,
      clock,
      logger,
    }),
    cancelInvitation: cancelInvitation({ commandStore, clock }),
    getInvitationPreview: getInvitationPreview({
      invitations,
      propertyNames: deps.propertyNames,
      clock,
    }),
    registerUser: registerUser({ identity: deps.identityPort }),
    registerInvitedUser: registerInvitedUser({
      ...admission,
      commandStore,
      registrationStore,
      signUp: deps.identityPort.signUp,
      idGen: deps.idGen,
      clock,
      logger,
    }),
    recoverInvitedRegistrations: recoverInvitedRegistrations({
      commandStore,
      registrationStore,
      clock,
      logger,
    }),
  } as const
}
