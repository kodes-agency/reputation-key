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
import type { Role } from '#/shared/domain/roles'

export type InMemoryIdentityPort = IdentityPort & {
  /** Seed members for testing. */
  seedMembers: (members: ReadonlyArray<MemberRecord>) => void
  /** Seed invitations for testing. */
  seedInvitations: (invitations: ReadonlyArray<InvitationRecord>) => void
  /** Seed organizations for testing. */
  seedOrganizations: (orgs: ReadonlyArray<OrganizationRecord>) => void
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

    async createInvitation(
      _ctx: AuthContext,
      email: string,
      role: string,
      _propertyIds?: ReadonlyArray<string>,
    ): Promise<string> {
      const id = `inv-${invitations.size + 1}`
      invitations.set(id, {
        id,
        email,
        role: role as Role,
        status: 'pending',
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      })
      return id
    },

    async acceptInvitation(_invitationId: string, _headers: Headers): Promise<void> {
      // Test fake — no-op
    },

    async rejectInvitation(_invitationId: string, _headers: Headers): Promise<void> {
      // Test fake — no-op
    },

    async listInvitations(_ctx: AuthContext): Promise<ReadonlyArray<InvitationRecord>> {
      return [...invitations.values()]
    },

    async listUserInvitations(
      _headers: Headers,
    ): Promise<ReadonlyArray<InvitationRecord>> {
      return [...invitations.values()]
    },

    async updateMemberRole(
      _ctx: AuthContext,
      memberId: string,
      role: string,
    ): Promise<void> {
      const member = members.get(memberId)
      if (member) {
        members.set(memberId, { ...member, role: role as Role })
      }
    },

    async removeMember(_ctx: AuthContext, memberId: string): Promise<void> {
      members.delete(memberId)
    },

    async listUserOrganizations(
      _headers: Headers,
    ): Promise<ReadonlyArray<OrganizationRecord>> {
      return [...organizations.values()]
    },

    async setActiveOrganization(
      _headers: Headers,
      _organizationId: string,
    ): Promise<void> {
      // Test fake — no-op
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

    get allMembers(): ReadonlyArray<MemberRecord> {
      return [...members.values()]
    },

    get allInvitations(): ReadonlyArray<InvitationRecord> {
      return [...invitations.values()]
    },
  }
}
