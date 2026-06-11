// Identity context — better-auth adapter implementing the IdentityPort.
// Per architecture: "Infrastructure implements ports defined by application."
// Wraps better-auth's API calls behind the port interface so use cases
// remain testable with in-memory fakes.

import type { Database } from '#/shared/db'
import { eq, sql } from 'drizzle-orm'
import { user as userTable } from '#/shared/db/schema/auth'
import { getLogger } from '#/shared/observability/logger'
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
import { organizationId, invitationId } from '#/shared/domain/ids'
import type { InvitationId, OrganizationId } from '#/shared/domain/ids'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
  listMembersResponseSchema,
  createInvitationResponseSchema,
  listInvitationsResponseSchema,
  listUserInvitationsResponseSchema,
  betterAuthOrganizationSchema,
} from './better-auth-schemas'

/** Build request headers that carry the better-auth session cookie.
 * Uses dynamic import to avoid @tanstack/react-start/server being part of
 * the static module graph, which triggers client-side import protection. */
async function headersFromRequest(): Promise<Headers> {
  const headers = new Headers()
  try {
    const { getRequest } = await import('@tanstack/react-start/server')
    const req = getRequest()
    if (req) {
      req.headers.forEach((value: string, key: string) => {
        headers.set(key, value)
      })
    }
  } catch (e) {
    getLogger().debug(
      { err: e },
      'headersFromRequest: no server context available, returning empty headers',
    )
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

export function createBetterAuthIdentityAdapter(db: Database): IdentityPort {
  const auth = getAuth()
  return {
    async signUp(name: string, email: string, password: string): Promise<string> {
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

    // Relies on better-auth session scoping — the active organization is bound
    // to the session cookie. Members returned are scoped to that organization.
    // If better-auth adds orgId to member records, verify it matches ctx.organizationId.
    async listMembers(_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
      const headers = await headersFromRequest()
      const result = await auth.api.listMembers({ headers })

      const data = parseBetterAuthResponse(
        listMembersResponseSchema,
        result,
        'org_setup_failed',
        'listMembers response did not match expected schema',
      )
      return data.members.map(toMemberRecord)
    },

    // better-auth doesn't return orgId on individual member records.
    // The listMembers call is session-scoped to the active org, so the
    // membership is implicitly verified. No cross-tenant risk in practice.
    async getMember(_ctx: AuthContext, memberId: string): Promise<MemberRecord | null> {
      const headers = await headersFromRequest()
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

    // Relies on session-bound organization — better-auth creates the invitation
    // under the active org from the session cookie. No explicit orgId in the body.
    async createInvitation(
      _ctx: AuthContext,
      email: string,
      role: string,
      propertyIds?: ReadonlyArray<string>,
    ): Promise<InvitationId> {
      const headers = await headersFromRequest()
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
      return invitationId(invitation.id)
    },

    async acceptInvitation(id: InvitationId, headers: Headers): Promise<void> {
      await auth.api.acceptInvitation({ headers, body: { invitationId: id } })
    },

    async cancelInvitation(id: InvitationId, headers: Headers): Promise<void> {
      await auth.api.cancelInvitation({ headers, body: { invitationId: id } })
    },

    async listInvitations(_ctx: AuthContext): Promise<ReadonlyArray<InvitationRecord>> {
      const headers = await headersFromRequest()
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
      ctx: AuthContext,
      memberId: string,
      role: string,
    ): Promise<void> {
      // Verify member belongs to the current org before mutating
      const member = await this.getMember(ctx, memberId)
      if (!member) {
        throw identityError('forbidden', 'Member not found in current organization')
      }
      const headers = await headersFromRequest()
      await auth.api.updateMemberRole({
        headers,
        body: {
          memberId,
          role: toBetterAuthRole(role as ReturnType<typeof toDomainRole>),
        },
      })
    },

    async removeMember(ctx: AuthContext, memberId: string): Promise<void> {
      // Verify member belongs to the current org before removing
      const member = await this.getMember(ctx, memberId)
      if (!member) {
        throw identityError('forbidden', 'Member not found in current organization')
      }
      const headers = await headersFromRequest()
      await auth.api.removeMember({
        headers,
        body: { memberIdOrEmail: memberId },
      })
    },

    async getActiveOrg(headers: Headers): Promise<OrganizationRecord | null> {
      const result = await auth.api.getFullOrganization({ headers })
      if (!result) return null
      const org = parseBetterAuthResponse(
        betterAuthOrganizationSchema,
        result,
        'org_setup_failed',
        'getFullOrganization response did not match expected schema',
      )
      return {
        id: org.id,
        name: org.name,
        slug: org.slug,
        logo: org.logo ?? null,
        createdAt: org.createdAt,
      }
    },

    async setActiveOrganization(headers: Headers, organizationId: string): Promise<void> {
      await auth.api.setActiveOrganization({ headers, body: { organizationId } })
    },

    async withOrgLock<T>(
      organizationId: OrganizationId,
      fn: () => Promise<T>,
    ): Promise<T> {
      const lockKey = hashStringToInteger(organizationId as string)
      return db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(${lockKey})`)
        return fn()
      })
    },

    async deleteUser(userId: string): Promise<void> {
      await db.delete(userTable).where(eq(userTable.id, userId))
    },
  }
}

function hashStringToInteger(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash)
}
