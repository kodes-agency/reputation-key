import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/pg-proxy'
import type { Database } from '#/shared/db'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { createBetterAuthIdentityAdapter } from './auth-identity.adapter'

const provider = vi.hoisted(() => ({ listMembers: vi.fn() }))
vi.mock('#/shared/auth/auth', () => ({ getAuth: () => ({ api: provider }) }))

const ctx: AuthContext = {
  organizationId: organizationId('org-directory'),
  userId: userId('user-owner'),
  role: 'AccountAdmin',
}
const createdAt = new Date('2026-01-01T00:00:00Z')
const execute = vi.fn(async (_sql: string, _params: unknown[]) => ({
  rows: [] as unknown[][],
}))
// The proxy builds real PostgreSQL SQL and decodes driver rows without a connection.
const db = drizzle(execute) as unknown as Database
const adapter = createBetterAuthIdentityAdapter(db)
const row = (id: string, role = 'admin', image: string | null = null) => [
  id,
  `user-${id}`,
  role,
  `${id}@example.com`,
  id,
  image,
  createdAt.toISOString(),
]

beforeEach(() => {
  vi.clearAllMocks()
  execute.mockResolvedValue({ rows: [] })
  provider.listMembers.mockResolvedValue({ members: [] })
})

describe('SQL member directory', () => {
  it('returns all 150 members without the provider page limit', async () => {
    execute.mockResolvedValueOnce({
      rows: Array.from({ length: 150 }, (_, i) =>
        row(`member-${String(i).padStart(3, '0')}`, i < 60 ? 'member' : 'admin'),
      ),
    })

    const members = await adapter.listMembers(ctx)

    expect(members).toHaveLength(150)
    expect(members[149]).toMatchObject({ id: 'member-149', role: 'PropertyManager' })
    const [sql, params] = execute.mock.calls[0]!
    expect(sql).toContain('inner join "user" on "member"."userId" = "user"."id"')
    expect(sql).toContain('where "member"."organizationId" = $1')
    expect(params).toEqual(['org-directory'])
    expect(sql).not.toContain('limit')
    expect(provider.listMembers).not.toHaveBeenCalled()
  })

  it('filters staff in SQL before stable pagination of the 90 managers', async () => {
    execute.mockResolvedValueOnce({
      rows: Array.from({ length: 10 }, (_, i) => row(`member-${140 + i}`)),
    })

    const members = await adapter.listMembers(ctx, {
      excludeStaff: true,
      limit: 20,
      offset: 80,
    })

    expect(members).toHaveLength(10)
    expect(members[9]).toEqual({
      id: 'member-149',
      userId: 'user-member-149',
      rawRole: 'admin',
      role: 'PropertyManager',
      email: 'member-149@example.com',
      name: 'member-149',
      image: null,
      createdAt,
    })
    const [sql, params] = execute.mock.calls[0]!
    expect(sql).toContain(
      'where ("member"."organizationId" = $1 and "member"."role" <> $2)',
    )
    expect(sql).toContain(
      'order by "member"."createdAt", "member"."id" limit $3 offset $4',
    )
    expect(params).toEqual(['org-directory', 'member', 20, 80])
  })

  it('preserves raw custom and multi roles and nullable images', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        row('multi', 'owner,editor'),
        row('custom', 'editor'),
        row('staff', 'member', 'avatar.png'),
      ],
    })
    const members = await adapter.listMembers(ctx)
    expect(members.map(({ rawRole, role, image }) => ({ rawRole, role, image }))).toEqual(
      [
        { rawRole: 'owner,editor', role: null, image: null },
        { rawRole: 'editor', role: null, image: null },
        { rawRole: 'member', role: 'Member', image: 'avatar.png' },
      ],
    )
  })

  it('looks up a member beyond the first page directly by tenant and id', async () => {
    execute.mockResolvedValueOnce({ rows: [row('member-149', 'owner')] })
    const getMember = adapter.getMember
    expect(await getMember(ctx, 'member-149')).toMatchObject({
      id: 'member-149',
      role: 'AccountAdmin',
    })
    const [sql, params] = execute.mock.calls[0]!
    expect(sql).toContain('where ("member"."organizationId" = $1 and "member"."id" = $2)')
    expect(params).toEqual(['org-directory', 'member-149', 1])
    expect(provider.listMembers).not.toHaveBeenCalled()
  })

  it('binds the asking tenant when a foreign member id is supplied', async () => {
    expect(await adapter.getMember(ctx, 'foreign-sentinel')).toBeNull()
    expect(execute.mock.calls[0]?.[1]).toEqual(['org-directory', 'foreign-sentinel', 1])
    const otherCtx = { ...ctx, organizationId: organizationId('org-other') }
    execute.mockResolvedValueOnce({ rows: [row('foreign-sentinel')] })
    expect(await adapter.getMember(otherCtx, 'foreign-sentinel')).toMatchObject({
      id: 'foreign-sentinel',
    })
    expect(execute.mock.calls[1]?.[1]).toEqual(['org-other', 'foreign-sentinel', 1])
  })

  it('counts owners in SQL independently of directory pagination, including multi-role owners', async () => {
    execute.mockResolvedValueOnce({
      rows: [
        ['owner', '2'],
        ['admin', '31'],
        ['member', '60'],
        [' \tOwNeR\n,editor', '14'],
        ['owner,owner', '1'],
        ['homeowner', '42'],
      ],
    })
    expect(await adapter.countOwners(ctx)).toBe(17)
    const [sql, params] = execute.mock.calls[0]!
    expect(sql).toContain('count(*)')
    expect(sql).toContain('"member"."organizationId" = $1')
    expect(sql).toContain('group by "member"."role"')
    expect(sql).not.toContain('join')
    expect(sql).not.toContain('limit')
    expect(params).toEqual(['org-directory'])
  })

  it('returns an empty list and zero owners for an empty organization', async () => {
    expect(await adapter.listMembers(ctx)).toEqual([])
    expect(await adapter.countOwners(ctx)).toBe(0)
  })
})
