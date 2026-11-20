// Portal link reorder server function, called as signed-in members over
// PostgreSQL with the real tenant resolution and execution policy. Each
// refusal is asserted on the rows it leaves.

import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  initCapabilityPolicyStore,
  resetCapabilityPolicyStore,
} from '#/shared/auth/beta-capabilities'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  setupServerFunctionHarness,
  type TestMember,
  type TestPortal,
  type TestProperty,
} from '#/shared/testing/server-function-harness'
import {
  portalUpdatedAt,
  rowsOf,
  seedCategory,
  seedLink,
  type LinkTenant,
} from '../infrastructure/testing/portal-link-use-case-world'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { reorderLinks } from './portal-links'

const harness = setupServerFunctionHarness({
  cleanupTables: [
    'portal_link_texts',
    'portal_links',
    'portal_link_categories',
    'portal_pending_content_changes',
    'portal_page_edits',
  ],
})

const tenantOf = (
  portal: TestPortal,
  property: TestProperty,
  member: TestMember,
  category: string,
): LinkTenant => ({
  organizationId: organizationId(portal.organizationId),
  propertyId: propertyId(property.id),
  portalId: portalId(portal.id),
  categoryId: portalLinkCategoryId(category),
  manager: userId(member.userId),
})

// The Portal revision is compared as a JavaScript instant, so the seeded
// timestamp is cut to milliseconds the way a Portal written by the app is.
async function seedPortal(property: TestProperty): Promise<TestPortal> {
  const portal = await harness.seedPortal(property)
  await harness
    .pool()
    .query(
      `UPDATE portals SET updated_at = date_trunc('milliseconds', updated_at) WHERE id = $1`,
      [portal.id],
    )
  return portal
}

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const manager = await harness.seedMember(organization, 'PropertyManager')
  const ungranted = await harness.seedMember(organization, 'PropertyManager')
  const member = await harness.seedMember(organization, 'Member')
  const property = await harness.seedProperty(organization)
  const portal = await seedPortal(property)
  await harness.grantProperty(manager, property)
  const tenant = tenantOf(portal, property, admin, randomUUID())
  await seedCategory(harness.pool(), tenant)
  const links = [
    await seedLink(harness.pool(), tenant, { sortKey: 'a0' }),
    await seedLink(harness.pool(), tenant, { sortKey: 'a1' }),
    await seedLink(harness.pool(), tenant, { sortKey: 'a2' }),
  ]
  return {
    organization,
    admin,
    manager,
    ungranted,
    member,
    property,
    portal,
    tenant,
    links,
  }
}

const sortKeys = async (organization: string): Promise<Record<string, string>> =>
  Object.fromEntries(
    (
      await rowsOf<{ id: string; sort_key: string }>(
        harness.pool(),
        `SELECT id, sort_key FROM portal_links WHERE organization_id = $1`,
        [organization],
      )
    ).map((row) => [row.id, row.sort_key]),
  )

const reversed = (links: ReadonlyArray<{ id: string }>) =>
  links.map((link, index) => ({ id: link.id, sortKey: `b${links.length - index}` }))

afterEach(resetCapabilityPolicyStore)

const switchOff = (capability: string) =>
  initCapabilityPolicyStore({
    isCapabilityKilled: (cap) => cap === capability,
    isOrgSuspended: () => false,
  })

const reorder = (caller: TestMember, input: Parameters<typeof reorderLinks>[0]['data']) =>
  harness.callAs(caller, () => reorderLinks({ data: input }))

describe('reorderLinks', () => {
  it.each(['admin', 'manager'] as const)(
    'reorders the links of a category for the %s',
    async (who) => {
      const world = await hotel()
      const items = reversed(world.links)
      const before = await portalUpdatedAt(harness.pool(), world.tenant)

      await reorder(world[who], {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items,
      })

      expect(await sortKeys(world.organization.id)).toEqual(
        Object.fromEntries(items.map((item) => [item.id, item.sortKey])),
      )
      expect(
        (await portalUpdatedAt(harness.pool(), world.tenant)).getTime(),
      ).toBeGreaterThan(before.getTime())
      const facts = await rowsOf(
        harness.pool(),
        `SELECT 1 FROM outbox_events WHERE organization_id = $1 AND event_type = 'portal_link.reordered'`,
        [world.organization.id],
      )
      expect(facts).toHaveLength(1)
    },
  )

  it('refuses when Portal writes are switched off and stores no new order', async () => {
    const world = await hotel()
    const before = await sortKeys(world.organization.id)
    const updatedAt = await portalUpdatedAt(harness.pool(), world.tenant)
    switchOff('portal.write')

    await expect(
      reorder(world.admin, {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items: reversed(world.links),
      }),
    ).rejects.toMatchObject({
      name: 'AuthError',
      code: 'capability_disabled',
      status: 403,
    })

    expect(await sortKeys(world.organization.id)).toEqual(before)
    expect(await portalUpdatedAt(harness.pool(), world.tenant)).toEqual(updatedAt)
  })

  it('refuses a PropertyManager without a grant and stores no new order', async () => {
    const world = await hotel()
    const before = await sortKeys(world.organization.id)
    const updatedAt = await portalUpdatedAt(harness.pool(), world.tenant)

    await expect(
      reorder(world.ungranted, {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items: reversed(world.links),
      }),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })

    expect(await sortKeys(world.organization.id)).toEqual(before)
    expect(await portalUpdatedAt(harness.pool(), world.tenant)).toEqual(updatedAt)
  })

  it('answers scope_denied, not link_not_found, to an ungranted manager naming foreign and unknown links', async () => {
    const world = await hotel()
    const otherProperty = await harness.seedProperty(world.organization)
    const otherPortal = await seedPortal(otherProperty)
    const otherTenant = tenantOf(otherPortal, otherProperty, world.admin, randomUUID())
    await seedCategory(harness.pool(), otherTenant)
    const foreign = await seedLink(harness.pool(), otherTenant, { sortKey: 'a0' })
    const before = await sortKeys(world.organization.id)

    await expect(
      reorder(world.ungranted, {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items: [
          ...reversed(world.links.slice(0, 2)),
          { id: foreign.id, sortKey: 'z9' },
          { id: '3b6f0000-0000-4000-8000-00000000dead', sortKey: 'z8' },
        ],
      }),
    ).rejects.toMatchObject({ name: 'AuthError', code: 'scope_denied', status: 403 })

    expect(await sortKeys(world.organization.id)).toEqual(before)
  })

  it('refuses a Member, who holds no manager role', async () => {
    const world = await hotel()
    const before = await sortKeys(world.organization.id)

    await expect(
      reorder(world.member, {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items: reversed(world.links),
      }),
    ).rejects.toMatchObject({ code: 'beta_role_inactive', status: 403 })

    expect(await sortKeys(world.organization.id)).toEqual(before)
  })

  it('answers not found, and stores no new order, for a link that sits in another Property’s Portal', async () => {
    const world = await hotel()
    const otherProperty = await harness.seedProperty(world.organization)
    const otherPortal = await seedPortal(otherProperty)
    const otherTenant = tenantOf(otherPortal, otherProperty, world.admin, randomUUID())
    await seedCategory(harness.pool(), otherTenant)
    const foreign = await seedLink(harness.pool(), otherTenant, { sortKey: 'a0' })
    const before = await sortKeys(world.organization.id)

    await expect(
      reorder(world.admin, {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items: [...reversed(world.links.slice(0, 2)), { id: foreign.id, sortKey: 'z9' }],
      }),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'link_not_found', status: 404 })

    expect(await sortKeys(world.organization.id)).toEqual(before)
  })

  it('answers not found, and stores no new order, for another Organization’s link', async () => {
    const world = await hotel()
    const elsewhere = await harness.seedOrganization()
    const elsewhereAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')
    const otherProperty = await harness.seedProperty(elsewhere)
    const otherPortal = await seedPortal(otherProperty)
    const otherTenant = tenantOf(otherPortal, otherProperty, elsewhereAdmin, randomUUID())
    await seedCategory(harness.pool(), otherTenant)
    const foreign = await seedLink(harness.pool(), otherTenant, { sortKey: 'a0' })
    const before = await sortKeys(world.organization.id)

    await expect(
      reorder(world.admin, {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items: [...reversed(world.links.slice(0, 2)), { id: foreign.id, sortKey: 'z9' }],
      }),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'link_not_found', status: 404 })

    expect(await sortKeys(world.organization.id)).toEqual(before)
    expect(await sortKeys(elsewhere.id)).toEqual({ [foreign.id]: 'a0' })
  })

  it.each([
    ['an id that names no row', '3b6f0000-0000-4000-8000-00000000dead'],
    ['an id that is not a UUID', 'not-a-uuid'],
  ])('answers not found, and stores no new order, for %s', async (_label, missing) => {
    const world = await hotel()
    const before = await sortKeys(world.organization.id)

    await expect(
      reorder(world.admin, {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items: [...reversed(world.links.slice(0, 2)), { id: missing, sortKey: 'z9' }],
      }),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'link_not_found', status: 404 })

    expect(await sortKeys(world.organization.id)).toEqual(before)
  })

  it('answers not found before the policy for a category of another Portal', async () => {
    const world = await hotel()
    const otherProperty = await harness.seedProperty(world.organization)
    const otherPortal = await seedPortal(otherProperty)
    const otherTenant = tenantOf(otherPortal, otherProperty, world.admin, randomUUID())
    const foreignCategory = await seedCategory(harness.pool(), otherTenant)
    const before = await sortKeys(world.organization.id)

    await expect(
      reorder(world.ungranted, {
        portalId: world.portal.id,
        categoryId: foreignCategory,
        items: reversed(world.links),
      }),
    ).rejects.toMatchObject({ name: 'PortalError', code: 'link_not_found', status: 404 })

    expect(await sortKeys(world.organization.id)).toEqual(before)
  })

  it('does not find a Portal of another Organization', async () => {
    const world = await hotel()
    const elsewhere = await harness.seedOrganization()
    const elsewhereAdmin = await harness.seedMember(elsewhere, 'AccountAdmin')
    const before = await sortKeys(world.organization.id)

    await expect(
      reorder(elsewhereAdmin, {
        portalId: world.portal.id,
        categoryId: world.tenant.categoryId,
        items: reversed(world.links),
      }),
    ).rejects.toMatchObject({ code: 'link_not_found', status: 404 })

    expect(await sortKeys(world.organization.id)).toEqual(before)
  })
})
