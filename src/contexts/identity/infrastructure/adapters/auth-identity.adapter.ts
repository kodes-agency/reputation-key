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
import { organizationId } from '#/shared/domain/ids'
import { getRequest } from '@tanstack/react-start/server'

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
  user?: { id: string; email: string; name: string; image: string | null }
}): MemberRecord {
  return {
    id: m.id,
    userId: m.userId,
    email: m.user?.email ?? '',
    name: m.user?.name ?? '',
    role: toDomainRole(m.role),
    image: m.user?.image ?? null,
    createdAt: m.createdAt,
  }
}

/** Create the better-auth implementation of IdentityPort. */
export function createAuthIdentityAdapter(): IdentityPort {
  return {
    async listMembers(_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
      const auth = getAuth()
      const headers = headersFromRequest()
      const result = await auth.api.listMembers({ headers })

      const rawMembers = (result?.members ?? result ?? []) as Parameters<
        typeof toMemberRecord
      >[0][]
      return rawMembers.map(toMemberRecord)
    },

    async getMember(_ctx: AuthContext, memberId: string): Promise<MemberRecord | null> {
      const auth = getAuth()
      const headers = headersFromRequest()
      const result = await auth.api.listMembers({ headers })

      const rawMembers = (result?.members ?? result ?? []) as Parameters<
        typeof toMemberRecord
      >[0][]
      const member = rawMembers.find((m) => m.id === memberId)
      return member ? toMemberRecord(member) : null
    },

    async createInvitation(
      _ctx: AuthContext,
      email: string,
      role: string,
    ): Promise<string> {
      const auth = getAuth()
      const headers = headersFromRequest()
      const result = await auth.api.createInvitation({
        headers,
        body: { email, role: toBetterAuthRole(role as ReturnType<typeof toDomainRole>) },
      })
      // better-auth createInvitation returns the invitation object with an id
      const invitation = result as unknown as { id?: string } | undefined
      return invitation?.id ?? ''
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

      type RawInvitation = {
        id: string
        email: string
        role: string
        status: string
        expiresAt: Date
        createdAt: Date
      }

      const rawInvitations = (Array.isArray(result) ? result : []) as RawInvitation[]
      return rawInvitations.map(
        (inv): InvitationRecord => ({
          id: inv.id,
          email: inv.email,
          role: toDomainRole(inv.role),
          status: inv.status as InvitationRecord['status'],
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

      type RawInvitation = {
        id: string
        email: string
        role: string
        status: string
        expiresAt: Date
        createdAt: Date
        organizationId?: string
        organization?: { name: string }
      }

      const rawInvitations = (Array.isArray(result) ? result : []) as RawInvitation[]
      return rawInvitations.map(
        (inv): InvitationRecord => ({
          id: inv.id,
          email: inv.email,
          role: toDomainRole(inv.role),
          status: inv.status as InvitationRecord['status'],
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

      type RawOrg = {
        id: string
        name: string
        slug: string
        logo: string | null
        createdAt: Date
      }

      const rawOrgs = (Array.isArray(result) ? result : []) as RawOrg[]
      return rawOrgs.map(
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
