// Identity context — build function.
// Wires identity port, the atomic command store (BQC-3.5), and use cases.
// Per ADR-0001: the composition root calls this and merges useCases into the container.

import type { Database } from '#/shared/db'
import type { IdentityPort } from './application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { invitationId, organizationId } from '#/shared/domain/ids'
import { randomUUID } from 'crypto'
import { inviteMember } from './application/use-cases/invite-member'
import { createCustomRole } from './application/use-cases/create-custom-role'
import { updateCustomRole } from './application/use-cases/update-custom-role'
import { deleteCustomRole } from './application/use-cases/delete-custom-role'
import { updateMemberRole } from './application/use-cases/update-member-role'
import { removeMember } from './application/use-cases/remove-member'
import { listInvitations } from './application/use-cases/list-invitations'
import { resendInvitation } from './application/use-cases/resend-invitation'
import { acceptInvitation } from './application/use-cases/accept-invitation'
import { cancelInvitation } from './application/use-cases/cancel-invitation'
import {
  registerUserAndOrg,
  type RegisterUserAndOrgLogger,
} from './application/use-cases/register-user-and-org'
import { registerUser } from './application/use-cases/register-user'
import { updateOrganization } from './application/use-cases/update-organization'
import { createAtomicIdentityCommandStore } from './infrastructure/identity-command-store'
import { getLogger } from '#/shared/observability/logger'

/** Callback invoked after an invitation is accepted.
 * The composition root provides the implementation that creates
 * staff assignments — identity does NOT import staff directly. */
export type OnMemberJoined = (ctx: {
  userId: string
  organizationId: string
  propertyIds: ReadonlyArray<string>
}) => Promise<void>

type IdentityContextDeps = Readonly<{
  db: Database
  identityPort: IdentityPort
  events: EventBus
  clock: () => Date
  /** Sign up a new user. Returns user ID. */
  signUp: (name: string, email: string, password: string) => Promise<string>
  /** Set the active organization for the current session. */
  setActiveOrg: (orgId: string) => Promise<void>
  /** Update organization fields via auth provider. */
  updateOrg: (data: Record<string, unknown>) => Promise<void>
  /** Send an invitation email. */
  sendEmail: (params: {
    email: string
    invitedByUsername: string
    organizationName: string
    inviteLink: string
  }) => Promise<void>
  /** Resolve the current organization name from auth context. */
  getOrganizationName: (ctx: AuthContext) => Promise<string>
  /** Base URL for building invitation links. */
  baseUrl: string
  /** Invitation lifetime in ms (INVITATION_EXPIRY_SECONDS in shared/auth/auth). */
  invitationExpiresInMs: number
  /** Delete a user (compensating transaction for registration rollback). */
  deleteUser: (userId: string) => Promise<void>
  /** Logger for the register-user-and-org compensating transaction.
   * Defaults to the shared pino logger; overridable for tests/simulations. */
  logger?: RegisterUserAndOrgLogger
}>

export const buildIdentityContext = (deps: IdentityContextDeps) => {
  // BQC-3.5: every identity state mutation + fact commits atomically here.
  const commandStore = createAtomicIdentityCommandStore(deps.db, deps.events)

  const useCases = {
    inviteMember: inviteMember({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
      idGen: () => invitationId(randomUUID()),
      invitationExpiresInMs: deps.invitationExpiresInMs,
      sendEmail: deps.sendEmail,
      getOrganizationName: deps.getOrganizationName,
      baseUrl: deps.baseUrl,
    }),
    updateMemberRole: updateMemberRole({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
    }),
    removeMember: removeMember({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
    }),
    listInvitations: listInvitations({ identity: deps.identityPort }),
    resendInvitation: resendInvitation({
      identity: deps.identityPort,
      sendEmail: deps.sendEmail,
      getOrganizationName: deps.getOrganizationName,
      baseUrl: deps.baseUrl,
    }),
    acceptInvitation: acceptInvitation({
      identity: deps.identityPort,
      commandStore,
      clock: deps.clock,
    }),
    cancelInvitation: cancelInvitation({
      commandStore,
      clock: deps.clock,
    }),
    registerUserAndOrg: registerUserAndOrg({
      signUp: deps.signUp,
      setActiveOrg: deps.setActiveOrg,
      clock: deps.clock,
      idGen: () => organizationId(randomUUID()),
      commandStore,
      deleteUser: deps.deleteUser,
      logger:
        deps.logger ??
        ({
          error: (obj: object, msg?: string) => getLogger().error(obj, msg),
        } satisfies RegisterUserAndOrgLogger),
    }),
    registerUser: registerUser({ identity: deps.identityPort }),
    updateOrganization: updateOrganization({
      updateOrg: deps.updateOrg,
    }),
    createCustomRole: createCustomRole({ identity: deps.identityPort }),
    updateCustomRole: updateCustomRole({ identity: deps.identityPort }),
    deleteCustomRole: deleteCustomRole({ identity: deps.identityPort }),
  } as const

  return { publicApi: {} as const, internal: { repos: {} as const, useCases } } as const
}
