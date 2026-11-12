import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createEnvCapabilityPolicyStore,
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { Permission } from '#/shared/domain/permissions'
import type { DataScope } from '#/shared/domain/data-scope'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { rosterAccess } from './portal-results-roster'

const actor: AuthContext = {
  organizationId: organizationId('org-1'),
  userId: userId('manager-1'),
  role: 'PropertyManager',
}
const permissions = ['portal.read', 'dashboard.read'] as const
const now = new Date('2026-11-08T12:00:00Z')

function scoped(portal: DataScope, dashboard: DataScope): AuthContext {
  return {
    ...actor,
    effectivePermissions: new Set<Permission>(permissions),
    scopeByPermission: new Map<Permission, DataScope>([
      ['portal.read', portal],
      ['dashboard.read', dashboard],
    ]),
  }
}

beforeEach(() => {
  initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
})
afterEach(resetCapabilityPolicyStore)

describe('Portal results roster grant snapshot', () => {
  const decide = async (
    access: Awaited<ReturnType<typeof rosterAccess>>,
    ctx: AuthContext,
    id: string,
    action: (typeof permissions)[number],
  ) =>
    access.policy.decide({
      principal: { kind: 'user', ctx },
      organizationId: ctx.organizationId,
      action,
      propertyId: id,
      executionKind: 'interactive',
      now,
    })

  it('uses one Accounts lookup for both permissions across 60 Properties', async () => {
    const ids = Array.from({ length: 60 }, (_, index) => propertyId(`property-${index}`))
    const lookup = vi.fn(async () => ids)
    const access = await rosterAccess(actor, lookup)

    const answers = await Promise.all(
      ids.flatMap((id) => permissions.map((action) => decide(access, actor, id, action))),
    )
    expect(answers.every((answer) => answer.allowed)).toBe(true)
    expect(lookup).toHaveBeenCalledExactlyOnceWith(
      actor.organizationId,
      actor.userId,
      false,
    )
    expect(await decide(access, actor, 'unassigned', 'portal.read')).toMatchObject({
      allowed: false,
      reason: 'scope_denied',
    })
  })

  it.each([
    ['organization', 'assigned-properties'],
    ['assigned-properties', 'organization'],
  ] as const)(
    'keeps portal %s and dashboard %s scopes independent',
    async (portal, dashboard) => {
      const ctx = scoped(portal, dashboard)
      const lookup = vi.fn(async () => [propertyId('assigned')])
      const access = await rosterAccess(ctx, lookup)

      expect(await decide(access, ctx, 'other', 'portal.read')).toMatchObject({
        allowed: portal === 'organization',
      })
      expect(await decide(access, ctx, 'other', 'dashboard.read')).toMatchObject({
        allowed: dashboard === 'organization',
      })
      expect(lookup).toHaveBeenCalledTimes(1)
    },
  )

  it('needs no grants for an Organization-wide reader', async () => {
    const ctx = { ...actor, role: 'AccountAdmin' as const }
    const lookup = vi.fn(async () => [])
    const access = await rosterAccess(ctx, lookup)

    expect(access.assignedIds).toBeNull()
    expect(await decide(access, ctx, 'any', 'portal.read')).toMatchObject({
      allowed: true,
    })
    expect(lookup).not.toHaveBeenCalled()
  })

  it('does not reuse a snapshot after the request ends', async () => {
    const lookup = vi
      .fn()
      .mockResolvedValueOnce([propertyId('assigned')])
      .mockResolvedValueOnce([])
    const first = await rosterAccess(actor, lookup)
    const second = await rosterAccess(actor, lookup)

    expect(await decide(first, actor, 'assigned', 'dashboard.read')).toMatchObject({
      allowed: true,
    })
    expect(await decide(second, actor, 'assigned', 'dashboard.read')).toMatchObject({
      allowed: false,
    })
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('fails closed on absent grant data and propagates lookup failures', async () => {
    const access = await rosterAccess(actor, async () => null)
    expect(access.assignedIds).toEqual([])
    expect(await decide(access, actor, 'any', 'dashboard.read')).toMatchObject({
      allowed: false,
    })
    const failure = new Error('unavailable')
    await expect(
      rosterAccess(actor, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
  })

  it('keeps suspension and role denials even when the snapshot grants the Property', async () => {
    const access = await rosterAccess(actor, async () => [propertyId('assigned')])
    initCapabilityPolicyStore(
      createEnvCapabilityPolicyStore({
        BETA_SUSPENDED_ORGS: actor.organizationId,
      }),
    )
    expect(await decide(access, actor, 'assigned', 'portal.read')).toMatchObject({
      allowed: false,
    })
    initCapabilityPolicyStore(createEnvCapabilityPolicyStore({}))
    expect(
      await decide(
        access,
        { ...actor, effectivePermissions: new Set() },
        'assigned',
        'portal.read',
      ),
    ).toMatchObject({
      allowed: false,
      reason: 'permission_denied',
    })
  })
})
