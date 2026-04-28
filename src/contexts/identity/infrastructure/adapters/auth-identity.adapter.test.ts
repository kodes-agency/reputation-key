// Identity context — auth identity adapter tests
// Tests that createAuthIdentityAdapter correctly wraps better-auth API calls
// and maps data between better-auth's format and our domain records.
// Mocks getAuth() and getRequest() to control the better-auth surface.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId } from '#/shared/domain/ids'

// Mock getAuth with controllable API surface
const mockSignUpEmail = vi.fn()
const mockListMembers = vi.fn()
const mockCreateInvitation = vi.fn()
const mockAcceptInvitation = vi.fn()
const mockRejectInvitation = vi.fn()
const mockListInvitations = vi.fn()
const mockListUserInvitations = vi.fn()
const mockUpdateMemberRole = vi.fn()
const mockRemoveMember = vi.fn()
const mockListOrganizations = vi.fn()
const mockSetActiveOrganization = vi.fn()

vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({
    api: {
      signUpEmail: mockSignUpEmail,
      listMembers: mockListMembers,
      createInvitation: mockCreateInvitation,
      acceptInvitation: mockAcceptInvitation,
      rejectInvitation: mockRejectInvitation,
      listInvitations: mockListInvitations,
      listUserInvitations: mockListUserInvitations,
      updateMemberRole: mockUpdateMemberRole,
      removeMember: mockRemoveMember,
      listOrganizations: mockListOrganizations,
      setActiveOrganization: mockSetActiveOrganization,
    },
  }),
}))

// Mock getRequest to return null (no request context in tests)
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => null,
}))

import { createAuthIdentityAdapter } from './auth-identity.adapter'

const testCtx: AuthContext = {
  userId: userId('user-1'),
  organizationId: organizationId('org-1'),
  role: 'AccountAdmin',
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createAuthIdentityAdapter', () => {
  const adapter = createAuthIdentityAdapter()

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
        image: null,
        createdAt,
      })
      expect(members[1].role).toBe('Staff')
      expect(members[1].image).toBe('img.png')
    })

    it('returns empty array when no members', async () => {
      // Arrange
      mockListMembers.mockResolvedValue({ members: [] })

      // Act
      const members = await adapter.listMembers(testCtx)

      // Assert
      expect(members).toEqual([])
    })

    it('handles null user image with default', async () => {
      // Arrange
      const createdAt = new Date('2026-01-01')
      mockListMembers.mockResolvedValue({
        members: [
          {
            id: 'm-1',
            userId: 'u-1',
            role: 'admin',
            createdAt,
            user: { id: 'u-1', email: 'a@t.com', name: 'A', image: null },
          },
        ],
      })

      // Act
      const members = await adapter.listMembers(testCtx)

      // Assert
      expect(members[0].image).toBeNull()
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

  describe('createInvitation', () => {
    it('creates invitation and returns ID', async () => {
      // Arrange
      mockCreateInvitation.mockResolvedValue({
        id: 'inv-1',
        email: 'new@test.com',
        role: 'admin',
        status: 'pending',
        expiresAt: new Date('2026-01-08'),
        createdAt: new Date('2026-01-01'),
      })

      // Act
      const id = await adapter.createInvitation(
        testCtx,
        'new@test.com',
        'PropertyManager',
        ['prop-1'],
      )

      // Assert
      expect(id).toBe('inv-1')
      expect(mockCreateInvitation).toHaveBeenCalledWith({
        headers: expect.any(Headers),
        body: {
          email: 'new@test.com',
          role: 'admin',
          propertyIds: JSON.stringify(['prop-1']),
        },
      })
    })

    it('returns empty string when no ID in response', async () => {
      // Arrange — valid schema shape but missing id
      mockCreateInvitation.mockResolvedValue({
        id: '',
        email: 'new@test.com',
        role: 'member',
        status: 'pending',
        expiresAt: new Date('2026-01-08'),
        createdAt: new Date('2026-01-01'),
      })

      // Act
      const id = await adapter.createInvitation(testCtx, 'new@test.com', 'Staff')

      // Assert
      expect(id).toBe('')
    })

    it('omits propertyIds when empty array', async () => {
      // Arrange
      mockCreateInvitation.mockResolvedValue({
        id: 'inv-2',
        email: 'x@test.com',
        role: 'member',
        status: 'pending',
        expiresAt: new Date('2026-01-08'),
        createdAt: new Date('2026-01-01'),
      })

      // Act
      await adapter.createInvitation(testCtx, 'x@test.com', 'Staff', [])

      // Assert
      expect(mockCreateInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ propertyIds: undefined }),
        }),
      )
    })

    it('omits propertyIds when not provided', async () => {
      // Arrange
      mockCreateInvitation.mockResolvedValue({
        id: 'inv-3',
        email: 'x@test.com',
        role: 'member',
        status: 'pending',
        expiresAt: new Date('2026-01-08'),
        createdAt: new Date('2026-01-01'),
      })

      // Act
      await adapter.createInvitation(testCtx, 'x@test.com', 'Staff')

      // Assert
      expect(mockCreateInvitation).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ propertyIds: undefined }),
        }),
      )
    })
  })

  describe('acceptInvitation', () => {
    it('calls acceptInvitation API with correct params', async () => {
      // Arrange
      mockAcceptInvitation.mockResolvedValue(undefined)
      const headers = new Headers()

      // Act
      await adapter.acceptInvitation('inv-1', headers)

      // Assert
      expect(mockAcceptInvitation).toHaveBeenCalledWith({
        headers,
        body: { invitationId: 'inv-1' },
      })
    })
  })

  describe('rejectInvitation', () => {
    it('calls rejectInvitation API with correct params', async () => {
      // Arrange
      mockRejectInvitation.mockResolvedValue(undefined)
      const headers = new Headers()

      // Act
      await adapter.rejectInvitation('inv-1', headers)

      // Assert
      expect(mockRejectInvitation).toHaveBeenCalledWith({
        headers,
        body: { invitationId: 'inv-1' },
      })
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
        status: 'pending',
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

  describe('updateMemberRole', () => {
    it('calls updateMemberRole API with mapped role', async () => {
      // Arrange
      mockUpdateMemberRole.mockResolvedValue(undefined)

      // Act
      await adapter.updateMemberRole(testCtx, 'm-1', 'PropertyManager')

      // Assert
      expect(mockUpdateMemberRole).toHaveBeenCalledWith({
        headers: expect.any(Headers),
        body: { memberId: 'm-1', role: 'admin' },
      })
    })
  })

  describe('removeMember', () => {
    it('calls removeMember API with correct memberId', async () => {
      // Arrange
      mockRemoveMember.mockResolvedValue(undefined)

      // Act
      await adapter.removeMember(testCtx, 'm-1')

      // Assert
      expect(mockRemoveMember).toHaveBeenCalledWith({
        headers: expect.any(Headers),
        body: { memberIdOrEmail: 'm-1' },
      })
    })
  })

  describe('listUserOrganizations', () => {
    it('maps raw organizations to OrganizationRecord', async () => {
      // Arrange
      const now = new Date('2026-01-01')
      mockListOrganizations.mockResolvedValue([
        {
          id: 'org-1',
          name: 'Org One',
          slug: 'org-one',
          logo: 'logo.png',
          createdAt: now,
        },
        { id: 'org-2', name: 'Org Two', slug: 'org-two', logo: null, createdAt: now },
      ])

      // Act
      const orgs = await adapter.listUserOrganizations(new Headers())

      // Assert
      expect(orgs).toHaveLength(2)
      expect(orgs[0]).toEqual({
        id: 'org-1',
        name: 'Org One',
        slug: 'org-one',
        logo: 'logo.png',
        createdAt: now,
      })
      expect(orgs[1].logo).toBeNull()
    })

    it('throws when response does not match schema', async () => {
      // Arrange
      mockListOrganizations.mockResolvedValue(null)

      // Act & Assert
      await expect(adapter.listUserOrganizations(new Headers())).rejects.toThrow(
        'listOrganizations response did not match expected schema',
      )
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
