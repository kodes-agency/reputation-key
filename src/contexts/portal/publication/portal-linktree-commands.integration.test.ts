// Linktree working model (round 4, slices 10 and 44) against real PostgreSQL: the
// link cap under the Portal row lock, the primary-language text as the only
// name of a link (the legacy `portal_links.label` is never written), per-language texts, the section title and switch, and the pending-change rows
// each of them records. Migration backfill lives in portal-linktree-backfill.

import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildTestPortalLink } from '#/shared/testing/fixtures'
import { portalLinkCategoryId, portalLinkId } from '#/shared/domain/ids'
import { portalLinkCreated, portalLinkDeleted, portalLinkUpdated } from '../domain/events'
import {
  base,
  CATEGORY_A,
  createLink,
  linkCount,
  linkLabel,
  MANAGER,
  ORG_A,
  pageEdits,
  pageEditWording,
  pendingKeys,
  PORTAL_A,
  portalRevision,
  PROPERTY_A,
  renameLink,
  saveTexts,
  seedLegacyLink,
  seedPublishedSnapshot,
  setupLinktreeCommandsTestDb,
  store,
  switchPrimary,
  textRows,
} from './portal-linktree-commands.test-fixtures'

const { getPool } = setupLinktreeCommandsTestDb()

describe.sequential('Linktree commands (real PostgreSQL)', () => {
  describe('creating a link', () => {
    it('writes the link and its primary-language text together', async () => {
      const id = await createLink('City guide', 'a0')

      expect(await linkLabel(id)).toBe('')
      expect(await textRows(id)).toEqual([
        {
          locale: 'en',
          label: 'City guide',
          line: null,
          provenance: null,
          version: 1,
          updated_by: MANAGER,
        },
      ])
    })

    it('writes the text in the Portal primary language, never a default', async () => {
      await getPool().query(
        `UPDATE portals SET primary_guest_locale = 'bg', additional_guest_locales = '["en"]'::jsonb
         WHERE organization_id = $1 AND id = $2`,
        [ORG_A, PORTAL_A],
      )
      const id = await createLink('Градски справочник', 'a0')

      expect((await textRows(id)).map((row) => row.locale)).toEqual(['bg'])
    })

    it('refuses a fifth link and writes nothing', async () => {
      for (const [index, label] of ['One', 'Two', 'Three', 'Four'].entries()) {
        await createLink(label, `a${index}`)
      }
      const before = await portalRevision()

      await expect(createLink('Five', 'a4')).rejects.toMatchObject({
        _tag: 'PortalError',
        code: 'link_limit_reached',
      })

      expect(await linkCount()).toBe(4)
      expect(await portalRevision()).toEqual(before)
      const texts = await getPool().query(
        `SELECT count(*)::int AS n FROM portal_link_texts WHERE organization_id = $1`,
        [ORG_A],
      )
      expect(texts.rows[0].n).toBe(4)
    })

    it('keeps the links of a Portal that already has more, and adds no more', async () => {
      for (let index = 0; index < 6; index += 1) {
        await seedLegacyLink(`Old ${index}`, `b${index}`)
      }

      await expect(createLink('New', 'c0')).rejects.toMatchObject({
        code: 'link_limit_reached',
      })

      expect(await linkCount()).toBe(6)
    })

    it('serialises two creates from one revision: the Portal fence lets one in, the other is a revision conflict', async () => {
      for (const [index, label] of ['One', 'Two', 'Three'].entries()) {
        await createLink(label, `a${index}`)
      }
      const commandFor = async (sortKey: string) => {
        const command = await base()
        const id = portalLinkId(randomUUID())
        return {
          ...command,
          actorUserId: MANAGER,
          link: buildTestPortalLink({
            id,
            categoryId: CATEGORY_A,
            portalId: PORTAL_A,
            organizationId: ORG_A,
            propertyId: PROPERTY_A,
            label: sortKey,
            url: `https://example.test/${id}`,
            sortKey,
            createdAt: command.occurredAt,
            updatedAt: command.occurredAt,
          }),
          label: sortKey,
          event: portalLinkCreated({
            portalId: PORTAL_A,
            linkId: id,
            categoryId: CATEGORY_A,
            organizationId: ORG_A,
            propertyId: PROPERTY_A,
            sourceAggregateVersion: command.revision.toISOString(),
            occurredAt: command.occurredAt,
          }),
        }
      }
      const first = await commandFor('x1')
      const second = await commandFor('x2')

      const results = await Promise.allSettled([
        store().createPortalLink(first),
        store().createPortalLink(second),
      ])

      // Both commands read the same Portal revision, so the fence (not the cap)
      // rejects the loser; the cap itself is covered by 'refuses a fifth link'.
      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      const rejected = results.find((result) => result.status === 'rejected')
      expect(rejected?.status === 'rejected' && rejected.reason).toMatchObject({
        code: 'revision_conflict',
      })
      expect(await linkCount()).toBe(4)
    })
  })

  describe('saving link texts', () => {
    it('writes every language as a text and leaves the legacy label column alone', async () => {
      const id = await createLink('City guide', 'a0')

      await saveTexts(id, [
        { locale: 'en', label: 'Explore the city', line: 'Maps and tips' },
        { locale: 'bg', label: 'Разгледайте града', line: null },
      ])

      expect(await linkLabel(id)).toBe('')
      expect(await textRows(id)).toEqual([
        expect.objectContaining({
          locale: 'bg',
          label: 'Разгледайте града',
          line: null,
          version: 1,
        }),
        expect.objectContaining({
          locale: 'en',
          label: 'Explore the city',
          line: 'Maps and tips',
          version: 2,
        }),
      ])
    })

    it('does not touch the link row when a text is saved', async () => {
      const id = await createLink('City guide', 'a0')
      const before = (
        await getPool().query(
          `SELECT label, updated_at FROM portal_links WHERE organization_id = $1 AND id = $2`,
          [ORG_A, id],
        )
      ).rows[0]

      await saveTexts(id, [
        { locale: 'en', label: 'Explore the city' },
        { locale: 'bg', label: 'Градски справочник' },
      ])

      expect(
        (
          await getPool().query(
            `SELECT label, updated_at FROM portal_links WHERE organization_id = $1 AND id = $2`,
            [ORG_A, id],
          )
        ).rows[0],
      ).toEqual(before)
    })

    it('records one structured pending row per changed text', async () => {
      await seedPublishedSnapshot()
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [
        { locale: 'en', label: 'Explore the city' },
        { locale: 'bg', label: 'Разгледайте града' },
      ])

      const keys = await pendingKeys()

      expect(keys).toContain(`portal_links|link:${id}:text:en`)
      expect(keys).toContain(`portal_links|link:${id}:text:bg`)
    })

    it('names who changed each text in the page-edit ledger, before any publication too', async () => {
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [
        { locale: 'en', label: 'Explore the city' },
        { locale: 'bg', label: 'Разгледайте града' },
      ])

      expect(await pendingKeys()).toEqual([])
      const edits = await pageEdits()
      expect(edits).toContain(`portal_links|link:${id}:text:en|${MANAGER}`)
      expect(edits).toContain(`portal_links|link:${id}:text:bg|${MANAGER}`)
    })

    it('keeps the label before and after, folding saves of one language into one entry', async () => {
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [{ locale: 'bg', label: 'Градски справочник' }])
      await saveTexts(id, [{ locale: 'bg', label: 'Градски гид' }])
      await saveTexts(id, [{ locale: 'bg', label: 'Градски гид', line: 'Две минути' }])

      const wording = await pageEditWording()
      // The first save of a language that had no text says there was none before;
      // the next two are the same sitting, so they fold: first before, latest after.
      expect(wording.get(`link:${id}:text:bg`)).toEqual([null, 'Градски гид', 3])
    })

    it('records nothing for a text that did not change', async () => {
      await seedPublishedSnapshot()
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [{ locale: 'bg', label: 'Градски справочник' }])
      const before = await pendingKeys()

      const editsBefore = await pageEdits()
      await saveTexts(id, [{ locale: 'bg', label: 'Градски справочник' }])

      expect(await pendingKeys()).toEqual(before)
      expect(await pageEdits()).toEqual(editsBefore)
      expect((await textRows(id)).find((row) => row.locale === 'bg')?.version).toBe(1)
    })

    it('refuses a language the Portal does not offer', async () => {
      const id = await createLink('City guide', 'a0')
      const command = await base()

      await expect(
        store().savePortalLinkTexts({
          ...command,
          actorUserId: MANAGER,
          linkId: portalLinkId(id),
          categoryId: CATEGORY_A,
          texts: [{ locale: 'de', label: 'Stadtführer', line: null, provenance: null }],
          event: portalLinkUpdated({
            portalId: PORTAL_A,
            linkId: portalLinkId(id),
            categoryId: CATEGORY_A,
            organizationId: ORG_A,
            propertyId: PROPERTY_A,
            sourceAggregateVersion: command.revision.toISOString(),
            occurredAt: command.occurredAt,
          }),
        }),
      ).rejects.toMatchObject({ code: 'locale_not_offered' })

      expect((await textRows(id)).map((row) => row.locale)).toEqual(['en'])
    })

    it('fences on the Portal revision and writes nothing when it is stale', async () => {
      const id = await createLink('City guide', 'a0')
      const command = await base()

      await expect(
        store().savePortalLinkTexts({
          ...command,
          expectedPortalUpdatedAt: new Date(
            command.expectedPortalUpdatedAt.getTime() - 1,
          ),
          actorUserId: MANAGER,
          linkId: portalLinkId(id),
          categoryId: CATEGORY_A,
          texts: [{ locale: 'en', label: 'Stale', line: null, provenance: null }],
          event: portalLinkUpdated({
            portalId: PORTAL_A,
            linkId: portalLinkId(id),
            categoryId: CATEGORY_A,
            organizationId: ORG_A,
            propertyId: PROPERTY_A,
            sourceAggregateVersion: command.revision.toISOString(),
            occurredAt: command.occurredAt,
          }),
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' })

      expect(await linkLabel(id)).toBe('')
      expect((await textRows(id))[0]?.label).toBe('City guide')
    })

    it('cannot reach a link of another Portal', async () => {
      const foreign = await seedLegacyLink('Elsewhere', 'z0')
      const command = await base()

      await expect(
        store().savePortalLinkTexts({
          ...command,
          actorUserId: MANAGER,
          linkId: portalLinkId(foreign),
          categoryId: portalLinkCategoryId('8c000000-0000-4000-8000-0000000000ff'),
          texts: [{ locale: 'en', label: 'Nope', line: null, provenance: null }],
          event: portalLinkUpdated({
            portalId: PORTAL_A,
            linkId: portalLinkId(foreign),
            categoryId: portalLinkCategoryId('8c000000-0000-4000-8000-0000000000ff'),
            organizationId: ORG_A,
            propertyId: PROPERTY_A,
            sourceAggregateVersion: command.revision.toISOString(),
            occurredAt: command.occurredAt,
          }),
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' })

      expect(await textRows(foreign)).toEqual([])
    })
  })

  describe('updating and deleting a link', () => {
    async function updateLinkWith(id: string, patch: Record<string, unknown>) {
      const command = await base()
      await store().updatePortalLink({
        ...command,
        actorUserId: MANAGER,
        linkId: portalLinkId(id),
        categoryId: CATEGORY_A,
        patch: {
          url: `https://example.test/${id}`,
          destinationId: null,
          legacyDestinationState: 'unclassified',
          iconKey: null,
          imageAssetId: null,
          ...patch,
        },
        event: portalLinkUpdated({
          portalId: PORTAL_A,
          linkId: portalLinkId(id),
          categoryId: CATEGORY_A,
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          sourceAggregateVersion: command.revision.toISOString(),
          occurredAt: command.occurredAt,
        }),
      })
    }

    it('renames a link in its primary text and never in the legacy label column', async () => {
      const id = await createLink('City guide', 'a0')

      await updateLinkWith(id, { label: 'Updated guide', iconKey: 'map-pin' })

      expect((await textRows(id))[0]).toMatchObject({
        locale: 'en',
        label: 'Updated guide',
        version: 2,
      })
      expect(await linkLabel(id)).toBe('')
    })

    it('leaves the primary text alone when an update carries no label', async () => {
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [{ locale: 'en', label: 'Explore the city', line: 'Maps' }])

      await updateLinkWith(id, { iconKey: 'map-pin' })

      expect((await textRows(id))[0]).toMatchObject({
        locale: 'en',
        label: 'Explore the city',
        line: 'Maps',
        version: 2,
      })
      expect(await linkLabel(id)).toBe('')
    })

    it('creates the primary text when a link written by old code is given a label', async () => {
      const id = await seedLegacyLink('Old label', 'a0')

      await updateLinkWith(id, { label: 'New label' })

      expect((await textRows(id)).map((row) => [row.locale, row.label])).toEqual([
        ['en', 'New label'],
      ])
      expect(await linkLabel(id)).toBe('Old label')
    })

    it('writes no text for a link without one when an update carries no label', async () => {
      const id = await seedLegacyLink('Old label', 'a0')

      await updateLinkWith(id, { iconKey: 'map-pin' })

      expect(await textRows(id)).toEqual([])
      expect(await linkLabel(id)).toBe('Old label')
    })

    it('records the wording a rename replaced, read from the primary text', async () => {
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [{ locale: 'en', label: 'Explore the city' }])

      await updateLinkWith(id, { label: 'Updated guide' })

      expect((await pageEditWording()).get(`link:${id}:updated`)).toEqual([
        'Explore the city',
        'Updated guide',
        1,
      ])
    })

    it('drops every text with its link', async () => {
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [{ locale: 'bg', label: 'Справочник' }])
      const command = await base()

      await store().deletePortalLink({
        ...command,
        actorUserId: MANAGER,
        linkId: portalLinkId(id),
        categoryId: CATEGORY_A,
        event: portalLinkDeleted({
          portalId: PORTAL_A,
          linkId: portalLinkId(id),
          categoryId: CATEGORY_A,
          organizationId: ORG_A,
          propertyId: PROPERTY_A,
          sourceAggregateVersion: command.revision.toISOString(),
          occurredAt: command.occurredAt,
        }),
      })

      expect(await textRows(id)).toEqual([])
    })
  })

  describe('changing the Portal primary language', () => {
    it('keeps naming the link in the new primary language when it is renamed after the switch', async () => {
      const id = await createLink('Menu', 'a0')

      await switchPrimary('bg', ['en'])
      await renameLink(id, 'Food menu')

      const rows = await textRows(id)
      expect(rows.map((row) => [row.locale, row.label])).toEqual([
        ['bg', 'Food menu'],
        ['en', 'Menu'],
      ])
      expect(await linkLabel(id)).toBe('')
    })

    it('starts the new primary text from the old primary text when it has none', async () => {
      const id = await createLink('Menu', 'a0')

      await switchPrimary('bg', ['en'])

      expect((await textRows(id)).map((row) => [row.locale, row.label])).toEqual([
        ['bg', 'Menu'],
        ['en', 'Menu'],
      ])
      expect(await linkLabel(id)).toBe('')
    })

    it('keeps a text already written in the new primary language', async () => {
      const id = await createLink('Menu', 'a0')
      await saveTexts(id, [{ locale: 'bg', label: 'Меню' }])

      await switchPrimary('bg', ['en'])

      expect((await textRows(id)).map((row) => [row.locale, row.label])).toEqual([
        ['bg', 'Меню'],
        ['en', 'Menu'],
      ])
      expect(await linkLabel(id)).toBe('')
    })

    it('invents no text for a link that has neither a text nor a label', async () => {
      const id = await seedLegacyLink('', 'a0')

      await switchPrimary('bg', ['en'])

      expect(await textRows(id)).toEqual([])
    })

    it('leaves texts alone when the primary language is not what changed', async () => {
      const id = await createLink('Menu', 'a0')
      await saveTexts(id, [{ locale: 'bg', label: 'Меню' }])

      await switchPrimary('en', ['bg'])

      expect(await linkLabel(id)).toBe('')
      expect((await textRows(id)).map((row) => [row.locale, row.label])).toEqual([
        ['bg', 'Меню'],
        ['en', 'Menu'],
      ])
    })
  })
})
