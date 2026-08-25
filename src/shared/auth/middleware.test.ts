// Auth middleware tests
// Tests for getUserFromHeaders, requireAuth, and a thin integration test for
// resolveTenantContext (the pipeline behavior + decision-table tests live in
// tenant-resolver.test.ts — the middleware is a delegate).
// Mocks getAuth() to return a controllable better-auth API surface.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock getAuth before importing the module under test
const mockGetSession = vi.fn()
const mockGetActiveMember = vi.fn()
const mockDbSelect = vi.fn()
const { mockCheckOrganizationBinding } = vi.hoisted(() => ({
  mockCheckOrganizationBinding: vi.fn(),
}))

vi.mock('./auth', () => ({
  getAuth: () => ({
    api: {
      getSession: mockGetSession,
      getActiveMember: mockGetActiveMember,
    },
  }),
}))

vi.mock('#/shared/db', () => ({
  getDb: () => ({ select: mockDbSelect }),
}))

vi.mock('./user-organization-binding-authority', () => ({
  checkUserOrganizationBinding: mockCheckOrganizationBinding,
}))

import {
  getUserFromHeaders,
  getSessionFromHeaders,
  requireAuth,
  resolveTenantContext,
  resetTenantCache,
} from './middleware'
import { resetEnv } from '#/shared/config/env'

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
  mockDbSelect.mockReset()
  mockCheckOrganizationBinding.mockReset()
  mockCheckOrganizationBinding.mockResolvedValue({ kind: 'allow', version: 1 })
  resetTenantCache()
})

afterEach(() => {
  vi.useRealTimers()
  resetEnv()
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

describe('resolveTenantContext (integration through the delegate)', () => {
  beforeEach(() => {
    // Stage 1: pin the flag so the test is hermetic w.r.t. the .env default.
    process.env.ENABLE_CUSTOM_ROLES = 'false'
    resetEnv()
  })

  it('resolves the full pipeline to an AuthContext', async () => {
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

  it('propagates the tagged AuthError from the resolver', async () => {
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
})
