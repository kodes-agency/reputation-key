// Identity context — better-auth adapter implementing the IdentityPort.
// Per architecture: "Infrastructure implements ports defined by application."
// Wraps better-auth's API calls behind the port interface so use cases
// remain testable with in-memory fakes.

import type {
  IdentityPort,
  MemberRecord,
  InvitationRecord,
  OrganizationRecord,
} from '../../application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getAuth } from '#/shared/auth/auth'
import { toDomainRole, toBetterAuthRole } from '#/shared/domain/roles'
import { identityError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'
import { getRequest } from '@tanstack/react-start/server'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
  listMembersResponseSchema,
  createInvitationResponseSchema,
  listInvitationsResponseSchema,
  listUserInvitationsResponseSchema,
  listOrganizationsResponseSchema,
} from './better-auth-schemas'

/** Build request headers that carry the better-auth session cookie.
 * The adapter needs real headers because better-auth server APIs
 * authenticate via cookies, not via context objects. */
function headersFromRequest(): Headers {
  const headers = new Headers()
  const req = getRequest()
  if (req) {
    req.headers.forEach((value: string, key: string) => {
      headers.set(key, value)
    })
  }
  return headers
}

/** Map a raw better-auth member object to our MemberRecord. */
function toMemberRecord(m: {
  id: string
  userId: string
  role: string
  createdAt: Date
  user: { id: string; email: string; name: string; image?: string | null }
}): MemberRecord {
  return {
    id: m.id,
    userId: m.userId,
    email: m.user.email,
    name: m.user.name,
    role: toDomainRole(m.role),
    image: m.user.image ?? null,
    createdAt: m.createdAt,
  }
}

/** Create the better-auth implementation of IdentityPort. */
export function createAuthIdentityAdapter(): IdentityPort {
  return {
    async signUp(name: string, email: string, password: string): Promise<string> {
      const auth = getAuth()
      const result = await auth.api.signUpEmail({
        body: { name, email, password },
      })
      const data = parseBetterAuthResponse(
        signUpResponseSchema,
        result,
        'registration_failed',
        'Sign-up response did not match expected schema',
      )
      if (!data.user.id) {
        throw identityError('registration_failed', 'Sign-up failed: no user ID returned')
      }
      return data.user.id
    },

    async listMembers(_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
      const auth = getAuth()
      const headers = headersFromRequest()
      const result = await auth.api.listMembers({ headers })

      const data = parseBetterAuthResponse(
        listMembersResponseSchema,
        result,
        'org_setup_failed',
        'listMembers response did not match expected schema',
      )
      return data.members.map(toMemberRecord)
    },

    async getMember(_ctx: AuthContext, memberId: string): Promise<MemberRecord | null> {
      const auth = getAuth()
      const headers = headersFromRequest()
      const result = await auth.api.listMembers({ headers })

      const data = parseBetterAuthResponse(
        listMembersResponseSchema,
        result,
        'org_setup_failed',
        'listMembers response did not match expected schema',
      )
      const member = data.members.find((m) => m.id === memberId)
      return member ? toMemberRecord(member) : null
    },

    async createInvitation(
      _ctx: AuthContext,
      email: string,
      role: string,
      propertyIds?: ReadonlyArray<string>,
    ): Promise<string> {
      const auth = getAuth()
      const headers = headersFromRequest()
      const result = await auth.api.createInvitation({
        headers,
        body: {
          email,
          role: toBetterAuthRole(role as ReturnType<typeof toDomainRole>),
          propertyIds:
            propertyIds && propertyIds.length > 0
              ? JSON.stringify(propertyIds)
              : undefined,
        },
      })
      const invitation = parseBetterAuthResponse(
        createInvitationResponseSchema,
        result,
        'org_setup_failed',
        'createInvitation response did not match expected schema',
      )
      return invitation.id
    },

    async acceptInvitation(invitationId: string, headers: Headers): Promise<void> {
      const auth = getAuth()
      await auth.api.acceptInvitation({ headers, body: { invitationId } })
    },

    async rejectInvitation(invitationId: string, headers: Headers): Promise<void> {
      const auth = getAuth()
      await auth.api.rejectInvitation({ headers, body: { invitationId } })
    },

    async listInvitations(_ctx: AuthContext): Promise<ReadonlyArray<InvitationRecord>> {
      const auth = getAuth()
      const headers = headersFromRequest()
      const result = await auth.api.listInvitations({ headers })

      const invitations = parseBetterAuthResponse(
        listInvitationsResponseSchema,
        result,
        'org_setup_failed',
        'listInvitations response did not match expected schema',
      )
      return invitations.map(
        (inv): InvitationRecord => ({
          id: inv.id,
          email: inv.email,
          role: toDomainRole(inv.role),
          status: inv.status,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
        }),
      )
    },

    async listUserInvitations(
      headers: Headers,
    ): Promise<ReadonlyArray<InvitationRecord>> {
      const auth = getAuth()
      const result = await auth.api.listUserInvitations({ headers })

      const invitations = parseBetterAuthResponse(
        listUserInvitationsResponseSchema,
        result,
        'org_setup_failed',
        'listUserInvitations response did not match expected schema',
      )
      return invitations.map(
        (inv): InvitationRecord => ({
          id: inv.id,
          email: inv.email,
          role: toDomainRole(inv.role),
          status: inv.status,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
          organizationId: inv.organizationId
            ? organizationId(inv.organizationId)
            : undefined,
          organizationName: inv.organization?.name,
        }),
      )
    },

    async updateMemberRole(
      _ctx: AuthContext,
      memberId: string,
      role: string,
    ): Promise<void> {
      const auth = getAuth()
      const headers = headersFromRequest()
      await auth.api.updateMemberRole({
        headers,
        body: {
          memberId,
          role: toBetterAuthRole(role as ReturnType<typeof toDomainRole>),
        },
      })
    },

    async removeMember(_ctx: AuthContext, memberId: string): Promise<void> {
      const auth = getAuth()
      const headers = headersFromRequest()
      await auth.api.removeMember({
        headers,
        body: { memberIdOrEmail: memberId },
      })
    },

    async listUserOrganizations(
      headers: Headers,
    ): Promise<ReadonlyArray<OrganizationRecord>> {
      const auth = getAuth()
      const result = await auth.api.listOrganizations({ headers })

      const orgs = parseBetterAuthResponse(
        listOrganizationsResponseSchema,
        result,
        'org_setup_failed',
        'listOrganizations response did not match expected schema',
      )
      return orgs.map(
        (org): OrganizationRecord => ({
          id: org.id,
          name: org.name,
          slug: org.slug,
          logo: org.logo ?? null,
          createdAt: org.createdAt,
        }),
      )
    },

    async setActiveOrganization(headers: Headers, organizationId: string): Promise<void> {
      const auth = getAuth()
      await auth.api.setActiveOrganization({ headers, body: { organizationId } })
    },
  }
}
