// Portal context — the link reorder server function over PostgreSQL.
// The real createServerFn handler runs over the real scope lookups, the real
// reorder use case and the real command store. The session and the execution
// policy are the answers of other contexts, so they are stood in for; each
// refusal is asserted on the rows it leaves, not on the calls it spares.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { organizationId, portalLinkCategoryId } from '#/shared/domain/ids'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { policyDenial } from '#/shared/testing/policy-denial'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { createAtomicPortalCommandStore } from '../publication/portal-command-store.server'
import { reorderLinks as reorderLinksUseCase } from '../application/use-cases/reorder-links'
import { createPortalScopeRepository } from '../infrastructure/repositories/portal-scope.repository'
import {
  LINK_WORLD_TABLES,
  bindLinkWorld,
  linkTenant,
  portalUpdatedAt,
  realLinkDeps,
  rowsOf,
  seedCategory,
  seedLink,
  seedLinkTenant,
  tenantContext,
} from '../infrastructure/testing/portal-link-use-case-world'

const handlerWorld = vi.hoisted(() => ({
  actor: undefined as unknown,
  requireExecutionAllowed: vi.fn(),
  management: (): unknown => undefined,
}))

vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: vi.fn(async () => handlerWorld.actor),
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: handlerWorld.requireExecutionAllowed,
}))
vi.mock('#/composition', () => ({
  getContainer: () => ({
    portalPublicApi: { management: handlerWorld.management() },
  }),
}))

import { reorderLinks } from './portal-links'

const ORG_A = organizationId('org-lnkhandler-0000-0000-000000000001')
const ORG_B = organizationId('org-lnkhandler-0000-0000-000000000002')
const A = linkTenant('b8e40001', ORG_A)
const A_OTHER_PORTAL = linkTenant('b8e40003', ORG_A)
const B = linkTenant('b8e40002', ORG_B)
const CLOCK = new Date('2026-11-01T12:00:00.000Z')

bindLinkWorld({
  commandStore: () =>
    createAtomicPortalCommandStore(getDb(), createPortalRatingGoalGuard()),
  buildPortal: buildTestPortal,
  buildAuthContext: buildTestAuthContext,
})

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: LINK_WORLD_TABLES,
})

handlerWorld.management = () => ({
  ...createPortalScopeRepository(getDb()),
  resolvePortalManagementScope: createPortalScopeRepository(getDb()).resolvePortal,
  resolvePortalCategoryManagementScope:
    createPortalScopeRepository(getDb()).resolveCategory,
  resolvePortalLinkManagementScope: createPortalScopeRepository(getDb()).resolveLink,
  reorderLinks: reorderLinksUseCase(realLinkDeps({ clock: () => CLOCK })),
})

const sortKeys = async (): Promise<Record<string, string>> =>
  Object.fromEntries(
    (
      await rowsOf<{ id: string; sort_key: string }>(
        getPool(),
        `SELECT id, sort_key FROM portal_links WHERE organization_id = ANY($1)`,
        [[ORG_A, ORG_B]],
      )
    ).map((row) => [row.id, row.sort_key]),
  )

const call = (input: Parameters<typeof reorderLinks>[0]['data']) =>
  withStartContext(() => reorderLinks({ data: input }))

const seedThree = async () => [
  await seedLink(getPool(), A, { sortKey: 'a0' }),
  await seedLink(getPool(), A, { sortKey: 'a1' }),
  await seedLink(getPool(), A, { sortKey: 'a2' }),
]

const reversed = (links: ReadonlyArray<{ id: string }>) =>
  links.map((link, index) => ({ id: link.id, sortKey: `b${links.length - index}` }))

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  handlerWorld.actor = tenantContext(A)
  handlerWorld.requireExecutionAllowed.mockReset()
  handlerWorld.requireExecutionAllowed.mockResolvedValue(undefined)
  await seedLinkTenant(getPool(), A)
  await seedLinkTenant(getPool(), A_OTHER_PORTAL)
  await seedLinkTenant(getPool(), B)
})

describe('reorderLinks server function (real PostgreSQL)', () => {
  it('reorders the links of a Portal once the policy admits the caller on its Property', async () => {
    const links = await seedThree()
    const items = reversed(links)

    await call({ portalId: A.portalId, categoryId: A.categoryId, items })

    expect(await sortKeys()).toEqual(
      Object.fromEntries(items.map((item) => [item.id, item.sortKey])),
    )
    expect(handlerWorld.requireExecutionAllowed).toHaveBeenCalledWith({
      actor: handlerWorld.actor,
      action: 'portal.update',
      capability: 'portal.write',
      propertyId: A.propertyId,
    })
  })

  it('stores no new order when the policy refuses the caller', async () => {
    const links = await seedThree()
    const before = await sortKeys()
    handlerWorld.requireExecutionAllowed.mockRejectedValue(policyDenial('scope_denied'))

    await expect(
      call({ portalId: A.portalId, categoryId: A.categoryId, items: reversed(links) }),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })

    expect(await sortKeys()).toEqual(before)
    expect((await portalUpdatedAt(getPool(), A)).getTime()).toBeLessThan(CLOCK.getTime())
  })

  it('answers not found, and stores no new order, for a link that sits in another Portal', async () => {
    const links = await seedThree()
    const foreign = await seedLink(getPool(), A_OTHER_PORTAL, { sortKey: 'a0' })
    const before = await sortKeys()

    await expect(
      call({
        portalId: A.portalId,
        categoryId: A.categoryId,
        items: [...reversed(links.slice(0, 2)), { id: foreign.id, sortKey: 'z9' }],
      }),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'link_not_found', status: 404 })

    expect(await sortKeys()).toEqual(before)
  })

  it("answers not found, and stores no new order, for another organization's link", async () => {
    const links = await seedThree()
    const foreign = await seedLink(getPool(), B, { sortKey: 'a0' })
    const before = await sortKeys()

    await expect(
      call({
        portalId: A.portalId,
        categoryId: A.categoryId,
        items: [...reversed(links.slice(0, 2)), { id: foreign.id, sortKey: 'z9' }],
      }),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'link_not_found', status: 404 })

    expect(await sortKeys()).toEqual(before)
  })

  it.each([
    ['an id that names no row', '3b6f0000-0000-4000-8000-00000000dead'],
    ['an id that is not a UUID', 'not-a-uuid'],
  ])('answers not found, and stores no new order, for %s', async (_label, missing) => {
    const links = await seedThree()
    const before = await sortKeys()

    await expect(
      call({
        portalId: A.portalId,
        categoryId: A.categoryId,
        items: [...reversed(links.slice(0, 2)), { id: missing, sortKey: 'z9' }],
      }),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'link_not_found', status: 404 })

    expect(await sortKeys()).toEqual(before)
  })

  it('answers not found before the policy is asked for a category of another Portal', async () => {
    const links = await seedThree()
    const before = await sortKeys()
    const foreignCategory = await seedCategory(
      getPool(),
      A_OTHER_PORTAL,
      portalLinkCategoryId('b8e40003-0000-4000-8000-0000000000c1'),
      'a1',
    )

    await expect(
      call({
        portalId: A.portalId,
        categoryId: foreignCategory,
        items: reversed(links),
      }),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'link_not_found', status: 404 })

    expect(await sortKeys()).toEqual(before)
    // Nothing was disclosed to the policy: the lookup failed first.
    expect(handlerWorld.requireExecutionAllowed).not.toHaveBeenCalled()
  })
})
