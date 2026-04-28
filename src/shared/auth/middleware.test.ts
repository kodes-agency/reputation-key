// Auth middleware tests
// Tests for getUserFromHeaders, requireAuth, and resolveTenantContext.
// Mocks getAuth() to return a controllable better-auth API surface.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock getAuth before importing the module under test
const mockGetSession = vi.fn()
const mockGetActiveMember = vi.fn()

vi.mock('./auth', () => ({
  getAuth: () => ({
    api: {
      getSession: mockGetSession,
      getActiveMember: mockGetActiveMember,
    },
  }),
}))

import {
  getUserFromHeaders,
  getSessionFromHeaders,
  requireAuth,
  resolveTenantContext,
} from './middleware'

const makeHeaders = (extra: Record<string, string> = {}): Headers => {
  const h = new Headers()
  for (const [k, v] of Object.entries(extra)) {
    h.set(k, v)
  }
  return h
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetActiveMember.mockReset()
})

describe('getUserFromHeaders', () => {
  it('returns user when session exists', async () => {
    // Arrange
    const user = {
      id: 'user-1',
      name: 'Alice',
      email: 'alice@test.com',
      emailVerified: true,
      image: null,
    }
    mockGetSession.mockResolvedValue({ session: { id: 'sess-1' }, user })

    // Act
    const result = await getUserFromHeaders(makeHeaders())

    // Assert
    expect(result).toEqual(user)
  })

  it('returns null when no session exists', async () => {
    // Arrange
    mockGetSession.mockResolvedValue(null)

    // Act
    const result = await getUserFromHeaders(makeHeaders())

    // Assert
    expect(result).toBeNull()
  })
})

describe('getSessionFromHeaders', () => {
  it('delegates to auth.api.getSession', async () => {
    // Arrange
    const headers = makeHeaders({ cookie: 'session=abc' })
    const sessionObj = {
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    }
    mockGetSession.mockResolvedValue(sessionObj)

    // Act
    const result = await getSessionFromHeaders(headers)

    // Assert
    expect(result).toEqual(sessionObj)
    expect(mockGetSession).toHaveBeenCalledWith({ headers })
  })
})

describe('requireAuth', () => {
  it('returns user when authenticated', async () => {
    // Arrange
    const user = {
      id: 'user-1',
      name: 'Bob',
      email: 'bob@test.com',
      emailVerified: true,
      image: null,
    }
    mockGetSession.mockResolvedValue({ session: { id: 'sess-1' }, user })

    // Act
    const result = await requireAuth(makeHeaders())

    // Assert
    expect(result).toEqual(user)
  })

  it('throws AuthError with code unauthorized when no session', async () => {
    // Arrange
    mockGetSession.mockResolvedValue(null)

    // Act & Assert
    await expect(requireAuth(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'unauthorized' &&
        (e as unknown as Record<string, unknown>).status === 401,
    )
  })
})

describe('resolveTenantContext', () => {
  it('returns AuthContext with userId, organizationId, and role', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-123' },
      user: { id: 'user-456' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    // Act
    const ctx = await resolveTenantContext(makeHeaders())

    // Assert
    expect(ctx.userId).toBe('user-456')
    expect(ctx.organizationId).toBe('org-123')
    expect(ctx.role).toBe('AccountAdmin')
  })

  it('maps admin role to PropertyManager', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'admin' })

    // Act
    const ctx = await resolveTenantContext(makeHeaders())

    // Assert
    expect(ctx.role).toBe('PropertyManager')
  })

  it('maps member role to Staff', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'member' })

    // Act
    const ctx = await resolveTenantContext(makeHeaders())

    // Assert
    expect(ctx.role).toBe('Staff')
  })

  it('throws AuthError unauthorized when no session', async () => {
    // Arrange
    mockGetSession.mockResolvedValue(null)

    // Act & Assert
    await expect(resolveTenantContext(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'unauthorized' &&
        (e as unknown as Record<string, unknown>).status === 401,
    )
  })

  it('throws AuthError no_active_org when session has no activeOrganizationId', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: null },
      user: { id: 'u1' },
    })

    // Act & Assert
    await expect(resolveTenantContext(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'no_active_org' &&
        (e as unknown as Record<string, unknown>).status === 400,
    )
  })

  it('throws AuthError forbidden when getActiveMember returns null', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue(null)

    // Act & Assert
    await expect(resolveTenantContext(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'forbidden' &&
        (e as unknown as Record<string, unknown>).status === 403,
    )
  })
})
