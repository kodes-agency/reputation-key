// Identity context — build function.
// Wires identity port, use cases.
// Per ADR-0001: the composition root calls this and merges useCases into the container.

import type { IdentityPort } from './application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { EventBus } from '#/shared/events/event-bus'
import { inviteMember } from './application/use-cases/invite-member'
import { updateMemberRole } from './application/use-cases/update-member-role'
import { removeMember } from './application/use-cases/remove-member'
import { listInvitations } from './application/use-cases/list-invitations'
import { resendInvitation } from './application/use-cases/resend-invitation'
import { registerUserAndOrg } from './application/use-cases/register-user-and-org'
import { registerUser } from './application/use-cases/register-user'

/** Callback invoked after an invitation is accepted.
 * The composition root provides the implementation that creates
 * staff assignments — identity does NOT import staff directly. */
export type OnMemberJoined = (ctx: {
  userId: string
  organizationId: string
  propertyIds: ReadonlyArray<string>
}) => Promise<void>

type IdentityContextDeps = Readonly<{
  identityPort: IdentityPort
  events: EventBus
  clock: () => Date
  /** Sign up a new user. Returns user ID. */
  signUp: (name: string, email: string, password: string) => Promise<string>
  /** Create an organization. Returns org ID. */
  createOrg: (
    headers: Headers,
    name: string,
    slug: string,
    userId?: string,
  ) => Promise<string>
  /** Set the active organization for the current session. */
  setActiveOrg: (headers: Headers, orgId: string) => Promise<void>
  /** Build headers carrying the current request session. */
  headers: () => Headers
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
}>

export const buildIdentityContext = (deps: IdentityContextDeps) => {
  const useCases = {
    inviteMember: inviteMember({
      identity: deps.identityPort,
      events: deps.events,
      clock: deps.clock,
    }),
    updateMemberRole: updateMemberRole({
      identity: deps.identityPort,
      events: deps.events,
      clock: deps.clock,
    }),
    removeMember: removeMember({
      identity: deps.identityPort,
      events: deps.events,
      clock: deps.clock,
    }),
    listInvitations: listInvitations({ identity: deps.identityPort }),
    resendInvitation: resendInvitation({
      identity: deps.identityPort,
      sendEmail: deps.sendEmail,
      getOrganizationName: deps.getOrganizationName,
      baseUrl: deps.baseUrl,
    }),
    registerUserAndOrg: registerUserAndOrg({
      events: deps.events,
      signUp: deps.signUp,
      createOrg: deps.createOrg,
      setActiveOrg: deps.setActiveOrg,
      headers: deps.headers,
      clock: deps.clock,
    }),
    registerUser: registerUser({ identity: deps.identityPort }),
  } as const

  return { useCases } as const
}
