// The createLink use case over real repositories and the real command store, with
// two Organizations: the answers a manager gets, what is stored (the link, its
// primary-language text, the category it starts), the facts left in the outbox and
// the address a link prints.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createAtomicPortalCommandStore } from './portal-command-store.server'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalLinkCategoryId } from '#/shared/domain/ids'
import { createLink } from '../application/use-cases/create-link'
import { isPortalError } from '../domain/errors'
import type { PortalCommandStore } from './portal-command-store-port.server'
import {
  LINK_WORLD_TABLES,
  bindLinkWorld,
  countRows,
  linkTenant,
  outboxPayloads,
  realLinkDeps,
  rowsOf,
  seedCategory,
  seedLink,
  seedLinkTenant,
  tenantContext,
} from '../infrastructure/testing/portal-link-use-case-world'

const ORG_A = organizationId('org-lnkcreate-0000-0000-000000000001')
const ORG_B = organizationId('org-lnkcreate-0000-0000-000000000002')
const A = linkTenant('b8e10001', ORG_A)
const B = linkTenant('b8e10002', ORG_B)
// A second Portal of Organization A, to own a category the first one may not use.
const A_OTHER = linkTenant('b8e10003', ORG_A)

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

const refusal = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

function wire(options: Parameters<typeof realLinkDeps>[0] = {}) {
  return createLink(realLinkDeps(options))
}

const admin = () => tenantContext(A, 'AccountAdmin')
const manager = () => tenantContext(A)

const storedLinks = (tenant = A) =>
  rowsOf<{ id: string; label: string; url: string; icon_key: string | null }>(
    getPool(),
    `SELECT l.id, l.label, COALESCE(d.normalized_uri, l.url) AS url, l.icon_key
       FROM portal_links l
       LEFT JOIN portal_approved_destinations d
         ON d.organization_id = l.organization_id AND d.id = l.destination_id
      WHERE l.organization_id = $1 ORDER BY l.sort_key`,
    [tenant.organizationId],
  )

const textsOf = (linkId: string) =>
  rowsOf<{ locale: string; label: string; line: string | null }>(
    getPool(),
    `SELECT locale, label, line FROM portal_link_texts
      WHERE organization_id = $1 AND link_id = $2 ORDER BY locale`,
    [ORG_A, linkId],
  )

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedLinkTenant(getPool(), A, { additionalGuestLocales: ['bg'] })
  await seedLinkTenant(getPool(), B)
  await seedLinkTenant(getPool(), A_OTHER)
})

describe('createLink (real PostgreSQL)', () => {
  it('creates a link in an existing category, approved, with its text and the printed address', async () => {
    const link = await wire()(
      {
        categoryId: A.categoryId,
        portalId: A.portalId,
        label: 'Google Review',
        url: 'https://google.com/review',
      },
      admin(),
    )

    expect(link.label).toBe('Google Review')
    expect(link.destinationId).not.toBeNull()
    expect(link.legacyDestinationState).toBe('migrated')
    expect(await storedLinks()).toEqual([
      {
        id: link.id,
        label: '',
        url: 'https://google.com/review',
        icon_key: null,
      },
    ])
    expect(link.url).toBe('https://google.com/review')
    const destinations = await rowsOf<{ id: string; approval_state: string }>(
      getPool(),
      `SELECT id, approval_state FROM portal_approved_destinations WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(destinations).toEqual([{ id: link.destinationId, approval_state: 'approved' }])
  })

  it('rejects when the category is not found', async () => {
    await expect(
      wire()(
        {
          categoryId: randomUUID(),
          portalId: A.portalId,
          label: 'Test',
          url: 'https://example.com',
        },
        admin(),
      ),
    ).rejects.toSatisfy(refusal('category_not_found'))
    expect(await storedLinks()).toEqual([])
  })

  it('rejects a category owned by a different portal without writing', async () => {
    await seedCategory(getPool(), A_OTHER, portalLinkCategoryId(randomUUID()), 'a0')
    const [foreignRow] = await rowsOf<{ id: string }>(
      getPool(),
      `SELECT id FROM portal_link_categories WHERE portal_id = $1`,
      [A_OTHER.portalId],
    )
    if (!foreignRow) throw new Error('the foreign category was not seeded')
    const foreignCategory = foreignRow.id

    await expect(
      wire()(
        {
          categoryId: foreignCategory,
          portalId: A.portalId,
          label: 'Cross-portal link',
          url: 'https://example.com',
        },
        admin(),
      ),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await storedLinks()).toEqual([])
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.created')).toEqual([])
  })

  it('rejects an empty label and an invalid URL before writing', async () => {
    const input = { categoryId: A.categoryId, portalId: A.portalId }

    await expect(
      wire()({ ...input, label: '', url: 'https://example.com' }, admin()),
    ).rejects.toSatisfy(refusal('invalid_label'))
    await expect(
      wire()({ ...input, label: 'Test', url: 'not-a-url' }, admin()),
    ).rejects.toSatisfy(refusal('invalid_url'))

    expect(await storedLinks()).toEqual([])
    expect(await countRows(getPool(), 'portal_approved_destinations', ORG_A)).toBe(0)
  })

  it('records a portal_link.created fact for the new link, carrying identifiers only', async () => {
    const link = await wire()(
      {
        categoryId: A.categoryId,
        portalId: A.portalId,
        label: 'Secret wording',
        url: 'https://example.com',
      },
      admin(),
    )

    const facts = await outboxPayloads(getPool(), ORG_A, 'portal_link.created')
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      linkId: link.id,
      portalId: A.portalId,
      categoryId: A.categoryId,
    })
    expect(JSON.stringify(facts)).not.toContain('Secret wording')
    expect(await outboxPayloads(getPool(), ORG_B, 'portal_link.created')).toEqual([])
  })

  it('rejects a role without portal.update, and leaves a custom address from a manager pending', async () => {
    await expect(
      wire()(
        {
          categoryId: A.categoryId,
          portalId: A.portalId,
          label: 'Test',
          url: 'https://example.com',
        },
        tenantContext(A, 'Member'),
      ),
    ).rejects.toSatisfy(refusal('forbidden'))

    await expect(
      wire()(
        {
          categoryId: A.categoryId,
          portalId: A.portalId,
          label: 'Test',
          url: 'https://avela.example.com/menu',
        },
        manager(),
      ),
    ).rejects.toSatisfy(refusal('destination_not_approved'))
    expect(await storedLinks()).toEqual([])
  })

  it('rejects a PropertyManager without assignment to the property, and allows an assigned one', async () => {
    const input = {
      categoryId: A.categoryId,
      portalId: A.portalId,
      label: 'Test',
      url: 'front@hotel.com',
    }

    await expect(wire({ accessible: [] })(input, manager())).rejects.toSatisfy(
      refusal('forbidden'),
    )
    expect(await storedLinks()).toEqual([])

    const link = await wire({ accessible: [A.propertyId] })(input, manager())

    expect(link.label).toBe('Test')
    expect(await storedLinks()).toHaveLength(1)
  })

  it("denies another Organization's manager the Portal and its category, and changes nothing", async () => {
    await seedLink(getPool(), B, { text: { locale: 'en', label: 'Theirs' } })
    const before = {
      linksB: await storedLinks(B),
      factsB: await countRows(getPool(), 'outbox_events', ORG_B),
    }

    await expect(
      wire()(
        { portalId: B.portalId, label: 'Intruder', url: 'https://example.com' },
        admin(),
      ),
    ).rejects.toSatisfy(refusal('portal_not_found'))
    await expect(
      wire()(
        {
          categoryId: B.categoryId,
          portalId: A.portalId,
          label: 'Intruder',
          url: 'https://example.com',
        },
        admin(),
      ),
    ).rejects.toSatisfy(refusal('category_not_found'))

    expect(await storedLinks(B)).toEqual(before.linksB)
    expect(await countRows(getPool(), 'outbox_events', ORG_B)).toBe(before.factsB)
    expect(await storedLinks()).toEqual([])
    expect(await countRows(getPool(), 'portal_approved_destinations', ORG_A)).toBe(0)
  })

  it("keeps each Organization's links apart when both add one", async () => {
    await wire()(
      { portalId: A.portalId, label: 'Mine', url: 'https://example.com/a' },
      admin(),
    )
    await createLink(realLinkDeps())(
      { portalId: B.portalId, label: 'Theirs', url: 'https://example.com/b' },
      tenantContext(B, 'AccountAdmin'),
    )

    expect((await storedLinks()).map((row) => row.url)).toEqual(['https://example.com/a'])
    expect((await storedLinks(B)).map((row) => row.url)).toEqual([
      'https://example.com/b',
    ])
  })

  describe('the Linktree working model', () => {
    const fifth = () => ({
      categoryId: A.categoryId,
      portalId: A.portalId,
      label: 'Fifth',
      url: 'https://example.com/fifth',
    })
    const existing = async (count: number) => {
      for (let index = 0; index < count; index += 1) {
        await seedLink(getPool(), A, {
          sortKey: `a${index}`,
          text: { locale: 'en', label: `Existing ${index}` },
        })
      }
    }

    it('takes the fourth link', async () => {
      await existing(3)

      await wire()(fifth(), admin())

      expect(await storedLinks()).toHaveLength(4)
    })

    it('refuses a fifth link before asking for a destination, and writes nothing', async () => {
      await existing(4)
      const networkChecks: string[] = []

      await expect(wire({ networkChecks })(fifth(), admin())).rejects.toSatisfy(
        refusal('link_limit_reached'),
      )

      expect(networkChecks).toEqual([])
      expect(await countRows(getPool(), 'portal_approved_destinations', ORG_A)).toBe(0)
      expect(await storedLinks()).toHaveLength(4)
      expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.created')).toEqual([])
    })

    it('keeps a Portal that already has more than four, and adds no more', async () => {
      await existing(6)

      await expect(wire()(fifth(), admin())).rejects.toSatisfy(
        refusal('link_limit_reached'),
      )

      expect(await storedLinks()).toHaveLength(6)
    })

    it('writes the label as the primary-language text and not to the legacy column', async () => {
      const link = await wire()({ ...fifth(), label: 'City guide' }, admin())

      expect(await textsOf(link.id)).toEqual([
        { locale: 'en', label: 'City guide', line: null },
      ])
      expect((await storedLinks())[0]?.label).toBe('')
    })
  })

  describe('without a category, as the Linktree editor adds a link', () => {
    const input = {
      portalId: A.portalId,
      label: 'Olive Terrace menu',
      url: 'https://avela.bg/olive-terrace/menu',
    }
    const categories = () =>
      rowsOf<{ id: string; title: string }>(
        getPool(),
        `SELECT id, title FROM portal_link_categories
          WHERE organization_id = $1 ORDER BY sort_key`,
        [ORG_A],
      )
    const clearCategories = () =>
      getPool().query(`DELETE FROM portal_link_categories WHERE organization_id = $1`, [
        ORG_A,
      ])

    beforeEach(async () => {
      await clearCategories()
    })

    it("starts the Portal's first category when it has none, and puts the link in it", async () => {
      const link = await wire()(input, admin())

      const started = await categories()
      expect(started.map((category) => category.title)).toEqual(['Links'])
      expect(link.categoryId).toBe(started[0]?.id)
      expect(await storedLinks()).toHaveLength(1)
      expect(
        await outboxPayloads(getPool(), ORG_A, 'portal_link_category.created'),
      ).toHaveLength(1)
      expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.created')).toHaveLength(
        1,
      )
    })

    it('titles the started category neutrally, whatever language the Portal has', async () => {
      await getPool().query(
        `UPDATE portals SET primary_guest_locale = 'bg', additional_guest_locales = '["en"]'
          WHERE organization_id = $1`,
        [ORG_A],
      )

      await wire()(input, admin())

      expect((await categories()).map((category) => category.title)).toEqual(['Links'])
    })

    it('hands the new category to the link write, so the store can keep them together', async () => {
      const writes: Parameters<PortalCommandStore['createPortalLink']>[0][] = []
      const wrap = (store: PortalCommandStore): PortalCommandStore => ({
        ...store,
        createPortalLink: async (command) => {
          writes.push(command)
          return store.createPortalLink(command)
        },
      })

      const link = await wire({ wrapStore: wrap })(input, admin())

      const [call] = writes
      expect(call?.startCategory?.category.id).toBe(link.categoryId)
      expect(call?.startCategory?.event._tag).toBe('portal_link_category.created')
      expect(call?.event.categoryId).toBe(link.categoryId)
    })

    it('puts the link in the last category when the Portal already has some', async () => {
      const first = await seedCategory(
        getPool(),
        A,
        portalLinkCategoryId(randomUUID()),
        'a0',
      )
      const last = await seedCategory(
        getPool(),
        A,
        portalLinkCategoryId(randomUUID()),
        'a1',
      )
      expect(first).not.toBe(last)
      const writes: Parameters<PortalCommandStore['createPortalLink']>[0][] = []
      const wrap = (store: PortalCommandStore): PortalCommandStore => ({
        ...store,
        createPortalLink: async (command) => {
          writes.push(command)
          return store.createPortalLink(command)
        },
      })

      const link = await wire({ wrapStore: wrap })(input, admin())

      expect(link.categoryId).toBe(last)
      expect(await categories()).toHaveLength(2)
      expect(writes[0]?.startCategory).toBeUndefined()
    })

    it('leaves no category and no category fact behind when the link write is refused', async () => {
      const refusing = (store: PortalCommandStore): PortalCommandStore => ({
        ...store,
        createPortalLink: async (command) => {
          await getPool().query(`UPDATE portals SET updated_at = $2 WHERE id = $1`, [
            A.portalId,
            new Date(command.revision.getTime() + 60_000),
          ])
          return store.createPortalLink(command)
        },
      })

      await expect(wire({ wrapStore: refusing })(input, admin())).rejects.toSatisfy(
        refusal('revision_conflict'),
      )

      expect(await categories()).toEqual([])
      expect(await storedLinks()).toEqual([])
      expect(
        await outboxPayloads(getPool(), ORG_A, 'portal_link_category.created'),
      ).toEqual([])
    })

    it('refuses an empty label without starting a category', async () => {
      await expect(wire()({ ...input, label: '  ' }, admin())).rejects.toSatisfy(
        refusal('invalid_label'),
      )

      expect(await categories()).toEqual([])
    })

    it('still refuses a fifth link without leaving a category behind', async () => {
      const category = await seedCategory(
        getPool(),
        A,
        portalLinkCategoryId(randomUUID()),
      )
      for (let index = 0; index < 4; index += 1) {
        await seedLink(getPool(), A, { categoryId: category, sortKey: `a${index}` })
      }

      await expect(wire()(input, admin())).rejects.toSatisfy(
        refusal('link_limit_reached'),
      )

      expect(await categories()).toHaveLength(1)
    })
  })

  describe('a phone number or an email address', () => {
    const add = async (url: string, iconKey?: string) => {
      const networkChecks: string[] = []
      const link = await wire({ networkChecks })(
        {
          categoryId: A.categoryId,
          portalId: A.portalId,
          label: 'Call reception',
          url,
          ...(iconKey === undefined ? {} : { iconKey }),
        },
        manager(),
      )
      return { link, networkChecks }
    }
    const requestedUris = async () =>
      (
        await rowsOf<{ normalized_uri: string }>(
          getPool(),
          `SELECT normalized_uri FROM portal_approved_destinations WHERE organization_id = $1`,
          [ORG_A],
        )
      ).map((row) => row.normalized_uri)

    it('stores a typed phone number in its one form, with a phone icon, and checks no network', async () => {
      const { link, networkChecks } = await add('+1 (555) 123-4567')

      expect(link.url).toBe('tel:+15551234567')
      expect(link.iconKey).toBe('phone')
      expect(await requestedUris()).toEqual(['tel:+15551234567'])
      expect(await storedLinks()).toMatchObject([
        { url: 'tel:+15551234567', icon_key: 'phone' },
      ])
      expect(networkChecks).toEqual([])
    })

    it('gives an email address a letter for its icon', async () => {
      const { link, networkChecks } = await add('Front@Hotel.com')

      expect(link.url).toBe('mailto:Front@hotel.com')
      expect(link.iconKey).toBe('mail')
      expect(networkChecks).toEqual([])
    })

    it('keeps the icon the manager chose', async () => {
      const { link } = await add('front@hotel.com', 'concierge-bell')

      expect(link.iconKey).toBe('concierge-bell')
    })

    it('gives a website no icon of its own, as before', async () => {
      const networkChecks: string[] = []
      const link = await wire({ networkChecks })(
        {
          categoryId: A.categoryId,
          portalId: A.portalId,
          label: 'Spa',
          url: 'https://example.com/spa',
        },
        admin(),
      )

      expect(link.iconKey).toBeNull()
      expect(networkChecks).toEqual(['https://example.com/spa'])
    })
  })
})
