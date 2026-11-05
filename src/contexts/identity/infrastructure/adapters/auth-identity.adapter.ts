// Identity context — better-auth adapter implementing the IdentityPort.
// Per architecture: "Infrastructure implements ports defined by application."
// Wraps better-auth's API calls behind the port interface so use cases
// remain testable with in-memory fakes.
//
// Invitation and member writes belong to the atomic Identity command store.
// This adapter handles reads, registration and session Organization selection.

import type {
  MemberRecord,
  IdentityPort,
  InvitationRecord,
  OrganizationRecord,
} from '../../application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import { getAuth } from '#/shared/auth/auth'
import { toDomainRole } from '#/shared/domain/roles'
import { identityError } from '../../domain/errors'
import { organizationId } from '#/shared/domain/ids'
import {
  parseBetterAuthResponse,
  signUpResponseSchema,
  listMembersResponseSchema,
  listUserInvitationsResponseSchema,
  betterAuthOrganizationSchema,
} from './better-auth-schemas'
import { runWithRegistrationAuthIds } from '#/shared/auth/registration-user-id'
import type { RegistrationAuthIds } from '#/shared/domain/registration-auth-ids'
import type { RequestContextPort } from '../../application/ports/request-context.port'

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
    rawRole: m.role,
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

type BetterAuthIdentityAdapterDeps = Readonly<{
  /** ARC-03-T13: the ambient request context, injected. Infrastructure no
   * longer reaches the web framework itself. */
  requestContext: RequestContextPort
}>

export const createBetterAuthIdentityAdapter = (
  deps: BetterAuthIdentityAdapterDeps,
): IdentityPort => {
  const auth = getAuth()
  // Local member lookup — used by getMember.
  // Calling a closure-captured function (not `this.getMember`) keeps these methods
  // safe to destructure / pass as callbacks, per the functional-style rule.
  const getMemberImpl = async (memberId: string): Promise<MemberRecord | null> => {
    const headers = await deps.requestContext.currentRequestHeaders()
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

    // Relies on better-auth session scoping — the active organization is bound
    // to the session cookie. Members returned are scoped to that organization.
    // If better-auth adds orgId to member records, verify it matches ctx.organizationId.
    async listMembers(_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
      const headers = await deps.requestContext.currentRequestHeaders()
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
