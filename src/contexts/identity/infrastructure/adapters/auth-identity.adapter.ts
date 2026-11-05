// Identity reads use organization-scoped SQL; registration and session management
// delegate to Better Auth. Membership writes belong to the identity command store.

import type { Database } from '#/shared/db'
import { and, count, eq, ne } from 'drizzle-orm'
import { member, user } from '#/shared/db/schema/auth'
import type {
  MemberRecord,
  MemberListOptions,
  IdentityPort,
  InvitationRecord,
  OrganizationRecord,
} from '../../application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getAuth } from '#/shared/auth/auth'
import { isOwnerToken, toDomainRole } from '#/shared/domain/roles'
import { identityError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
  listUserInvitationsResponseSchema,
  betterAuthOrganizationSchema,
} from './better-auth-schemas'
import { runWithRegistrationAuthIds } from '#/shared/auth/registration-user-id'
import type { RegistrationAuthIds } from '#/shared/domain/registration-auth-ids'

const memberFields = {
  id: member.id,
  userId: member.userId,
  role: member.role,
  email: user.email,
  name: user.name,
  image: user.image,
  createdAt: member.createdAt,
}

function toMemberRecord(
  m: Omit<MemberRecord, 'role' | 'rawRole'> & { role: string },
): MemberRecord {
  return {
    id: m.id,
    userId: m.userId,
    email: m.email,
    name: m.name,
    role: toDomainRole(m.role),
    rawRole: m.role,
    image: m.image,
    createdAt: m.createdAt,
  }
}

/** Parse the JSON-encoded propertyIds string from an invitation. */
function parsePropertyIds(raw: string | null | undefined): ReadonlyArray<string> {
  if (!raw || typeof raw !== 'string') return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Map a validated better-auth organization to our OrganizationRecord. */
function toOrganizationRecord(org: {
  id: string
  name: string
  slug: string
  logo?: string | null | undefined
  createdAt: Date
  contactEmail?: string | null | undefined
}): OrganizationRecord {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logo: org.logo ?? null,
    createdAt: org.createdAt,
    contactEmail: org.contactEmail ?? null,
  }
}

export const createBetterAuthIdentityAdapter = (db: Database): IdentityPort => {
  const auth = getAuth()
  return {
    async signUp(
      name: string,
      email: string,
      password: string,
      expectedAuthIds?: RegistrationAuthIds,
    ): Promise<string> {
      const invokeProvider = () =>
        auth.api.signUpEmail({
          body: { name, email, password },
        })
      const result = expectedAuthIds
        ? await runWithRegistrationAuthIds(expectedAuthIds, invokeProvider)
        : await invokeProvider()
      const data = parseBetterAuthResponse(
        signUpResponseSchema,
        result,
        'registration_failed',
        'Sign-up response did not match expected schema',
      )
      if (!data.user.id) {
        throw identityError('registration_failed', 'Sign-up failed: no user ID returned')
      }
      if (expectedAuthIds && data.user.id !== expectedAuthIds.userId) {
        throw identityError(
          'registration_failed',
          'Sign-up failed: provider returned an unexpected user ID',
        )
      }
      return data.user.id
    },

    async listMembers(
      ctx: AuthContext,
      options?: MemberListOptions,
    ): Promise<ReadonlyArray<MemberRecord>> {
      let query = db
        .select(memberFields)
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(
            eq(member.organizationId, ctx.organizationId),
            options?.excludeStaff ? ne(member.role, 'member') : undefined,
          ),
        )
        .orderBy(member.createdAt, member.id)
        .$dynamic()
      if (options?.limit !== undefined) query = query.limit(options.limit)
      if (options?.offset !== undefined) query = query.offset(options.offset)
      return (await query).map(toMemberRecord)
    },

    async countOwners(ctx: AuthContext): Promise<number> {
      const counts = await db
        .select({ role: member.role, members: count() })
        .from(member)
        .where(eq(member.organizationId, ctx.organizationId))
        .groupBy(member.role)
      return counts.reduce(
        (owners, row) => owners + (isOwnerToken(row.role) ? row.members : 0),
        0,
      )
    },

    async getMember(ctx: AuthContext, memberId: string): Promise<MemberRecord | null> {
      const [result] = await db
        .select(memberFields)
        .from(member)
        .innerJoin(user, eq(member.userId, user.id))
        .where(
          and(eq(member.organizationId, ctx.organizationId), eq(member.id, memberId)),
        )
        .limit(1)
      return result ? toMemberRecord(result) : null
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
      return invitations.map((inv): InvitationRecord => ({
        id: inv.id,
        email: inv.email,
        role: toDomainRole(inv.role),
        rawRole: inv.role,
        status: inv.status,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        organizationId: inv.organizationId
          ? organizationId(inv.organizationId)
          : undefined,
        organizationName: inv.organization?.name,
        propertyIds: parsePropertyIds(inv.propertyIds),
      }))
    },

    async getActiveOrg(headers: Headers): Promise<OrganizationRecord | null> {
      let result: unknown
      try {
        result = await auth.api.getFullOrganization({ headers })
      } catch (e) {
        // No active org is a valid state — return null instead of throwing.
        if (
          e instanceof Error &&
          'code' in e &&
          (e as { code: string }).code === 'no_active_org'
        ) {
          return null
        }
        throw e
      }
      if (!result) return null
      const org = parseBetterAuthResponse(
        betterAuthOrganizationSchema,
        result,
        'org_setup_failed',
        'getFullOrganization response did not match expected schema',
      )
      return toOrganizationRecord(org)
    },

    async setActiveOrganization(headers: Headers, organizationId: string): Promise<void> {
      await auth.api.setActiveOrganization({ headers, body: { organizationId } })
    },

    async getSessionUser(
      headers: Headers,
    ): Promise<Readonly<{ id: string; email: string; name: string }> | null> {
      const session = await auth.api.getSession({ headers })
      if (!session) return null
      return {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
      }
    },
  }
}
