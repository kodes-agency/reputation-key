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

export function createInMemoryIdentityPort(): InMemoryIdentityPort {
  const members = new Map<string, MemberRecord>()
  const invitations = new Map<string, InvitationRecord>()
  const organizations = new Map<string, OrganizationRecord>()

  return {
    async listMembers(_ctx: AuthContext): Promise<ReadonlyArray<MemberRecord>> {
      return [...members.values()]
    },

    async getMember(_ctx: AuthContext, memberId: string): Promise<MemberRecord | null> {
      return members.get(memberId) ?? null
    },

    async createInvitation(
      _ctx: AuthContext,
      email: string,
      role: string,
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
      for (const m of ms) members.set(m.id, m)
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
