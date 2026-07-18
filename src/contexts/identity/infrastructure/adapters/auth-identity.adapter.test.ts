// Identity context — auth identity adapter tests
// Tests that createBetterAuthIdentityAdapter correctly wraps better-auth API calls
// and maps data between better-auth's format and our domain records.
// Mocks getAuth() and getRequest() to control the better-auth surface.
// BQC-3.5: the invitation/member/org write paths moved to the atomic
// identity command store; this adapter keeps reads, session/org management,
// and the post-acceptance hook bridge.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId } from '#/shared/domain/ids'

// Mock getAuth with controllable API surface
const mockSignUpEmail = vi.fn()
const mockListMembers = vi.fn()
const mockGetSession = vi.fn()
const mockOnAcceptInvitation = vi.fn().mockResolvedValue(undefined)
const mockListInvitations = vi.fn()
const mockListUserInvitations = vi.fn()
const mockListOrganizations = vi.fn()
const mockSetActiveOrganization = vi.fn()

vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({
    api: {
      signUpEmail: mockSignUpEmail,
      listMembers: mockListMembers,
      listInvitations: mockListInvitations,
      listUserInvitations: mockListUserInvitations,
      listOrganizations: mockListOrganizations,
      setActiveOrganization: mockSetActiveOrganization,
      getSession: mockGetSession,
    },
  }),
  getOnAcceptInvitation: () => mockOnAcceptInvitation,
}))

// Mock getRequest to return null (no request context in tests)
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => null,
}))

const db = {
  transaction: vi.fn(),
  delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
} as unknown as Parameters<typeof createBetterAuthIdentityAdapter>[0]

import { createBetterAuthIdentityAdapter } from './auth-identity.adapter'

const testCtx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'AccountAdmin',
}

beforeEach(() => {
  vi.clearAllMocks()
})
describe('createBetterAuthIdentityAdapter', () => {
  const adapter = createBetterAuthIdentityAdapter(db)

  describe('signUp', () => {
    it('returns user ID on successful sign-up', async () => {
      // Arrange
      mockSignUpEmail.mockResolvedValue({ user: { id: 'new-user-1' } })

      // Act
      const id = await adapter.signUp('Alice', 'alice@test.com', 'password123')

      // Assert
      expect(id).toBe('new-user-1')
      expect(mockSignUpEmail).toHaveBeenCalledWith({
        body: { name: 'Alice', email: 'alice@test.com', password: 'password123' },
      })
    })

    it('throws when sign-up returns no user ID', async () => {
      // Arrange — valid schema shape but empty id triggers the post-parse guard
      mockSignUpEmail.mockResolvedValue({ user: { id: '' } })

      // Act & Assert
      await expect(adapter.signUp('Bob', 'bob@test.com', 'pass')).rejects.toThrow(
        'Sign-up failed: no user ID returned',
      )
    })

    it('throws when sign-up response does not match schema', async () => {
      // Arrange
      mockSignUpEmail.mockResolvedValue(undefined)

      // Act & Assert
      await expect(adapter.signUp('Bob', 'bob@test.com', 'pass')).rejects.toThrow(
        'Sign-up response did not match expected schema',
      )
    })
  })

  describe('listMembers', () => {
    it('maps raw members to MemberRecord with domain roles', async () => {
      // Arrange
      const createdAt = new Date('2026-01-01')
      mockListMembers.mockResolvedValue({
        members: [
          {
            id: 'm-1',
            userId: 'u-1',
            role: 'owner',
            createdAt,
            user: { id: 'u-1', email: 'alice@test.com', name: 'Alice', image: null },
          },
          {
            id: 'm-2',
            userId: 'u-2',
            role: 'member',
            createdAt,
            user: { id: 'u-2', email: 'bob@test.com', name: 'Bob', image: 'img.png' },
          },
        ],
      })

      // Act
      const members = await adapter.listMembers(testCtx)

      // Assert
      expect(members).toHaveLength(2)
      expect(members[0]).toEqual({
        id: 'm-1',
        userId: 'u-1',
        email: 'alice@test.com',
        name: 'Alice',
        role: 'AccountAdmin',
        rawRole: 'owner',
        image: null,
        createdAt,
      })
      expect(members[1].role).toBe('Staff')
      expect(members[1].image).toBe('img.png')
    })
    it('tolerates custom and multi roles without throwing (H2)', async () => {
      // Arrange — a comma-multi owner role and a custom-only role. Both must map to
      // role: null (no built-in Role) while preserving the raw string for display /
      // owner detection. Previously toDomainRoleStrict threw 'unknown_role' here.
      const createdAt = new Date('2026-01-01')
      mockListMembers.mockResolvedValue({
        members: [
          {
            id: 'm-multi',
            userId: 'u-1',
            role: 'owner,editor',
            createdAt,
            user: { id: 'u-1', email: 'multi@test.com', name: 'Multi', image: null },
          },
          {
            id: 'm-custom',
            userId: 'u-2',
            role: 'editor',
            createdAt,
            user: { id: 'u-2', email: 'custom@test.com', name: 'Custom', image: null },
          },
        ],
      })

      // Act
      const members = await adapter.listMembers(testCtx)

      // Assert — no throw; both carry role: null + their raw role string.
      expect(members).toHaveLength(2)
      expect(members[0]).toEqual({
        id: 'm-multi',
        userId: 'u-1',
        email: 'multi@test.com',
        name: 'Multi',
        role: null,
        rawRole: 'owner,editor',
        image: null,
        createdAt,
      })
      expect(members[1]).toEqual({
        id: 'm-custom',
        userId: 'u-2',
        email: 'custom@test.com',
        name: 'Custom',
        role: null,
        rawRole: 'editor',
        image: null,
        createdAt,
      })
    })

    it('returns empty array when no members', async () => {
      // Arrange
      mockListMembers.mockResolvedValue({ members: [] })

      // Act
      const members = await adapter.listMembers(testCtx)

      // Assert
      expect(members).toEqual([])
    })
  })

  describe('getMember', () => {
    it('returns member by ID', async () => {
      // Arrange
      const createdAt = new Date('2026-01-01')
      mockListMembers.mockResolvedValue({
        members: [
          {
            id: 'm-1',
            userId: 'u-1',
            role: 'owner',
            createdAt,
            user: { id: 'u-1', email: 'a@t.com', name: 'A', image: null },
          },
          {
            id: 'm-2',
            userId: 'u-2',
            role: 'member',
            createdAt,
            user: { id: 'u-2', email: 'b@t.com', name: 'B', image: null },
          },
        ],
      })

      // Act
      const member = await adapter.getMember(testCtx, 'm-2')

      // Assert
      expect(member).not.toBeNull()
      expect(member!.id).toBe('m-2')
      expect(member!.name).toBe('B')
    })

    it('returns null when member not found', async () => {
      // Arrange
      mockListMembers.mockResolvedValue({ members: [] })

      // Act
      const member = await adapter.getMember(testCtx, 'nonexistent')

      // Assert
      expect(member).toBeNull()
    })
  })

  describe('getSessionUser', () => {
    it('returns the session user id + email when a session exists', async () => {
      mockGetSession.mockResolvedValue({
        user: { id: 'user-1', email: 'invitee@test.com' },
        session: {},
      })

      const session = await adapter.getSessionUser(new Headers())

      expect(session).toEqual({ id: 'user-1', email: 'invitee@test.com' })
      expect(mockGetSession).toHaveBeenCalledWith({ headers: expect.any(Headers) })
    })

    it('returns null when there is no active session', async () => {
      mockGetSession.mockResolvedValue(null)

      const session = await adapter.getSessionUser(new Headers())

      expect(session).toBeNull()
    })
  })

  describe('runOnAcceptInvitation', () => {
    it('invokes the registered hook with the accepted context', async () => {
      await adapter.runOnAcceptInvitation({
        userId: 'user-1',
        organizationId: 'org-1',
        propertyIds: ['prop-1'],
      })

      expect(mockOnAcceptInvitation).toHaveBeenCalledWith({
        userId: 'user-1',
        organizationId: 'org-1',
        propertyIds: ['prop-1'],
      })
    })

    it('skips the hook when no properties were invited', async () => {
      await adapter.runOnAcceptInvitation({
        userId: 'user-1',
        organizationId: 'org-1',
        propertyIds: [],
      })

      expect(mockOnAcceptInvitation).not.toHaveBeenCalled()
    })

    it('isolates hook failures (post-commit side effect)', async () => {
      mockOnAcceptInvitation.mockRejectedValueOnce(new Error('hook down'))

      await expect(
        adapter.runOnAcceptInvitation({
          userId: 'user-1',
          organizationId: 'org-1',
          propertyIds: ['prop-1'],
        }),
      ).resolves.toBeUndefined()
    })
  })

  describe('listInvitations', () => {
    it('maps raw invitations to InvitationRecord', async () => {
      // Arrange
      const now = new Date('2026-01-01')
      const expires = new Date('2026-01-08')
      mockListInvitations.mockResolvedValue([
        {
          id: 'inv-1',
          email: 'a@t.com',
          role: 'owner',
          status: 'pending',
          expiresAt: expires,
          createdAt: now,
        },
        {
          id: 'inv-2',
          email: 'b@t.com',
          role: 'member',
          status: 'accepted',
          expiresAt: expires,
          createdAt: now,
        },
      ])

      // Act
      const invitations = await adapter.listInvitations(testCtx)

      // Assert
      expect(invitations).toHaveLength(2)
      expect(invitations[0]).toEqual({
        id: 'inv-1',
        email: 'a@t.com',
        role: 'AccountAdmin',
        rawRole: 'owner',
        status: 'pending',
        propertyIds: [],
        expiresAt: expires,
        createdAt: now,
      })
      expect(invitations[1].role).toBe('Staff')
    })

    it('throws when response does not match schema', async () => {
      // Arrange
      mockListInvitations.mockResolvedValue(null)

      // Act & Assert
      await expect(adapter.listInvitations(testCtx)).rejects.toThrow(
        'listInvitations response did not match expected schema',
      )
    })
  })

  describe('listUserInvitations', () => {
    it('maps raw user invitations with organization info', async () => {
      // Arrange
      const now = new Date('2026-01-01')
      const expires = new Date('2026-01-08')
      mockListUserInvitations.mockResolvedValue([
        {
          id: 'inv-1',
          email: 'a@t.com',
          role: 'admin',
          status: 'pending',
          expiresAt: expires,
          createdAt: now,
          organizationId: 'org-99',
          organization: { name: 'Test Org' },
        },
      ])

      // Act
      const invitations = await adapter.listUserInvitations(new Headers())

      // Assert
      expect(invitations).toHaveLength(1)
      expect(invitations[0].organizationId).toBe('org-99')
      expect(invitations[0].organizationName).toBe('Test Org')
      expect(invitations[0].role).toBe('PropertyManager')
    })
  })

  describe('setActiveOrganization', () => {
    it('calls setActiveOrganization API', async () => {
      // Arrange
      mockSetActiveOrganization.mockResolvedValue(undefined)
      const headers = new Headers()

      // Act
      await adapter.setActiveOrganization(headers, 'org-1')

      // Assert
      expect(mockSetActiveOrganization).toHaveBeenCalledWith({
        headers,
        body: { organizationId: 'org-1' },
      })
    })
  })
})
