// Better Auth registration, invitation and session adapter tests.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getAuth with controllable API surface
const mockSignUpEmail = vi.fn()
const mockGetSession = vi.fn()
const mockListUserInvitations = vi.fn()
const mockSetActiveOrganization = vi.fn()

vi.mock('#/shared/auth/auth', () => ({
  getAuth: () => ({
    api: {
      signUpEmail: mockSignUpEmail,
      listUserInvitations: mockListUserInvitations,
      setActiveOrganization: mockSetActiveOrganization,
      getSession: mockGetSession,
    },
  }),
}))

const db = {} as Parameters<typeof createBetterAuthIdentityAdapter>[0]

import { createBetterAuthIdentityAdapter } from './auth-identity.adapter'

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

    it('accepts an exact preallocated user ID for recoverable registration', async () => {
      mockSignUpEmail.mockResolvedValue({ user: { id: 'preallocated-user-1' } })

      await expect(
        adapter.signUp('Alice', 'alice@test.com', 'password123', {
          userId: 'preallocated-user-1',
          credentialAccountId: 'preallocated-account-1',
          initialSessionId: 'preallocated-session-1',
        }),
      ).resolves.toBe('preallocated-user-1')
    })

    it('fails closed when the provider does not use the preallocated user ID', async () => {
      mockSignUpEmail.mockResolvedValue({ user: { id: 'different-user' } })

      await expect(
        adapter.signUp('Alice', 'alice@test.com', 'password123', {
          userId: 'preallocated-user-1',
          credentialAccountId: 'preallocated-account-1',
          initialSessionId: 'preallocated-session-1',
        }),
      ).rejects.toThrow('provider returned an unexpected user ID')
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
