// The updateLink and deleteLink use cases over real repositories and the real
// command store, with two Organizations: what each command answers, what it
// stores (the link, its primary-language text, the tile picture), the facts it
// leaves in the outbox and the address a link prints.

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
import { organizationId } from '#/shared/domain/ids'
import type { PortalMediaAsset } from '../domain/portal-media-asset'
import { deleteLink } from '../application/use-cases/delete-link'
import { updateLink } from '../application/use-cases/update-link'
import { isPortalError } from '../domain/errors'
import { createPortalMediaAssetRepository } from '../infrastructure/repositories/portal-media-asset.repository'
import type { PortalCommandStore } from './portal-command-store-port.server'
import {
  LINK_WORLD_TABLES,
  bindLinkWorld,
  countRows,
  linkTenant,
  outboxPayloads,
  portalUpdatedAt,
  realLinkDeps,
  rowsOf,
  seedLink,
  seedLinkTenant,
  seedLinkText,
  tenantContext,
} from '../infrastructure/testing/portal-link-use-case-world'

const ORG_A = organizationId('org-lnkupdate-0000-0000-000000000001')
const ORG_B = organizationId('org-lnkupdate-0000-0000-000000000002')
const A = linkTenant('b8e20001', ORG_A)
const B = linkTenant('b8e20002', ORG_B)
// A second Property of Organization A, whose pictures a tile of A may not wear.
const A_OTHER = linkTenant('b8e20003', ORG_A)
// After the Portal was created, so a command's revision is its own clock reading.
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

const update = (options: Parameters<typeof realLinkDeps>[0] = {}) =>
  updateLink(realLinkDeps({ clock: () => CLOCK, ...options }))
const remove = (options: Parameters<typeof realLinkDeps>[0] = {}) =>
  deleteLink(realLinkDeps({ clock: () => CLOCK, ...options }))

const admin = () => tenantContext(A, 'AccountAdmin')
const manager = () => tenantContext(A)

const linkRows = (tenant = A) =>
  rowsOf<{
    id: string
    label: string
    url: string
    icon_key: string | null
    image_asset_id: string | null
  }>(
    getPool(),
    `SELECT l.id, l.label, COALESCE(d.normalized_uri, l.url) AS url, l.icon_key,
            l.image_asset_id
       FROM portal_links l
       LEFT JOIN portal_approved_destinations d
         ON d.organization_id = l.organization_id AND d.id = l.destination_id
      WHERE l.organization_id = $1 ORDER BY l.sort_key`,
    [tenant.organizationId],
  )

const textRows = (linkId: string) =>
  rowsOf<{ locale: string; label: string; line: string | null; version: number }>(
    getPool(),
    `SELECT locale, label, line, version FROM portal_link_texts
      WHERE link_id = $1 ORDER BY locale`,
    [linkId],
  )

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

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await seedLinkTenant(getPool(), A, { additionalGuestLocales: ['bg'] })
  await seedLinkTenant(getPool(), B)
  await seedLinkTenant(getPool(), A_OTHER)
})

describe('updateLink (real PostgreSQL)', () => {
  it('updates label and URL, and records the fact at the revision it wrote', async () => {
    const link = await seedLink(getPool(), A, { text: { locale: 'en', label: 'Old' } })

    const updated = await update()(
      { linkId: link.id, label: 'New Label', url: 'https://new.com' },
      admin(),
    )

    expect(updated.label).toBe('New Label')
    expect(updated.url).toBe('https://new.com/')
    expect((await linkRows())[0]).toMatchObject({ id: link.id, url: 'https://new.com/' })
    const facts = await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')
    expect(facts).toEqual([
      expect.objectContaining({
        linkId: link.id,
        occurredAt: CLOCK.toISOString(),
        sourceAggregateVersion: (await portalUpdatedAt(getPool(), A)).toISOString(),
      }),
    ])
  })

  it('keeps the primary-language text in step with the label, and keeps its line', async () => {
    const link = await seedLink(getPool(), A, {
      text: { locale: 'en', label: 'Old label', line: 'Open daily' },
    })

    await update()({ linkId: link.id, label: 'New label' }, manager())

    expect(await textRows(link.id)).toEqual([
      { locale: 'en', label: 'New label', line: 'Open daily', version: 2 },
    ])
  })

  it('leaves the primary-language text and the legacy label alone when no label is sent', async () => {
    const link = await seedLink(getPool(), A, {
      text: { locale: 'en', label: 'Current wording' },
    })

    const updated = await update()({ linkId: link.id, iconKey: 'info' }, manager())

    expect(await textRows(link.id)).toEqual([
      { locale: 'en', label: 'Current wording', line: null, version: 1 },
    ])
    expect(updated.label).toBe('')
    expect((await linkRows())[0]?.label).toBe('')
  })

  it('creates the primary-language text for a link that never had one', async () => {
    const link = await seedLink(getPool(), A, { text: null, legacyLabel: 'Old label' })

    await update()({ linkId: link.id, label: 'New label' }, manager())

    expect(await textRows(link.id)).toMatchObject([{ locale: 'en', label: 'New label' }])
  })

  it('refuses an icon outside the closed set with a PortalError, before any write', async () => {
    const link = await seedLink(getPool(), A, { iconKey: 'star' })

    await expect(
      update()({ linkId: link.id, iconKey: 'google' }, manager()),
    ).rejects.toMatchObject({ code: 'invalid_icon' })

    expect((await linkRows())[0]?.icon_key).toBe('star')
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')).toEqual([])
  })

  it('clears the icon when given null', async () => {
    const link = await seedLink(getPool(), A, { iconKey: 'star' })

    const updated = await update()({ linkId: link.id, iconKey: null }, manager())

    expect(updated.iconKey).toBeNull()
    expect((await linkRows())[0]?.icon_key).toBeNull()
  })

  it('rejects when the Portal revision advanced after the link was read, and writes nothing', async () => {
    const link = await seedLink(getPool(), A, { url: 'https://old.example' })
    const racing = (store: PortalCommandStore): PortalCommandStore => ({
      ...store,
      updatePortalLink: async (command) => {
        await getPool().query(`UPDATE portals SET updated_at = $2 WHERE id = $1`, [
          A.portalId,
          new Date(command.revision.getTime() + 60_000),
        ])
        return store.updatePortalLink(command)
      },
    })

    await expect(
      update({ wrapStore: racing })({ linkId: link.id, label: 'New Label' }, manager()),
    ).rejects.toSatisfy(refusal('revision_conflict'))

    expect((await linkRows())[0]?.url).toBe('https://old.example')
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')).toEqual([])
  })

  it('rejects users who cannot update', async () => {
    const link = await seedLink(getPool(), A)

    await expect(
      update()({ linkId: link.id, label: 'Test' }, tenantContext(A, 'Member')),
    ).rejects.toSatisfy(refusal('forbidden'))
  })

  it('rejects when the link is not found', async () => {
    await expect(
      update()({ linkId: randomUUID(), label: 'Test' }, manager()),
    ).rejects.toSatisfy(refusal('link_not_found'))
  })

  it('rejects an empty label and an invalid URL', async () => {
    const link = await seedLink(getPool(), A)

    await expect(update()({ linkId: link.id, label: '' }, manager())).rejects.toSatisfy(
      refusal('invalid_label'),
    )
    await expect(
      update()({ linkId: link.id, url: 'bad-url' }, manager()),
    ).rejects.toSatisfy(refusal('invalid_url'))
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')).toEqual([])
  })

  it('returns the existing link unchanged, and writes nothing, when no fields are provided', async () => {
    const link = await seedLink(getPool(), A, {
      legacyLabel: 'Original',
      text: { locale: 'en', label: 'Original' },
    })
    const before = await portalUpdatedAt(getPool(), A)

    const updated = await update()({ linkId: link.id }, manager())

    expect(updated.label).toBe('Original')
    expect(await portalUpdatedAt(getPool(), A)).toEqual(before)
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')).toEqual([])
  })

  it('rejects a PropertyManager without assignment to the property, and allows an assigned one', async () => {
    const link = await seedLink(getPool(), A)

    await expect(
      update({ accessible: [] })({ linkId: link.id, label: 'New' }, manager()),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await textRows(link.id)).toMatchObject([{ label: 'Link' }])

    const updated = await update({ accessible: [A.propertyId] })(
      { linkId: link.id, label: 'New' },
      manager(),
    )

    expect(updated.label).toBe('New')
    expect(await textRows(link.id)).toMatchObject([{ label: 'New' }])
  })

  it("answers link_not_found for another Organization's link, and changes nothing in it", async () => {
    const theirs = await seedLink(getPool(), B, {
      text: { locale: 'en', label: 'Theirs' },
    })
    const before = await linkRows(B)

    await expect(
      update()({ linkId: theirs.id, label: 'Mine now' }, admin()),
    ).rejects.toSatisfy(refusal('link_not_found'))

    expect(await linkRows(B)).toEqual(before)
    expect(await textRows(theirs.id)).toMatchObject([{ label: 'Theirs', version: 1 }])
    expect(await countRows(getPool(), 'outbox_events', ORG_B)).toBe(1)
  })
})

describe('updateLink tile photo (real PostgreSQL)', () => {
  const arrange = async () => {
    const link = await seedLink(getPool(), A, { iconKey: 'star' })
    const photo = await insertAsset()
    return { link, photo }
  }

  it('puts an uploaded picture of this Property on the link', async () => {
    const { link, photo } = await arrange()

    const updated = await update()({ linkId: link.id, imageAssetId: photo.id }, manager())

    expect(updated.imageAssetId).toBe(photo.id)
    expect((await linkRows())[0]?.image_asset_id).toBe(photo.id)
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')).toHaveLength(1)
  })

  it('keeps the icon when a picture is added, and the picture when only the label changes', async () => {
    const { link, photo } = await arrange()

    const withPhoto = await update()(
      { linkId: link.id, imageAssetId: photo.id },
      manager(),
    )
    const relabelled = await update()({ linkId: link.id, label: 'Menu' }, manager())

    expect(withPhoto.iconKey).toBe('star')
    expect(relabelled.imageAssetId).toBe(photo.id)
    expect((await linkRows())[0]).toMatchObject({
      icon_key: 'star',
      image_asset_id: photo.id,
    })
  })

  it('takes the picture off with null, in one write with the icon that replaces it', async () => {
    const { link, photo } = await arrange()
    await update()({ linkId: link.id, imageAssetId: photo.id }, manager())

    const updated = await update()(
      { linkId: link.id, iconKey: 'map-pin', imageAssetId: null },
      manager(),
    )

    expect(updated.imageAssetId).toBeNull()
    expect((await linkRows())[0]).toMatchObject({
      icon_key: 'map-pin',
      image_asset_id: null,
    })
  })

  const refused: ReadonlyArray<readonly [string, () => Promise<{ id: string }>]> = [
    ['an asset that does not exist', async () => ({ id: randomUUID() })],
    [
      'an asset of another Property',
      () => insertAsset({ propertyId: A_OTHER.propertyId }),
    ],
    [
      'an asset of another Organization',
      () =>
        insertAsset({
          organizationId: B.organizationId,
          propertyId: B.propertyId,
        }),
    ],
    ['an image uploaded as a hero photo', () => insertAsset({ purpose: 'hero' })],
    ['an image uploaded as a logo', () => insertAsset({ purpose: 'logo' })],
    [
      'an image that was taken down',
      () => insertAsset({ status: 'taken_down', takenDownAt: new Date(CLOCK) }),
    ],
  ]
  it.each(refused)('refuses %s, before any write', async (_name, makeAsset) => {
    const link = await seedLink(getPool(), A, { iconKey: 'star' })
    const asset = await makeAsset()

    await expect(
      update()({ linkId: link.id, imageAssetId: asset.id }, manager()),
    ).rejects.toMatchObject({ code: 'media_not_found' })

    expect((await linkRows())[0]?.image_asset_id).toBeNull()
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.updated')).toEqual([])
  })

  it('refuses an id that is not a UUID without asking the store', async () => {
    const { link } = await arrange()

    await expect(
      update()({ linkId: link.id, imageAssetId: 'not-a-uuid' }, manager()),
    ).rejects.toMatchObject({ code: 'media_not_found' })
  })

  it('does not look the picture up when the caller left it alone', async () => {
    const { link } = await arrange()
    const deps = realLinkDeps({ clock: () => CLOCK })
    const lookup = vi.fn(deps.mediaRepo.findById)

    await updateLink({ ...deps, mediaRepo: { findById: lookup } })(
      { linkId: link.id, label: 'Menu' },
      manager(),
    )

    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('updateLink to a phone number or an email address (real PostgreSQL)', () => {
  const arrange = (options: Parameters<typeof seedLink>[2] = {}) =>
    seedLink(getPool(), A, options)

  it('stores the number in its one form and gives a tile with no icon a phone', async () => {
    const link = await arrange()

    const updated = await update()(
      { linkId: link.id, url: '+44 20 7946 0958' },
      manager(),
    )

    expect(updated.url).toBe('tel:+442079460958')
    expect(updated.iconKey).toBe('phone')
    expect((await linkRows())[0]).toMatchObject({
      url: 'tel:+442079460958',
      icon_key: 'phone',
    })
  })

  it('gives a tile with no icon a letter for an email address', async () => {
    const link = await arrange()

    const updated = await update()(
      { linkId: link.id, url: 'mailto:front@hotel.com' },
      manager(),
    )

    expect(updated.url).toBe('mailto:front@hotel.com')
    expect(updated.iconKey).toBe('mail')
  })

  it('keeps an icon or a photo the tile already wears', async () => {
    const withIcon = await arrange({ iconKey: 'concierge-bell' })
    expect(
      (await update()({ linkId: withIcon.id, url: 'front@hotel.com' }, manager()))
        .iconKey,
    ).toBe('concierge-bell')

    const photo = await insertAsset()
    const withPhoto = await arrange({ imageAssetId: photo.id, sortKey: 'a1' })
    expect(
      (await update()({ linkId: withPhoto.id, url: '5551234567' }, manager())).iconKey,
    ).toBeNull()
  })

  it.each([
    ['tel:+15551234567', 'phone', 'front@hotel.com', 'mail'],
    ['mailto:front@hotel.com', 'mail', '+15551234567', 'phone'],
    ['tel:+15551234567', 'phone', 'https://hotel.example.com/spa', null],
  ] as const)(
    'swaps the automatic icon of %s (%s) for that of %s',
    async (url, iconKey, nextUrl, nextIcon) => {
      const link = await arrange({ url, iconKey })

      const updated = await update()({ linkId: link.id, url: nextUrl }, admin())

      expect(updated.iconKey).toBe(nextIcon)
      expect((await linkRows())[0]?.icon_key).toBe(nextIcon)
    },
  )

  it('keeps an icon that is not the automatic one for the old address', async () => {
    // A phone on a website tile was chosen, and so was a letter on a phone tile.
    const onSite = await arrange({ url: 'https://hotel.example.com', iconKey: 'phone' })
    expect(
      (await update()({ linkId: onSite.id, url: 'front@hotel.com' }, manager())).iconKey,
    ).toBe('phone')
    const onPhone = await arrange({
      url: 'tel:+15551234567',
      iconKey: 'mail',
      sortKey: 'a1',
    })
    expect(
      (await update()({ linkId: onPhone.id, url: 'https://hotel.example.com' }, admin()))
        .iconKey,
    ).toBe('mail')
  })

  it('takes the icon asked for in the same write', async () => {
    const link = await arrange()

    const updated = await update()(
      { linkId: link.id, url: '5551234567', iconKey: 'info' },
      manager(),
    )

    expect(updated.iconKey).toBe('info')
  })

  it('refuses a number with an extension or an address with a second recipient', async () => {
    const link = await arrange()

    for (const url of ['tel:+1555123456;ext=2', 'front@hotel.com,spy@evil.com']) {
      await expect(update()({ linkId: link.id, url }, manager())).rejects.toMatchObject({
        code: 'invalid_url',
      })
    }
    expect(await countRows(getPool(), 'portal_approved_destinations', ORG_A)).toBe(0)
  })
})

describe('deleteLink (real PostgreSQL)', () => {
  it('deletes an existing link with its texts, and records the fact', async () => {
    const link = await seedLink(getPool(), A)
    await seedLinkText(getPool(), A, link.id, { locale: 'bg', label: 'Връзка' })

    await remove()({ linkId: link.id }, manager())

    expect(await linkRows()).toEqual([])
    expect(await textRows(link.id)).toEqual([])
    expect(await outboxPayloads(getPool(), ORG_A, 'portal_link.deleted')).toEqual([
      expect.objectContaining({ linkId: link.id, occurredAt: CLOCK.toISOString() }),
    ])
  })

  it('rejects users who cannot delete', async () => {
    const link = await seedLink(getPool(), A)

    await expect(
      remove()({ linkId: link.id }, tenantContext(A, 'Member')),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await linkRows()).toHaveLength(1)
  })

  it('rejects when the link is not found', async () => {
    await expect(remove()({ linkId: randomUUID() }, manager())).rejects.toSatisfy(
      refusal('link_not_found'),
    )
  })

  it('rejects a PropertyManager without assignment to the property, and allows an assigned one', async () => {
    const link = await seedLink(getPool(), A)

    await expect(
      remove({ accessible: [] })({ linkId: link.id }, manager()),
    ).rejects.toSatisfy(refusal('forbidden'))
    expect(await linkRows()).toHaveLength(1)

    await remove({ accessible: [A.propertyId] })({ linkId: link.id }, manager())

    expect(await linkRows()).toHaveLength(0)
  })

  it("answers link_not_found for another Organization's link, and keeps it", async () => {
    const theirs = await seedLink(getPool(), B)
    const mine = await seedLink(getPool(), A, { sortKey: 'a1' })

    await expect(remove()({ linkId: theirs.id }, admin())).rejects.toSatisfy(
      refusal('link_not_found'),
    )

    expect(await linkRows(B)).toHaveLength(1)
    expect(await textRows(theirs.id)).toHaveLength(1)
    expect(await linkRows()).toMatchObject([{ id: mine.id }])
    expect(await outboxPayloads(getPool(), ORG_B, 'portal_link.deleted')).toEqual([])
  })
})
