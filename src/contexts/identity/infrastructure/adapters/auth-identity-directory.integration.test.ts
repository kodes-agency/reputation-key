import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { getDb, type Database } from '#/shared/db'
import { member, organization, user } from '#/shared/db/schema/auth'
import { organizationId, userId } from '#/shared/domain/ids'
import type { AuthContext } from '#/shared/domain/auth-context'
import { createBetterAuthIdentityAdapter } from './auth-identity.adapter'

vi.mock('#/shared/auth/auth', () => ({ getAuth: () => ({ api: {} }) }))

describe('member directory tenant isolation', () => {
  it('reads all managers, pages after staff filtering, counts owners and scopes id lookups', async () => {
    const suffix = randomUUID()
    const orgId = organizationId(`directory-${suffix}`)
    const otherOrgId = organizationId(`directory-other-${suffix}`)
    const now = new Date('2026-01-01T00:00:00Z')
    const id = (index: number) => `directory-member-${index}-${suffix}`
    const members = Array.from({ length: 150 }, (_, index) => ({
      id: id(index),
      userId: `directory-user-${index}-${suffix}`,
      organizationId: orgId,
      role:
        index === 0 || index === 149
          ? 'owner'
          : index === 148
            ? ' \tOwNeR\n,editor'
            : index <= 60
              ? 'member'
              : 'admin',
      createdAt: new Date(now.getTime() + index),
    }))
    const foreign = {
      id: `directory-foreign-member-${suffix}`,
      userId: `directory-foreign-user-${suffix}`,
      organizationId: otherOrgId,
      role: 'owner',
      createdAt: now,
    }
    const rollback = new Error('rollback directory fixtures')

    await expect(
      getDb().transaction(async (tx) => {
        await tx.insert(organization).values(
          [orgId, otherOrgId].map((org) => ({
            id: org,
            name: org,
            slug: org,
            createdAt: now,
          })),
        )
        await tx.insert(user).values(
          [...members, foreign].map((entry) => ({
            id: entry.userId,
            name: entry.userId,
            email: `${entry.userId}@example.test`,
            emailVerified: true,
            createdAt: now,
            updatedAt: now,
          })),
        )
        await tx.insert(member).values([...members, foreign])
        const adapter = createBetterAuthIdentityAdapter(tx as unknown as Database)
        const ctx: AuthContext = {
          organizationId: orgId,
          userId: userId(members[0]!.userId),
          role: 'AccountAdmin',
        }
        const managers = [id(0), ...Array.from({ length: 89 }, (_, i) => id(i + 61))]

        expect((await adapter.listMembers(ctx)).map((entry) => entry.id)).toEqual(
          members.map((entry) => entry.id),
        )
        expect(
          (await adapter.listMembers(ctx, { excludeStaff: true })).map(
            (entry) => entry.id,
          ),
        ).toEqual(managers)
        expect(
          (
            await adapter.listMembers(ctx, { excludeStaff: true, limit: 20, offset: 80 })
          ).map((entry) => entry.id),
        ).toEqual(managers.slice(80))
        expect(await adapter.countOwners(ctx)).toBe(3)
        expect(await adapter.getMember(ctx, id(149))).toMatchObject({
          id: id(149),
          role: 'AccountAdmin',
          userId: members[149]!.userId,
        })
        expect(await adapter.getMember(ctx, id(60))).toMatchObject({ role: 'Member' })
        expect(await adapter.getMember(ctx, foreign.id)).toBeNull()

        const otherCtx = { ...ctx, organizationId: otherOrgId }
        expect(await adapter.getMember(otherCtx, foreign.id)).toMatchObject({
          id: foreign.id,
        })
        expect((await adapter.listMembers(otherCtx)).map((entry) => entry.id)).toEqual([
          foreign.id,
        ])
        expect(await adapter.countOwners(otherCtx)).toBe(1)
        expect(await adapter.getMember(otherCtx, id(149))).toBeNull()
        throw rollback
      }),
    ).rejects.toBe(rollback)
  })
})
