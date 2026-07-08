// Identity context — auth identity adapter tests
// Tests that createBetterAuthIdentityAdapter correctly wraps better-auth API calls
// and maps data between better-auth's format and our domain records.
// Mocks getAuth() and getRequest() to control the better-auth surface.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId, invitationId } from '#/shared/domain/ids'
import { isIdentityError } from '../../domain/errors'

// Mock getAuth with controllable API surface
const mockSignUpEmail = vi.fn()
const mockListMembers = vi.fn()
const mockCreateInvitation = vi.fn()
const mockAcceptInvitation = vi.fn()
const mockGetSession = vi.fn()
const mockOnAcceptInvitation = vi.fn().mockResolvedValue(undefined)
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
      getSession: mockGetSession,
    },
  }),
  getOnAcceptInvitation: () => mockOnAcceptInvitation,
}))

// Mock getRequest to return null (no request context in tests)
vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => null,
}))

// Mock auth schema (adapter imports user table)
vi.mock('#/shared/db/schema/auth', () => ({
  user: { id: 'id' },
  invitation: { __table: 'invitation' },
  member: { __table: 'member' },
  organizationRole: { __table: 'organizationRole' },
}))

vi.mock('#/shared/db/schema/dac.schema', () => ({
  organizationRolePolicy: { __table: 'organizationRolePolicy' },
}))

// Mock db for createBetterAuthIdentityAdapter
// Per-test fixture data keyed by table marker; the mock tx returns it from select chains.
let tableData: Record<string, unknown[]> = {}
const mockTx = {
  execute: vi.fn().mockResolvedValue(undefined),
  select: vi.fn(() => ({
    from: vi.fn((table: { __table?: string }) => {
      const data = tableData[table.__table ?? ''] ?? []
      // `.where()` is awaitable (yields the rows) AND carries `.for()` (FOR UPDATE).
      const whereResult = Object.assign(Promise.resolve(data), {
        for: vi.fn(() => Promise.resolve(data)),
      })
      return { where: vi.fn(() => whereResult) }
    }),
  })),
  insert: vi.fn(() => ({ values: vi.fn().mockResolvedValue(undefined) })),
  update: vi.fn(() => ({
    set: vi.fn(() => ({ where: vi.fn().mockResolvedValue(undefined) })),
  })),
}
const db = {
  transaction: vi.fn((fn: (tx: typeof mockTx) => Promise<unknown>) => fn(mockTx)),
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
  tableData = {}
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

    it('preserves null user image', async () => {
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
    const acceptor = { id: 'user-1', email: 'invitee@test.com' }
    const future = new Date('2027-01-08')
    const past = new Date('2020-01-01')

    const seedInvitation = (
      overrides: Partial<{
        email: string
        role: string | null
        status: string
        expiresAt: Date
        propertyIds: string
      }> = {},
    ) => {
      tableData.invitation = [
        {
          id: 'inv-1',
          organizationId: 'org-1',
          email: 'invitee@test.com',
          role: 'member',
          status: 'pending',
          expiresAt: future,
          propertyIds: JSON.stringify(['prop-1']),
          createdAt: new Date('2026-01-01'),
          ...overrides,
        },
      ]
    }

    beforeEach(() => {
      mockGetSession.mockResolvedValue({ user: acceptor, session: {} })
    })

    it('creates the member, marks accepted, and invokes the property-assignment hook', async () => {
      seedInvitation()
      const result = await adapter.acceptInvitation(invitationId('inv-1'), new Headers())

      expect(result).toEqual({
        organizationId: organizationId('org-1'),
        propertyIds: ['prop-1'],
      })
      expect(mockOnAcceptInvitation).toHaveBeenCalledWith({
        userId: 'user-1',
        organizationId: 'org-1',
        propertyIds: ['prop-1'],
      })
    })

    it('rejects when the acceptor email does not match the invitation', async () => {
      seedInvitation({ email: 'other@test.com' })
      await expect(
        adapter.acceptInvitation(invitationId('inv-1'), new Headers()),
      ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'forbidden')
      expect(mockOnAcceptInvitation).not.toHaveBeenCalled()
    })

    it('rejects an expired invitation', async () => {
      seedInvitation({ expiresAt: past })
      await expect(
        adapter.acceptInvitation(invitationId('inv-1'), new Headers()),
      ).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
      )
    })

    it('rejects an already-accepted invitation', async () => {
      seedInvitation({ status: 'accepted' })
      await expect(
        adapter.acceptInvitation(invitationId('inv-1'), new Headers()),
      ).rejects.toSatisfy(
        (e: unknown) => isIdentityError(e) && e.code === 'invitation_not_found',
      )
    })

    it('rejects when the custom role no longer exists (marks invitation rejected)', async () => {
      seedInvitation({ role: 'content-manager' })
      // organizationRole + policy fixtures stay empty → role is "deleted"
      await expect(
        adapter.acceptInvitation(invitationId('inv-1'), new Headers()),
      ).rejects.toSatisfy((e: unknown) => isIdentityError(e) && e.code === 'forbidden')
      expect(mockOnAcceptInvitation).not.toHaveBeenCalled()
    })

    it('accepts when the custom role still exists as orgRole + policy', async () => {
      seedInvitation({ role: 'content-manager' })
      tableData.organizationRole = [{ id: 'r1' }]
      tableData.organizationRolePolicy = [{ id: 'p1' }]
      const result = await adapter.acceptInvitation(invitationId('inv-1'), new Headers())

      expect(result.organizationId).toEqual(organizationId('org-1'))
      expect(mockOnAcceptInvitation).toHaveBeenCalledWith({
        userId: 'user-1',
        organizationId: 'org-1',
        propertyIds: ['prop-1'],
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

  describe('updateMemberRole', () => {
    it('calls updateMemberRole API with mapped role', async () => {
      // Arrange
      mockListMembers.mockResolvedValue({
        members: [
          {
            id: 'm-1',
            userId: 'user-1',
            role: 'member',
            createdAt: new Date(),
            user: { id: 'user-1', email: 'a@t.com', name: 'A', image: null },
          },
        ],
      })
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
      mockListMembers.mockResolvedValue({
        members: [
          {
            id: 'm-1',
            userId: 'user-1',
            role: 'member',
            createdAt: new Date(),
            user: { id: 'user-1', email: 'a@t.com', name: 'A', image: null },
          },
        ],
      })
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
