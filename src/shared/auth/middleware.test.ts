// Auth middleware tests
// Tests for getUserFromHeaders, requireAuth, and resolveTenantContext.
// Mocks getAuth() to return a controllable better-auth API surface.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
  resetTenantCache,
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
  resetTenantCache()
})

afterEach(() => {
  vi.useRealTimers()
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

describe('resolveTenantContext cache', () => {
  it('returns cached result on second call with same cookies', async () => {
    // Arrange
    const headers = makeHeaders({ cookie: 'session=abc123' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'admin' })

    // Act — first call
    const ctx1 = await resolveTenantContext(headers)
    // Act — second call with identical cookies
    const headers2 = makeHeaders({ cookie: 'session=abc123' })
    const ctx2 = await resolveTenantContext(headers2)

    // Assert — both return same result
    expect(ctx1).toEqual(ctx2)
    // getActiveMember only called once — second call used cache
    expect(mockGetActiveMember).toHaveBeenCalledTimes(1)
  })

  it('bypasses cache after TTL expires', async () => {
    // Arrange
    vi.useFakeTimers()
    const headers = makeHeaders({ cookie: 'session=xyz' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-2', activeOrganizationId: 'org-2' },
      user: { id: 'u2' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    // Act — first call
    await resolveTenantContext(headers)
    // Advance past TTL
    vi.advanceTimersByTime(6_000)
    // Act — second call should miss cache
    await resolveTenantContext(headers)

    // Assert — getActiveMember called twice
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('does not cache across different cookies', async () => {
    // Arrange
    const headers1 = makeHeaders({ cookie: 'session=aaa' })
    const headers2 = makeHeaders({ cookie: 'session=bbb' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    // Act
    await resolveTenantContext(headers1)
    await resolveTenantContext(headers2)

    // Assert — both calls hit DB
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })
})
