// Identity context — better-auth adapter implementing the IdentityPort.
// Per architecture: "Infrastructure implements ports defined by application."
// Wraps better-auth's API calls behind the port interface so use cases
// remain testable with in-memory fakes.

import type { Database } from '#/shared/db'
import { and, eq, sql } from 'drizzle-orm'
import { member, organizationRole, user as userTable } from '#/shared/db/schema/auth'
import { getLogger } from '#/shared/observability/logger'
import { organizationRolePolicy } from '#/shared/db/schema/dac.schema'
import { buildPermissionStatement } from '#/shared/auth/permission-catalogue'
import { randomUUID } from 'crypto'
import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import type {
  IdentityPort,
  MemberRecord,
  InvitationRecord,
  OrganizationRecord,
} from '../../application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getAuth } from '#/shared/auth/auth'
import { toDomainRoleStrict, toBetterAuthRole, type Role } from '#/shared/domain/roles'
import { identityError } from '../../domain/errors'
import { organizationId, invitationId } from '#/shared/domain/ids'
import type { InvitationId, OrganizationId } from '#/shared/domain/ids'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
  listMembersResponseSchema,
  createInvitationResponseSchema,
  acceptInvitationResponseSchema,
  listInvitationsResponseSchema,
  listUserInvitationsResponseSchema,
  listOrganizationsResponseSchema,
  betterAuthOrganizationSchema,
} from './better-auth-schemas'
import { extractResponseSlaHours } from '#/shared/domain/response-sla'

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
    role: toDomainRoleStrict(m.role),
    image: m.user.image ?? null,
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
  billingCompanyName?: string | null | undefined
  billingAddress?: string | null | undefined
  billingCity?: string | null | undefined
  billingPostalCode?: string | null | undefined
  billingCountry?: string | null | undefined
  responseSlaHours?: number | null | undefined
}): OrganizationRecord {
  return {
    id: org.id,
    name: org.name,
    slug: org.slug,
    logo: org.logo ?? null,
    createdAt: org.createdAt,
    contactEmail: org.contactEmail ?? null,
    billingCompanyName: org.billingCompanyName ?? null,
    billingAddress: org.billingAddress ?? null,
    billingCity: org.billingCity ?? null,
    billingPostalCode: org.billingPostalCode ?? null,
    billingCountry: org.billingCountry ?? null,
    responseSlaHours: extractResponseSlaHours(org),
  }
}

export const createBetterAuthIdentityAdapter = (db: Database): IdentityPort => {
  const auth = getAuth()
  // Local member lookup — used by getMember, updateMemberRole, and removeMember.
  // Calling a closure-captured function (not `this.getMember`) keeps these methods
  // safe to destructure / pass as callbacks, per the functional-style rule.
  const getMemberImpl = async (memberId: string): Promise<MemberRecord | null> => {
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
  }
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
      return getMemberImpl(memberId)
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
          role: toBetterAuthRole(role as Role),
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
    async acceptInvitation(
      id: InvitationId,
      headers: Headers,
    ): Promise<{ organizationId: OrganizationId; propertyIds: ReadonlyArray<string> }> {
      // Fetch propertyIds before accepting — the invitation's status changes after.
      const listResult = await auth.api.listUserInvitations({ headers })
      const list = parseBetterAuthResponse(
        listUserInvitationsResponseSchema,
        listResult,
        'org_setup_failed',
        'listUserInvitations response did not match expected schema',
      )
      const inv = list.find((i) => i.id === id)
      const propertyIds = parsePropertyIds(inv?.propertyIds)

      const result = await auth.api.acceptInvitation({
        headers,
        body: { invitationId: id },
      })
      const data = parseBetterAuthResponse(
        acceptInvitationResponseSchema,
        result,
        'org_setup_failed',
        'acceptInvitation response did not match expected schema',
      )
      return { organizationId: organizationId(data.organizationId), propertyIds }
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
          role: toDomainRoleStrict(inv.role),
          status: inv.status,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
          propertyIds: parsePropertyIds(inv.propertyIds),
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
          role: toDomainRoleStrict(inv.role),
          status: inv.status,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
          organizationId: inv.organizationId
            ? organizationId(inv.organizationId)
            : undefined,
          organizationName: inv.organization?.name,
          propertyIds: parsePropertyIds(inv.propertyIds),
        }),
      )
    },

    async updateMemberRole(
      ctx: AuthContext,
      memberId: string,
      role: string,
    ): Promise<void> {
      // Verify member belongs to the current org before mutating
      const memberRow = await getMemberImpl(memberId)
      if (!memberRow) {
        throw identityError('forbidden', 'Member not found in current organization')
      }
      // Last-owner guard: block demoting the sole owner. The DB BEFORE-trigger is the
      // concurrency backstop for direct-DB; this is the app-path UX guard (§4).
      const wouldRemoveOwner =
        isOwnerToken(memberRow.role) && !isOwnerToken(toBetterAuthRole(role as Role))
      await assertNotLastOwner(db, ctx.organizationId as string, wouldRemoveOwner)
      const headers = await headersFromRequest()
      await auth.api.updateMemberRole({
        headers,
        body: {
          memberId,
          role: toBetterAuthRole(role as Role),
        },
      })
    },

    async removeMember(ctx: AuthContext, memberId: string): Promise<void> {
      // Verify member belongs to the current org before removing
      const memberRow = await getMemberImpl(memberId)
      if (!memberRow) {
        throw identityError('forbidden', 'Member not found in current organization')
      }
      await assertNotLastOwner(
        db,
        ctx.organizationId as string,
        isOwnerToken(memberRow.role),
      )
      const headers = await headersFromRequest()
      await auth.api.removeMember({
        headers,
        body: { memberIdOrEmail: memberId },
      })
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

    async listUserOrganizations(
      headers: Headers,
    ): Promise<ReadonlyArray<OrganizationRecord>> {
      const result = await auth.api.listOrganizations({ headers })
      const orgs = parseBetterAuthResponse(
        listOrganizationsResponseSchema,
        result,
        'org_setup_failed',
        'listOrganizations response did not match expected schema',
      )
      return orgs.map(toOrganizationRecord)
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

    async createCustomRole(
      ctx: AuthContext,
      input: Readonly<{
        role: string
        permissions: ReadonlyArray<Permission>
        dataScope: DataScope
      }>,
    ): Promise<void> {
      const role = input.role.trim().toLowerCase()
      try {
        await db.transaction(async (tx) => {
          await tx.insert(organizationRole).values({
            id: randomUUID(),
            organizationId: ctx.organizationId as string,
            role,
            permission: JSON.stringify(buildPermissionStatement(input.permissions)),
          })
          await tx.insert(organizationRolePolicy).values({
            organizationId: ctx.organizationId as string,
            role,
            dataScope: input.dataScope,
          })
        })
      } catch (e) {
        if (isUniqueViolation(e)) {
          throw identityError('already_exists', `Role "${role}" already exists`)
        }
        throw e
      }
    },

    async updateCustomRole(
      ctx: AuthContext,
      role: string,
      input: Readonly<{
        permissions: ReadonlyArray<Permission>
        dataScope: DataScope
      }>,
    ): Promise<void> {
      const r = role.trim().toLowerCase()
      const permission = JSON.stringify(buildPermissionStatement(input.permissions))
      await db.transaction(async (tx) => {
        await tx
          .update(organizationRole)
          .set({ permission, updatedAt: new Date() })
          .where(
            and(
              eq(organizationRole.organizationId, ctx.organizationId as string),
              eq(organizationRole.role, r),
            ),
          )
        await tx
          .update(organizationRolePolicy)
          .set({ dataScope: input.dataScope, updatedAt: new Date() })
          .where(
            and(
              eq(organizationRolePolicy.organizationId, ctx.organizationId as string),
              eq(organizationRolePolicy.role, r),
            ),
          )
      })
    },

    async deleteCustomRole(ctx: AuthContext, role: string): Promise<void> {
      const r = role.trim().toLowerCase()
      await db.transaction(async (tx) => {
        await tx
          .delete(organizationRole)
          .where(
            and(
              eq(organizationRole.organizationId, ctx.organizationId as string),
              eq(organizationRole.role, r),
            ),
          )
        await tx
          .delete(organizationRolePolicy)
          .where(
            and(
              eq(organizationRolePolicy.organizationId, ctx.organizationId as string),
              eq(organizationRolePolicy.role, r),
            ),
          )
      })
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

/** True when a Postgres unique-constraint violation (SQLSTATE 23505) caused the error. */
function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code: unknown }).code === '23505'
  )
}

/** True when a member's (possibly multi-role, comma-delimited) role string grants owner. */
function isOwnerToken(role: string): boolean {
  return role
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .includes('owner')
}

/**
 * Last-owner guard (§4). When `wouldRemoveOwner`, counts org owners under an advisory
 * lock and throws `last_owner` if the change would leave zero. The DB BEFORE-trigger is
 * the concurrency backstop for direct-DB writes; this is the app-path guard.
 */
async function assertNotLastOwner(
  db: Database,
  orgId: string,
  wouldRemoveOwner: boolean,
): Promise<void> {
  if (!wouldRemoveOwner) return
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${hashStringToInteger(orgId)})`)
    const rows = await tx
      .select({ role: member.role })
      .from(member)
      .where(eq(member.organizationId, orgId))
    const owners = rows.filter((r) => isOwnerToken(r.role)).length
    if (owners <= 1) {
      throw identityError(
        'last_owner',
        'Cannot remove the last owner of the organization',
      )
    }
  })
}
