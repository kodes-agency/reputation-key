// In-memory IdentityPort fake — for use in use case tests.
// Implements the same port interface so use cases can't tell the difference.
// Extra test-only methods (seed, etc.) allow tests to set up state.

import type {
  IdentityPort,
  MemberRecord,
  InvitationRecord,
  OrganizationRecord,
} from '#/contexts/identity/application/ports/identity.port'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import { identityError } from '#/contexts/identity/domain/errors'

// fallow-ignore-next-line unused-type
export type InMemoryIdentityPort = IdentityPort & {
  /** Seed members for testing. */
  seedMembers: (members: ReadonlyArray<MemberRecord>) => void
  /** Seed invitations for testing. */
  seedInvitations: (invitations: ReadonlyArray<InvitationRecord>) => void
  /** Seed organizations for testing. */
  seedOrganizations: (orgs: ReadonlyArray<OrganizationRecord>) => void
  /** Set the session user returned by getSessionUser (null = no session). */
  setSessionUser: (user: Readonly<{ id: string; email: string }> | null) => void
  /** Calls received by runOnAcceptInvitation. */
  readonly acceptInvitationHookCalls: ReadonlyArray<{
    userId: string
    organizationId: string
    propertyIds: ReadonlyArray<string>
  }>
  /** Access all stored members. */
  readonly allMembers: ReadonlyArray<MemberRecord>
  /** Access all stored invitations. */
  readonly allInvitations: ReadonlyArray<InvitationRecord>
}

// Default org ID used by buildTestAuthContext — seeded members belong here
// unless tests explicitly override.
const DEFAULT_TEST_ORG_ID = 'org-00000000-0000-0000-0000-000000000001'

type StoredMember = MemberRecord & Readonly<{ organizationId: string }>

export function createInMemoryIdentityPort(): InMemoryIdentityPort {
  const members = new Map<string, StoredMember>()
  const invitations = new Map<string, InvitationRecord>()
  const organizations = new Map<string, OrganizationRecord>()
  const customRoles = new Map<string, { role: string }>()
  const hookCalls: Array<{
    userId: string
    organizationId: string
    propertyIds: ReadonlyArray<string>
  }> = []
  let sessionUser: Readonly<{ id: string; email: string }> | null = null

  return {
    async signUp(_name: string, _email: string, _password: string): Promise<string> {
      const id = `user-${members.size + 1}`
      return id
    },

    async listMembers(ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
      return [...members.values()]
        .filter((m) => m.organizationId === ctx.organizationId)
        .map(({ organizationId: _ignored, ...rest }) => rest)
    },

    async getMember(ctx: AuthContext, memberId: string): Promise<MemberRecord | null> {
      const m = members.get(memberId)
      if (!m || m.organizationId !== ctx.organizationId) return null
      const { organizationId: _ignored, ...rest } = m
      return rest
    },

    async listInvitations(_ctx: AuthContext): Promise<ReadonlyArray<InvitationRecord>> {
      return [...invitations.values()]
    },

    async listUserInvitations(
      _headers: Headers,
    ): Promise<ReadonlyArray<InvitationRecord>> {
      return [...invitations.values()]
    },

    async getActiveOrg(_headers: Headers): Promise<OrganizationRecord | null> {
      const org = organizations.get(DEFAULT_TEST_ORG_ID)
      return org ?? null
    },
    async listUserOrganizations(
      _headers: Headers,
    ): Promise<ReadonlyArray<OrganizationRecord>> {
      return Array.from(organizations.values())
    },

    async setActiveOrganization(
      _headers: Headers,
      _organizationId: string,
    ): Promise<void> {
      // Test fake — no-op
    },

    async getSessionUser(
      _headers: Headers,
    ): Promise<Readonly<{ id: string; email: string }> | null> {
      return sessionUser
    },

    async runOnAcceptInvitation(ctx: {
      userId: string
      organizationId: string
      propertyIds: ReadonlyArray<string>
    }): Promise<void> {
      hookCalls.push(ctx)
    },

    async deleteUser(_userId: string): Promise<void> {
      // Test fake — no-op
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
      const key = `${ctx.organizationId as string}:${role}`
      if (customRoles.has(key)) {
        throw identityError('already_exists', `Role "${role}" already exists`)
      }
      customRoles.set(key, { role })
    },

    async updateCustomRole(
      ctx: AuthContext,
      role: string,
      _input: Readonly<{ permissions: ReadonlyArray<Permission>; dataScope: DataScope }>,
    ): Promise<void> {
      // Idempotent in-memory update; mirrors the adapter (no existence check).
      customRoles.set(`${ctx.organizationId as string}:${role.trim().toLowerCase()}`, {
        role: role.trim().toLowerCase(),
      })
    },

    async deleteCustomRole(ctx: AuthContext, role: string): Promise<void> {
      customRoles.delete(`${ctx.organizationId as string}:${role.trim().toLowerCase()}`)
    },

    // ── Test-only helpers ─────────────────────────────────────────────

    seedMembers(ms: ReadonlyArray<MemberRecord>): void {
      for (const m of ms) members.set(m.id, { ...m, organizationId: DEFAULT_TEST_ORG_ID })
    },

    seedInvitations(invs: ReadonlyArray<InvitationRecord>): void {
      for (const inv of invs) invitations.set(inv.id, inv)
    },

    seedOrganizations(orgs: ReadonlyArray<OrganizationRecord>): void {
      for (const org of orgs) organizations.set(org.id, org)
    },

    setSessionUser(user: Readonly<{ id: string; email: string }> | null): void {
      sessionUser = user
    },

    get acceptInvitationHookCalls() {
      return hookCalls
    },

    get allMembers(): ReadonlyArray<MemberRecord> {
      return [...members.values()]
    },

    get allInvitations(): ReadonlyArray<InvitationRecord> {
      return [...invitations.values()]
    },
  }
}
