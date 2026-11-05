// Better Auth registration, invitation, session and custom-role adapter tests.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId } from '#/shared/domain/ids'

// Mock getAuth with controllable API surface
const mockSignUpEmail = vi.fn()
const mockGetSession = vi.fn()
const mockListUserInvitations = vi.fn()
const mockSetActiveOrganization = vi.fn()
const FIXED_NOW = new Date('2026-08-28T12:00:00.000Z')
const adapterDeps = {
  clock: vi.fn(() => FIXED_NOW),
  idGen: vi.fn(() => 'generated-role-id'),
}

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
  const adapter = createBetterAuthIdentityAdapter(db, adapterDeps)

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

  describe('custom role persistence', () => {
    it('uses the injected identifier for the role row', async () => {
      const values = vi.fn().mockResolvedValue(undefined)
      const tx = { insert: vi.fn(() => ({ values })) }
      vi.mocked(db.transaction).mockImplementationOnce(async (run) => run(tx as never))

      await adapter.createCustomRole(testCtx, {
        role: 'Concierge',
        permissions: ['review.read'],
        dataScope: 'assigned-properties',
      })

      expect(adapterDeps.idGen).toHaveBeenCalledOnce()
      expect(values.mock.calls[0]?.[0]).toMatchObject({
        id: 'generated-role-id',
        organizationId: 'org-1',
        role: 'concierge',
      })
    })

    it('uses one injected timestamp for both role policy updates', async () => {
      const where = vi.fn().mockResolvedValue(undefined)
      const set = vi.fn((_value: Record<string, unknown>) => ({ where }))
      const tx = { update: vi.fn(() => ({ set })) }
      vi.mocked(db.transaction).mockImplementationOnce(async (run) => run(tx as never))

      await adapter.updateCustomRole(testCtx, 'Concierge', {
        permissions: ['review.read'],
        dataScope: 'assigned-properties',
      })

      expect(adapterDeps.clock).toHaveBeenCalledOnce()
      expect(set).toHaveBeenCalledTimes(2)
      expect(set.mock.calls[0]?.[0]).toMatchObject({ updatedAt: FIXED_NOW })
      expect(set.mock.calls[1]?.[0]).toMatchObject({ updatedAt: FIXED_NOW })
    })
  })
})
