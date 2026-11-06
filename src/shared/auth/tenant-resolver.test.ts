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
const { mockAuthorizeMembership } = vi.hoisted(() => ({
  mockAuthorizeMembership: vi.fn(),
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

vi.mock('./user-organization-membership-authority', () => ({
  checkUserOrganizationMembership: mockAuthorizeMembership,
}))

import {
  decideTenantCacheAction,
  versionedEntryIsFresh,
  resolveTenant,
  resolveMemberAuthContext,
  resolveMemberAuthContextWithDatabase,
  resetTenantResolutionCache,
  TENANT_CACHE_TTL_MS,
  type TenantCacheEntry,
} from './tenant-resolver'
import type { AuthContext } from '#/shared/domain/auth-context'
import { organizationId, userId } from '#/shared/domain/ids'
import { VALID_PERMISSIONS } from './permission-catalogue'
import { can, canForContext, scopeForPermission } from '#/shared/domain/permissions'
import { toDomainRoleStrict } from '#/shared/domain/roles'

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

/** A select chain that answers the permission_version read with `version`. */
const versionRows = (version: number) => () => ({
  from: () => ({
    where: () => ({ limit: async () => [{ version }] }),
  }),
})

/** A select chain whose read rejects, like a database that is down. */
const versionReadFails = () => {
  // where().limit() must be chainable; route the rejection through then() so the
  // promise is awaited (not left as a floating unhandled rejection).
  const rejection = Promise.reject(new Error('db down'))
  const chainable = {
    limit: () => chainable,
    then: (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
      rejection.then(resolve, reject),
  }
  return { from: () => ({ where: () => chainable }) }
}

beforeEach(() => {
  mockGetSession.mockReset()
  mockGetActiveMember.mockReset()
  mockDbSelect.mockReset()
  mockDbSelect.mockImplementation(versionRows(7))
  mockAuthorizeMembership.mockReset()
  mockAuthorizeMembership.mockResolvedValue({ kind: 'allow' })
  resetTenantResolutionCache()
})

afterEach(() => {
  vi.useRealTimers()
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

describe('built-in role authority', () => {
  /** Every permission and scope of `memberRole`, checked against the static role table. */
  function expectBuiltInAuthority(ctx: AuthContext, memberRole: string) {
    const role = toDomainRoleStrict(memberRole)
    const scope = memberRole === 'owner' ? 'organization' : 'assigned-properties'
    expect(ctx.role).toBe(role)
    for (const permission of VALID_PERMISSIONS) {
      const allowed = can(role, permission)
      expect(canForContext(ctx, permission), permission).toBe(allowed)
      expect(scopeForPermission(ctx, permission), permission).toBe(
        allowed ? scope : 'none',
      )
    }
  }

  it.each(['owner', 'admin'])(
    'gives an interactive %s every permission and scope its built-in role holds',
    async (memberRole) => {
      mockGetSession.mockResolvedValue({
        session: { id: 'sess-1', activeOrganizationId: 'org-1' },
        user: { id: 'u1' },
      })
      mockGetActiveMember.mockResolvedValue({ role: memberRole })

      const ctx = await resolveTenant(makeHeaders())

      expectBuiltInAuthority(ctx, memberRole)
    },
  )

  it.each(['owner', 'admin', 'member'])(
    'gives a delayed worker the same %s authority as a request, through the transaction resolver too',
    async (memberRole) => {
      const input = { memberRole, organizationId: 'org-1', userId: 'u1' }
      const direct = await resolveMemberAuthContext(input)
      const snapshotSelect = vi.fn(versionRows(11))
      const snapshot = { select: snapshotSelect } as unknown as Parameters<
        typeof resolveMemberAuthContextWithDatabase
      >[0]
      mockDbSelect.mockImplementation(() => {
        throw new Error('Transaction authorization must use its supplied database')
      })
      const transactional = await resolveMemberAuthContextWithDatabase(snapshot, input)

      expectBuiltInAuthority(direct.context, memberRole)
      expect(transactional.context).toEqual(direct.context)
      expect(direct.permissionVersion).toBe(7)
      expect(transactional.permissionVersion).toBe(11)
      expect(snapshotSelect).toHaveBeenCalledOnce()
      expect(mockGetSession).not.toHaveBeenCalled()
      expect(mockGetActiveMember).not.toHaveBeenCalled()
    },
  )

  it('gives a request and a delayed worker the same context for the same member', async () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'admin' })

    const interactive = await resolveTenant(makeHeaders())
    const delayed = await resolveMemberAuthContext({
      memberRole: 'admin',
      organizationId: 'org-1',
      userId: 'u1',
    })

    expect(delayed.context).toEqual(interactive)
  })

  it.each(['owner,admin', 'content-manager', ' owner', 'Owner'])(
    'refuses %j for a delayed worker, which is not a built-in role token',
    async (memberRole) => {
      await expect(
        resolveMemberAuthContext({ memberRole, organizationId: 'org-1', userId: 'u1' }),
      ).rejects.toMatchObject({ name: 'AuthError', code: 'forbidden' })
      expect(mockDbSelect).not.toHaveBeenCalled()
    },
  )

  it.each(['owner', 'member'])(
    'fails closed with 503 for a delayed worker when the %s permission version is unreadable',
    async (memberRole) => {
      mockDbSelect.mockImplementation(versionReadFails)

      await expect(
        resolveMemberAuthContext({ memberRole, organizationId: 'org-1', userId: 'u1' }),
      ).rejects.toMatchObject({
        name: 'AuthError',
        code: 'authorization_unavailable',
        status: 503,
      })
    },
  )
})

// ── resolveTenant pipeline ──────────────────────────────────────

describe('resolveTenant', () => {
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

  it('rejects a Member login because Member users are inactive in beta', async () => {
    // Arrange
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'member' })

    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'beta_role_inactive' &&
        (e as unknown as Record<string, unknown>).status === 403,
    )
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

  it('rejects a session whose active Organization differs from its sole membership', async () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-2' },
      user: { id: 'u1' },
    })
    mockAuthorizeMembership.mockResolvedValue({
      kind: 'deny',
      reason: 'organization_membership_mismatch',
    })

    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code ===
          'organization_membership_conflict' &&
        (e as unknown as Record<string, unknown>).status === 409,
    )
    expect(mockGetActiveMember).not.toHaveBeenCalled()
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
        (e as unknown as Record<string, unknown>).code === 'beta_role_inactive' &&
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
        (e as unknown as Record<string, unknown>).code === 'beta_role_inactive' &&
        (e as unknown as Record<string, unknown>).status === 403,
    )
  })
})

describe('resolveTenant role refusals', () => {
  it('rejects a custom login role', async () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'content-manager' })

    await expect(resolveTenant(makeHeaders())).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof Error &&
        e.name === 'AuthError' &&
        (e as unknown as Record<string, unknown>).code === 'beta_role_inactive' &&
        (e as unknown as Record<string, unknown>).status === 403,
    )
    expect(mockDbSelect).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the permission version cannot be read', async () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })
    mockDbSelect.mockImplementation(versionReadFails)

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
  const adminSession = () => {
    mockGetSession.mockResolvedValue({
      session: { id: 'sess-1', activeOrganizationId: 'org-1' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValue({ role: 'admin' })
  }

  it('serves a cached context while the permission version is unchanged', async () => {
    const cookie = 'better-auth.session_token=abc123'
    adminSession()

    const ctx1 = await resolveTenant(makeHeaders({ cookie }))
    const ctx2 = await resolveTenant(makeHeaders({ cookie }))

    expect(ctx2).toBe(ctx1)
    expect(mockGetActiveMember).toHaveBeenCalledTimes(1)
  })

  it('re-resolves a cached context once the permission version has moved', async () => {
    const cookie = 'better-auth.session_token=abc123'
    adminSession()

    await resolveTenant(makeHeaders({ cookie }))
    mockDbSelect.mockImplementation(versionRows(8))
    await resolveTenant(makeHeaders({ cookie }))

    // A downgrade or removal bumps the version, so it cannot live for the TTL.
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })

  it('removes owner permissions and narrows Property scope after a cached owner is demoted', async () => {
    const headers = makeHeaders({ cookie: 'better-auth.session_token=owner-session' })
    adminSession()
    mockGetActiveMember.mockResolvedValue({ role: 'owner' })

    const before = await resolveTenant(headers)
    expect(canForContext(before, 'member.update')).toBe(true)
    expect(scopeForPermission(before, 'property.read')).toBe('organization')

    mockGetActiveMember.mockResolvedValue({ role: 'admin' })
    mockDbSelect.mockImplementation(versionRows(8))

    const interactive = await resolveTenant(headers)
    const delayed = await resolveMemberAuthContext({
      memberRole: 'admin',
      organizationId: 'org-1',
      userId: 'u1',
    })

    expect(interactive.role).toBe('PropertyManager')
    expect(canForContext(interactive, 'member.update')).toBe(false)
    expect(scopeForPermission(interactive, 'member.update')).toBe('none')
    expect(scopeForPermission(interactive, 'property.read')).toBe('assigned-properties')
    expect(delayed.context).toEqual(interactive)
    expect(delayed.permissionVersion).toBe(8)
  })

  it.each(['member', 'content-manager'])(
    'refuses a cached manager whose role becomes %s after a permission version bump',
    async (memberRole) => {
      const headers = makeHeaders({ cookie: 'better-auth.session_token=manager-session' })
      adminSession()
      await resolveTenant(headers)

      mockGetActiveMember.mockResolvedValue({ role: memberRole })
      mockDbSelect.mockImplementation(versionRows(8))

      await expect(resolveTenant(headers)).rejects.toMatchObject({
        code: 'beta_role_inactive',
        status: 403,
      })
    },
  )

  it('refuses a removed member after a permission version bump invalidates their cached authority', async () => {
    const headers = makeHeaders({ cookie: 'better-auth.session_token=removed-session' })
    adminSession()
    await resolveTenant(headers)

    mockGetActiveMember.mockResolvedValue(null)
    mockDbSelect.mockImplementation(versionRows(8))

    await expect(resolveTenant(headers)).rejects.toMatchObject({
      code: 'forbidden',
      status: 403,
    })
  })

  it('does not serve a cached context when its freshness cannot be proved', async () => {
    const cookie = 'better-auth.session_token=abc123'
    adminSession()

    await resolveTenant(makeHeaders({ cookie }))
    mockDbSelect.mockImplementation(versionReadFails)

    await expect(resolveTenant(makeHeaders({ cookie }))).rejects.toMatchObject({
      code: 'authorization_unavailable',
      status: 503,
    })
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })

  it('serves authority for the Secure cookie name used in production from the cache', async () => {
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

    expect(mockGetActiveMember).toHaveBeenCalledTimes(1)
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

    // Second resolution: same cookie, active org switched to org-B (manager).
    mockGetSession.mockResolvedValueOnce({
      session: { id: 'sess-1', activeOrganizationId: 'org-B' },
      user: { id: 'u1' },
    })
    mockGetActiveMember.mockResolvedValueOnce({ role: 'admin' })

    // Act
    const ctxA = await resolveTenant(headers)
    const ctxB = await resolveTenant(headers)

    // Assert — the second call must reflect org-B, not the cached org-A context.
    expect(ctxA.organizationId).toBe('org-A')
    expect(ctxB.organizationId).toBe('org-B')
    expect(ctxA.role).toBe('AccountAdmin')
    expect(ctxB.role).toBe('PropertyManager')
    // A fresh getActiveMember ran for the switched org (cache key differs by orgId).
    expect(mockGetActiveMember).toHaveBeenCalledTimes(2)
  })
})
