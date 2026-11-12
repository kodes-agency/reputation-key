// The saveLinktreeSettings, listPortalLinks and getPortalLinktree use cases over
// real repositories and the real command store, with two Organizations: what is
// stored for the section's switch and titles, the fact left in the outbox, and
// what each read returns to the Organization that owns the Portal and to no one else.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
import { getDb } from '#/shared/db'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { createAtomicPortalCommandStore } from './portal-command-store.server'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortalMediaAsset } from '#/shared/testing/portal-media-fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { PortalMediaAsset } from '../domain/portal-media-asset'
import { createLink } from '../application/use-cases/create-link'
import { getPortalLinktree } from '../application/use-cases/get-portal-linktree'
import { listPortalLinks } from '../application/use-cases/list-portal-links'
import { saveLinktreeSettings } from '../application/use-cases/save-linktree-settings'
import { isPortalError } from '../domain/errors'
import { createPortalMediaAssetRepository } from '../infrastructure/repositories/portal-media-asset.repository'
import {
  LINK_WORLD_TABLES,
  bindLinkWorld,
  countRows,
  linkTenant,
  outboxPayloads,
  realLinkDeps,
  rowsOf,
  seedLink,
  seedLinkTenant,
  seedLinkText,
  tenantContext,
} from '../infrastructure/testing/portal-link-use-case-world'

const ORG_A = organizationId('org-lnksettings-0000-0000-000000000001')
const ORG_B = organizationId('org-lnksettings-0000-0000-000000000002')
const A = linkTenant('b8e40001', ORG_A)
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

const refusal = (code: string) => (error: unknown) =>
  isPortalError(error) && error.code === code

const manager = () => tenantContext(A)

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedLinkTenant(getPool(), A, { additionalGuestLocales: ['bg'] })
  await seedLinkTenant(getPool(), B)
})

describe('saveLinktreeSettings (real PostgreSQL)', () => {
  const save = (options: Parameters<typeof realLinkDeps>[0] = {}) =>
    saveLinktreeSettings(realLinkDeps({ clock: () => CLOCK, ...options }))

  const enabled = async (tenant = A) =>
    (
      await rowsOf<{ linktree_enabled: boolean }>(
        getPool(),
        `SELECT linktree_enabled FROM portals WHERE organization_id = $1 AND id = $2`,
        [tenant.organizationId, tenant.portalId],
      )
    )[0]?.linktree_enabled

  const titles = async (tenant = A) =>
    Object.fromEntries(
      (
        await rowsOf<{ locale: string; linktree_title: string }>(
          getPool(),
          `SELECT locale, linktree_title FROM portal_localized_overrides
            WHERE organization_id = $1 AND portal_id = $2 AND linktree_title IS NOT NULL`,
          [tenant.organizationId, tenant.portalId],
        )
      ).map((row) => [row.locale, row.linktree_title]),
    )

  it('turns the section off and back on', async () => {
    expect(await enabled()).toBe(true)

    await save()({ portalId: A.portalId, enabled: false }, manager())
    expect(await enabled()).toBe(false)

    await save()({ portalId: A.portalId, enabled: true }, manager())
    expect(await enabled()).toBe(true)
  })

  it('saves a trimmed title per offered language', async () => {
    await save()(
      {
        portalId: A.portalId,
        titles: [
          { locale: 'en', title: '  Around town  ' },
          { locale: 'bg', title: 'Из града' },
        ],
      },
      manager(),
    )

    expect(await titles()).toEqual({ en: 'Around town', bg: 'Из града' })
  })

  it('resets a title to the default with null or a blank', async () => {
    await save()(
      {
        portalId: A.portalId,
        titles: [
          { locale: 'en', title: 'Around town' },
          { locale: 'bg', title: 'Из града' },
        ],
      },
      manager(),
    )

    await save()(
      {
        portalId: A.portalId,
        titles: [
          { locale: 'en', title: null },
          { locale: 'bg', title: '   ' },
        ],
      },
      manager(),
    )

    expect(await titles()).toEqual({})
  })

  it('records one portal.updated fact that keeps the publication state and carries no text', async () => {
    await save()(
      {
        portalId: A.portalId,
        enabled: false,
        titles: [{ locale: 'en', title: 'Around town' }],
      },
      manager(),
    )

    const [portalRow] = await rowsOf<{ publication_state: string }>(
      getPool(),
      `SELECT publication_state FROM portals WHERE id = $1`,
      [A.portalId],
    )
    if (!portalRow) throw new Error('the portal row is missing')
    const state = portalRow.publication_state
    const facts = await outboxPayloads(getPool(), ORG_A, 'portal.updated')
    expect(facts).toEqual([
      expect.objectContaining({
        portalId: A.portalId,
        previousPublicationState: state,
        publicationState: state,
        occurredAt: CLOCK.toISOString(),
      }),
    ])
    expect(JSON.stringify(facts)).not.toContain('Around town')
  })

  it.each([
    [
      'a title over the limit',
      { titles: [{ locale: 'en' as const, title: 'x'.repeat(61) }] },
      'invalid_title',
    ],
    [
      'a language the Portal does not offer',
      { titles: [{ locale: 'de' as const, title: 'Nützlich' }] },
      'locale_not_offered',
    ],
    [
      'the same language twice',
      {
        titles: [
          { locale: 'en' as const, title: 'One' },
          { locale: 'en' as const, title: 'Two' },
        ],
      },
      'locale_not_offered',
    ],
    ['nothing to change', {}, 'invalid_title'],
  ])('refuses %s and writes nothing', async (_name, change, code) => {
    await expect(
      save()({ portalId: A.portalId, ...change }, manager()),
    ).rejects.toSatisfy(refusal(code))

    expect(await titles()).toEqual({})
    expect(await outboxPayloads(getPool(), ORG_A, 'portal.updated')).toEqual([])
  })

  it('refuses a role without portal.update', async () => {
    await expect(
      save()({ portalId: A.portalId, enabled: false }, tenantContext(A, 'Member')),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await enabled()).toBe(true)
  })

  it('refuses a manager who is not assigned to the Property', async () => {
    await expect(
      save({ accessible: [] })({ portalId: A.portalId, enabled: false }, manager()),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await enabled()).toBe(true)
  })

  it("denies another Organization's manager the Portal, changing nothing in either", async () => {
    await save()(
      { portalId: B.portalId, titles: [{ locale: 'en', title: 'Theirs' }] },
      tenantContext(B),
    )

    await expect(
      save()(
        {
          portalId: A.portalId,
          enabled: false,
          titles: [{ locale: 'en', title: 'Intruder' }],
        },
        tenantContext(B),
      ),
    ).rejects.toSatisfy(refusal('portal_not_found'))

    expect(await enabled()).toBe(true)
    expect(await titles()).toEqual({})
    expect(await titles(B)).toEqual({ en: 'Theirs' })
    expect(await outboxPayloads(getPool(), ORG_A, 'portal.updated')).toEqual([])
  })
})

describe('listPortalLinks (real PostgreSQL)', () => {
  const list = (options: Parameters<typeof realLinkDeps>[0] = {}) =>
    listPortalLinks(realLinkDeps(options))

  it('returns the links of a portal for a PropertyManager in order, and reads no categories', async () => {
    const second = await seedLink(getPool(), A, {
      sortKey: 'a1',
      url: 'https://x.com/second',
      text: { locale: 'en', label: 'Second' },
    })
    const first = await seedLink(getPool(), A, {
      sortKey: 'a0',
      url: 'https://x.com',
      text: { locale: 'en', label: 'Twitter' },
    })
    await seedLink(getPool(), B, { sortKey: 'a0' })
    const deps = realLinkDeps()
    const listCategories = vi.fn(deps.portalLinkRepo.listCategories)

    const result = await listPortalLinks({
      ...deps,
      portalLinkRepo: { ...deps.portalLinkRepo, listCategories },
    })({ portalId: A.portalId }, manager())

    expect(result.links.map((link) => [link.id, link.url, link.organizationId])).toEqual([
      [first.id, 'https://x.com', ORG_A],
      [second.id, 'https://x.com/second', ORG_A],
    ])
    expect(listCategories).not.toHaveBeenCalled()
  })

  it('returns no links when the portal has none', async () => {
    const result = await list()({ portalId: A.portalId }, manager())

    expect(result.links).toHaveLength(0)
  })

  it('refuses a role that cannot read Portals, and a manager not assigned to the Property', async () => {
    await expect(
      list()(
        { portalId: A.portalId },
        tenantContext(A, 'Member', { effectivePermissions: new Set() }),
      ),
    ).rejects.toSatisfy(refusal('forbidden'))
    await expect(
      list({ accessible: [propertyId(randomUUID())] })(
        { portalId: A.portalId },
        manager(),
      ),
    ).rejects.toSatisfy(refusal('forbidden'))
  })

  it("answers portal_not_found for another Organization's Portal, listing none of its links", async () => {
    await seedLink(getPool(), A)

    await expect(list()({ portalId: A.portalId }, tenantContext(B))).rejects.toSatisfy(
      refusal('portal_not_found'),
    )
    expect((await list()({ portalId: B.portalId }, tenantContext(B))).links).toEqual([])
  })
})

describe('getPortalLinktree (real PostgreSQL)', () => {
  const read = (options: Parameters<typeof realLinkDeps>[0] = {}) =>
    getPortalLinktree(realLinkDeps(options))

  const insertAsset = async (overrides: Partial<PortalMediaAsset> = {}) => {
    const asset = buildTestPortalMediaAsset({
      organizationId: A.organizationId,
      propertyId: A.propertyId,
      purpose: 'link_image',
      width: 1200,
      height: 800,
      ...overrides,
    })
    await createPortalMediaAssetRepository(getDb()).insert(asset)
    return asset
  }

  /** A link an AccountAdmin added, so its address is approved by that admin. */
  const addApprovedMenu = async () => {
    const link = await createLink(realLinkDeps())(
      {
        categoryId: A.categoryId,
        portalId: A.portalId,
        label: 'Menu',
        url: 'https://avela.bg/menu',
        iconKey: 'utensils',
      },
      tenantContext(A, 'AccountAdmin'),
    )
    return link
  }

  const seedOverrides = async () => {
    await getPool().query(
      `INSERT INTO portal_localized_overrides
         (id, organization_id, property_id, portal_id, locale, linktree_title, updated_by)
       VALUES ($1, $2, $3, $4, 'en', 'Around the resort', $5)`,
      [randomUUID(), ORG_A, A.propertyId, A.portalId, A.manager],
    )
  }

  it('returns the switch, the titles and each link with its texts and approval', async () => {
    await seedOverrides()
    const link = await addApprovedMenu()
    // Written before texts existed: no text row, the label column is the name.
    await getPool().query(`DELETE FROM portal_link_texts WHERE link_id = $1`, [link.id])
    await getPool().query(`UPDATE portal_links SET label = 'Menu' WHERE id = $1`, [
      link.id,
    ])

    const view = await read()({ portalId: A.portalId }, manager())

    expect(view).toMatchObject({
      portalId: A.portalId,
      enabled: true,
      maxLinks: 4,
      locales: ['en', 'bg'],
      titles: { en: 'Around the resort' },
    })
    expect(view.links).toHaveLength(1)
    expect(view.links[0]).toMatchObject({
      id: link.id,
      iconKey: 'utensils',
      // No text row yet: the link's own label stands in for the primary language.
      texts: [{ locale: 'en', label: 'Menu', line: null }],
      destination: { state: 'approved', approvedByUserId: 'admin-link-world' },
    })
  })

  it('reads the saved texts of every language', async () => {
    const link = await seedLink(getPool(), A, {
      text: { locale: 'en', label: 'Olive Terrace menu', line: 'Lunch and dinner' },
    })
    await seedLinkText(getPool(), A, link.id, { locale: 'bg', label: 'Меню', line: null })

    const view = await read()({ portalId: A.portalId }, manager())

    expect(
      view.links[0]?.texts.map((text) => [text.locale, text.label, text.line]),
    ).toEqual([
      ['en', 'Olive Terrace menu', 'Lunch and dinner'],
      ['bg', 'Меню', null],
    ])
  })

  describe('a tile picture', () => {
    it('hands the editor the picture of a tile while it can be served', async () => {
      const asset = await insertAsset()
      await seedLink(getPool(), A, { imageAssetId: asset.id })

      const view = await read()({ portalId: A.portalId }, manager())

      expect(view.links.find((l) => l.imageAssetId !== null)?.imageAssetId).toBe(asset.id)
    })

    it('shows a tile as having no picture once its picture is taken down, so the editor offers the icon', async () => {
      const asset = await insertAsset({
        status: 'taken_down',
        takenDownAt: new Date(CLOCK),
      })
      await seedLink(getPool(), A, { imageAssetId: asset.id })

      const view = await read()({ portalId: A.portalId }, manager())

      expect(view.links).toHaveLength(1)
      expect(view.links.every((l) => l.imageAssetId === null)).toBe(true)
    })
  })

  it('refuses a role that cannot read Portals', async () => {
    await expect(
      read()(
        { portalId: A.portalId },
        tenantContext(A, 'Member', { effectivePermissions: new Set() }),
      ),
    ).rejects.toSatisfy(refusal('forbidden'))
  })

  it('refuses a Portal of a Property the manager is not assigned to', async () => {
    await expect(
      read({ accessible: [propertyId(randomUUID())] })(
        { portalId: A.portalId },
        manager(),
      ),
    ).rejects.toSatisfy(isPortalError)
  })

  it('reports a Portal that does not exist', async () => {
    await expect(read()({ portalId: randomUUID() }, manager())).rejects.toSatisfy(
      refusal('portal_not_found'),
    )
  })

  it("shows another Organization's manager none of the Portal, its links or its titles", async () => {
    await seedOverrides()
    await seedLink(getPool(), A, { text: { locale: 'en', label: 'Mine' } })
    await seedLink(getPool(), B, { text: { locale: 'en', label: 'Theirs' } })
    const before = await countRows(getPool(), 'portal_links', ORG_A)

    await expect(read()({ portalId: A.portalId }, tenantContext(B))).rejects.toSatisfy(
      refusal('portal_not_found'),
    )
    const own = await read()({ portalId: B.portalId }, tenantContext(B))

    expect(own.titles).toEqual({})
    expect(own.links.map((link) => link.texts.map((text) => text.label))).toEqual([
      ['Theirs'],
    ])
    expect(await countRows(getPool(), 'portal_links', ORG_A)).toBe(before)
  })
})
