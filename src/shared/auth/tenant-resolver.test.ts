// TenantResolver tests
// The decision-table tests (cache freshness × version protocol × role strategy)
// target the new module directly; middleware.test.ts keeps only a thin
// integration test through the resolveTenantContext delegate.
// Mocks getAuth() to return a controllable better-auth API surface.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock getAuth before importing the module under test
const mockGetSession = vi.fn()
const mockGetActiveMember = vi.fn()
const mockDbSelect = vi.fn()

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

import {
  decideTenantCacheAction,
  versionedEntryIsFresh,
  resolveTenant,
  resetTenantResolutionCache,
  TENANT_CACHE_TTL_MS,
  type TenantCacheEntry,
} from './tenant-resolver'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId } from '#/shared/domain/ids'
import { resetEnv } from '#/shared/config/env'

const makeHeaders = (extra: Record<string, string> = {}): Headers => {
  const h = new Headers()
  for (const [k, v] of Object.entries(extra)) {
    h.set(k, v)
  }
  return h
}

const makeCtx = (): AuthContext => ({
  userId: userId('u1'),
  organizationId: organizationId('org-1'),
  role: 'AccountAdmin',
})

const makeEntry = (overrides: Partial<TenantCacheEntry> = {}): TenantCacheEntry => ({
  ctx: makeCtx(),
  ts: 1_000,
  version: null,
  ...overrides,
})

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetActiveMember.mockReset()
  mockDbSelect.mockReset()
  resetTenantResolutionCache()
})

afterEach(() => {
  vi.useRealTimers()
  resetEnv()
})

// ── Freshness decision table (pure) ─────────────────────────────
//
//   cached?  TTL-fresh?  versioned?  → action
//   no       —           —           → resolve-fresh
//   yes      no          —           → resolve-fresh
//   yes      yes         no          → resolve-fresh
//   yes      yes         yes         → check-version

describe('decideTenantCacheAction', () => {
  const now = 100_000

  it('resolves fresh when no entry is cached', () => {
    expect(decideTenantCacheAction(undefined, now)).toBe('resolve-fresh')
  })

  it('resolves fresh when the entry is past the TTL', () => {
    const entry = makeEntry({ ts: now - TENANT_CACHE_TTL_MS - 1 })
    expect(decideTenantCacheAction(entry, now)).toBe('resolve-fresh')
  })

  it('resolves a TTL-fresh unversioned entry so built-in role changes apply immediately', () => {
    const entry = makeEntry({ ts: now - TENANT_CACHE_TTL_MS + 1, version: null })
    expect(decideTenantCacheAction(entry, now)).toBe('resolve-fresh')
  })

  it('checks the permission_version for a TTL-fresh versioned entry (Stage 2 DAC)', () => {
    const entry = makeEntry({ ts: now, version: 3 })
    expect(decideTenantCacheAction(entry, now)).toBe('check-version')
  })
})

// ── Versioned-entry freshness (pure) ────────────────────────────
//
//   permission_version match?  → outcome
//   current === cached         → serve
//   current !== cached (bump)  → drop-and-re-resolve
//   current unknown (read failed) → drop-and-re-resolve (can't prove freshness)

describe('versionedEntryIsFresh', () => {
  it('is fresh when the current permission_version matches the cached one', () => {
    expect(versionedEntryIsFresh(3, 3)).toBe(true)
  })

  it('is stale when the permission_version has bumped', () => {
    expect(versionedEntryIsFresh(3, 4)).toBe(false)
  })

  it('is stale when the current version could not be read (fail-closed)', () => {
    expect(versionedEntryIsFresh(3, null)).toBe(false)
  })
})

// ── resolveTenant pipeline ──────────────────────────────────────

describe('resolveTenant', () => {
  // Stage 1 tests: custom roles disabled. Pin the flag so these tests are
  // hermetic w.r.t. the .env default (which may be true in dev).
  beforeEach(() => {
    process.env.ENABLE_CUSTOM_ROLES = 'false'
    resetEnv()
  })

  it('returns AuthContext with userId, organizationId, and role', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-123' },
      user: { id: 'user-456' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    // Act
    const ctx = await resolveTenant(makeHeaders())

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
    const ctx = await resolveTenant(makeHeaders())

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
    const ctx = await resolveTenant(makeHeaders())

    // Assert
    expect(ctx.role).toBe('Staff')
  })

  it('throws AuthError unauthorized when no session', async () => {
    // Arrange
    mockGetSession.mockResolvedValue(null)

    // Act & Assert
    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
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
    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
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
    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'forbidden' &&
        (e as unknown as Record<string, unknown>).status === 403,
    )
  })

  it('throws AuthError forbidden when member has a custom (non-built-in) role', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'content-manager' })

    // Act & Assert — Stage 1 fails closed on non-built-in roles (DAC ADR 0001).
    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'forbidden' &&
        (e as unknown as Record<string, unknown>).status === 403,
    )
  })

  it('throws AuthError forbidden when member.role is a comma-delimited multi-role', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner,admin' })

    // Act & Assert — multi-role strings are non-built-in until Stage 2.
    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'forbidden' &&
        (e as unknown as Record<string, unknown>).status === 403,
    )
  })
})

describe('resolveTenant role strategy (ENABLE_CUSTOM_ROLES on)', () => {
  beforeEach(() => {
    process.env.ENABLE_CUSTOM_ROLES = 'true'
    resetEnv()
  })

  it('resolves a custom role via the dynamic resolver', async () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'content-manager' })

    // fetchPermissionVersion + fetchRoleDefinitions run selects distinguished by the
    // selected columns: {version} → permission_version, {permission} → organizationRole,
    // {dataScope} → organization_role_policy. The where() result is a thenable that also
    // supports .limit() (drizzle chains synchronously before await).
    mockDbSelect.mockImplementation((cols: Record<string, unknown>) => {
      const rows =
        'version' in cols
          ? [{ version: 1 }]
          : 'permission' in cols
            ? [
                {
                  role: 'content-manager',
                  permission: JSON.stringify({ portal: ['read', 'update'] }),
                },
              ]
            : [{ role: 'content-manager', dataScope: 'assigned-properties' }]
      const chainable = {
        limit: () => chainable,
        then: (resolve: (v: unknown) => void) => Promise.resolve(rows).then(resolve),
      }
      return { from: () => ({ where: () => chainable }) }
    })

    const ctx = await resolveTenant(makeHeaders())

    // Custom-only member → Staff placeholder; the scope map is authoritative.
    expect(ctx.role).toBe('Staff')
    expect(ctx.effectivePermissions?.has('portal.read')).toBe(true)
    expect(ctx.effectivePermissions?.has('portal.update')).toBe(true)
    expect(ctx.scopeByPermission?.get('portal.read')).toBe('assigned-properties')
  })

  it('fails closed with 503 when the dynamic resolver throws', async () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'content-manager' })
    mockDbSelect.mockImplementation(() => {
      // where().limit() must be chainable; route the rejection through then() so the
      // promise is awaited (not left as a floating unhandled rejection).
      const rejection = Promise.reject(new Error('db down'))
      const chainable = {
        limit: () => chainable,
        then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
          rejection.then(resolve, reject),
      }
      return { from: () => ({ where: () => chainable }) }
    })

    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'authorization_unavailable' &&
        (e as unknown as Record<string, unknown>).status === 503,
    )
  })
})

describe('resolveTenant cache', () => {
  // Stage 1 tests: pin the flag so the cache tests are hermetic w.r.t. the .env
  // default (which is ENABLE_CUSTOM_ROLES=true in dev) — otherwise the dynamic
  // resolver branch runs and hits an unmocked fetchPermissionVersion (503).
  beforeEach(() => {
    process.env.ENABLE_CUSTOM_ROLES = 'false'
    resetEnv()
  })

  it('re-resolves an unversioned built-in role on the next request', async () => {
    // Arrange
    const headers = makeHeaders({ cookie: 'better-auth.session_token=abc123' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'admin' })

    // Act — first call
    const ctx1 = await resolveTenant(headers)
    // Act — second call with identical cookies
    const headers2 = makeHeaders({ cookie: 'better-auth.session_token=abc123' })
    const ctx2 = await resolveTenant(headers2)

    // Assert — the role is re-read; a downgrade/removal cannot live for the TTL.
    expect(ctx1).toEqual(ctx2)
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })

  it('re-resolves authority for the Secure cookie name used in production', async () => {
    const headers = makeHeaders({
      cookie: '__Secure-better-auth.session_token=secure-abc123; theme=dark',
    })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-secure', activeOrganizationId: 'org-secure' },
      user: { id: 'user-secure' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'admin' })

    await resolveTenant(headers)
    await resolveTenant(headers)

    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })

  it('keys on the Secure cookie when both secure and legacy names are present', async () => {
    const first = makeHeaders({
      cookie:
        'better-auth.session_token=legacy-shared; __Secure-better-auth.session_token=secure-a',
    })
    const second = makeHeaders({
      cookie:
        'better-auth.session_token=legacy-shared; __Secure-better-auth.session_token=secure-b',
    })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-secure', activeOrganizationId: 'org-secure' },
      user: { id: 'user-secure' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'admin' })

    await resolveTenant(first)
    await resolveTenant(second)

    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })

  it('bypasses cache after TTL expires', async () => {
    // Arrange
    vi.useFakeTimers()
    const headers = makeHeaders({ cookie: 'better-auth.session_token=xyz' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-2', activeOrganizationId: 'org-2' },
      user: { id: 'u2' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    // Act — first call
    await resolveTenant(headers)
    // Advance past TTL (60s, per auth-caching plan)
    vi.advanceTimersByTime(TENANT_CACHE_TTL_MS + 1_000)
    // Act — second call should miss cache
    await resolveTenant(headers)

    // Assert — getActiveMember called twice
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('does not cache across different cookies', async () => {
    // Arrange
    const headers1 = makeHeaders({ cookie: 'better-auth.session_token=aaa' })
    const headers2 = makeHeaders({ cookie: 'better-auth.session_token=bbb' })
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    // Act
    await resolveTenant(headers1)
    await resolveTenant(headers2)

    // Assert — both calls hit DB
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })

  it('serves a fresh context after an org switch — no cross-org leak (H1)', async () => {
    // Arrange — same session cookie across both calls, but the active org changes
    // (setActiveOrganization rotates the server-side active org without rotating the
    // session token). The cache key must include the org so org-B doesn't get org-A's ctx.
    const headers = makeHeaders({ cookie: 'better-auth.session_token=abc123' })

    // First resolution: active org is org-A (owner).
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-1', activeOrganizationId: 'org-A' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValueOnce({ role: 'owner' })

    // Second resolution: same cookie, active org switched to org-B (member).
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-1', activeOrganizationId: 'org-B' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValueOnce({ role: 'member' })

    // Act
    const ctxA = await resolveTenant(headers)
    const ctxB = await resolveTenant(headers)

    // Assert — the second call must reflect org-B, not the cached org-A context.
    expect(ctxA.organizationId).toBe('org-A')
    expect(ctxB.organizationId).toBe('org-B')
    expect(ctxA.role).toBe('AccountAdmin')
    expect(ctxB.role).toBe('Staff')
    // A fresh getActiveMember ran for the switched org (cache key differs by orgId).
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })
})
