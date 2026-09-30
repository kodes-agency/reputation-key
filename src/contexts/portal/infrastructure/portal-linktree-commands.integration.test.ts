// Linktree working model (round 4, slice 10) against real PostgreSQL: the link
// cap under the Portal row lock, the dual write of the primary-language label,
// per-language texts, the section title and switch, and the pending-change rows
// each of them records. Migration backfill lives in portal-linktree-backfill.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal, buildTestPortalLink } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalId,
  portalLinkCategoryId,
  portalLinkId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import {
  portalCreated,
  portalLinkCreated,
  portalLinkDeleted,
  portalLinkUpdated,
  portalUpdated,
} from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'

const ORG_A = organizationId('org-linktree-0000-0000-000000000001')
const ORG_B = organizationId('org-linktree-0000-0000-000000000002')
const PROPERTY_A = propertyId('8a000000-0000-4000-8000-000000000001')
const PORTAL_A = portalId('8b000000-0000-4000-8000-000000000001')
const CATEGORY_A = portalLinkCategoryId('8c000000-0000-4000-8000-000000000001')
const MANAGER = userId('manager-linktree-0000000000000001')
const CREATED_AT = new Date('2026-09-30T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
    'portal_publication_snapshots',
    'portal_link_texts',
    'portal_localized_overrides',
    'portal_links',
    'portal_link_categories',
    'portal_responsible_managers',
    'outbox_events',
    'portals',
    'properties',
  ],
})

const store = () => createAtomicPortalCommandStore(getDb())

let tickCount = 0
const nextInstant = () => new Date(CREATED_AT.getTime() + (tickCount += 1) * 1000)

async function portalRevision(): Promise<Date> {
  const { rows } = await getPool().query(
    `SELECT updated_at FROM portals WHERE organization_id = $1 AND id = $2`,
    [ORG_A, PORTAL_A],
  )
  return rows[0].updated_at as Date
}

/** The fields every Portal content command shares, taken fresh from the database. */
async function base() {
  const revision = nextInstant()
  return {
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    portalId: PORTAL_A,
    expectedPortalUpdatedAt: await portalRevision(),
    revision,
    occurredAt: revision,
  }
}

beforeEach(async () => {
  tickCount = 0
  clearEventSchemas()
  registerAllEventSchemas()
  const portal = buildTestPortal({
    id: PORTAL_A,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    entityId: PROPERTY_A,
    name: 'Reception',
    slug: 'reception',
    createdBy: MANAGER,
    primaryGuestLocale: 'en',
    additionalGuestLocales: ['bg'],
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', $3, $3)`,
    [PROPERTY_A, ORG_A, CREATED_AT],
  )
  await store().createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerId: MANAGER,
    event: portalCreated({
      portalId: portal.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      publicationState: portal.publicationState,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: portal.createdAt,
    }),
  })
  await getPool().query(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                         created_at, updated_at)
     VALUES ($1, $2, $3, 'Links', 'a0', $4, $4)`,
    [CATEGORY_A, PORTAL_A, ORG_A, CREATED_AT],
  )
})

/** A link as code that predates the texts table wrote it: no text row. */
async function seedLegacyLink(label: string, sortKey: string): Promise<string> {
  const id = randomUUID()
  await getPool().query(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                               label, url, legacy_destination_state, sort_key,
                               created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $9, 'unclassified', $7, $8, $8)`,
    [
      id,
      CATEGORY_A,
      PORTAL_A,
      ORG_A,
      PROPERTY_A,
      label,
      sortKey,
      CREATED_AT,
      `https://example.test/${id}`,
    ],
  )
  return id
}

/** A publication snapshot makes the Portal "published once", so edits become pending. */
async function seedPublishedSnapshot(): Promise<void> {
  await getPool().query(
    `INSERT INTO portal_publication_snapshots (
       id, organization_id, property_id, portal_id, version, configuration_digest,
       configuration, guest_locale, language_pack_version, private_feedback_threshold,
       destination_uri, destination_retrieved_at, destination_source_epoch,
       destination_profile_version, created_by, created_at
     ) VALUES ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
               'https://example.test/review', $6, 0, 1, $7, $6)`,
    [randomUUID(), ORG_A, PROPERTY_A, PORTAL_A, 'a'.repeat(64), CREATED_AT, MANAGER],
  )
}

async function createLink(label: string, sortKey: string) {
  const command = await base()
  const id = portalLinkId(randomUUID())
  const link = buildTestPortalLink({
    id,
    categoryId: CATEGORY_A,
    portalId: PORTAL_A,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    label,
    url: `https://example.test/${id}`,
    sortKey,
    createdAt: command.occurredAt,
    updatedAt: command.occurredAt,
  })
  await store().createPortalLink({
    ...command,
    actorUserId: MANAGER,
    link,
    event: portalLinkCreated({
      portalId: PORTAL_A,
      linkId: id,
      categoryId: CATEGORY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
  return id
}

async function saveTexts(
  linkId: string,
  texts: ReadonlyArray<{
    locale: 'en' | 'bg'
    label: string
    line?: string | null
  }>,
) {
  const command = await base()
  await store().savePortalLinkTexts({
    ...command,
    actorUserId: MANAGER,
    linkId: portalLinkId(linkId),
    categoryId: CATEGORY_A,
    texts: texts.map((text) => ({
      locale: text.locale,
      label: text.label,
      line: text.line ?? null,
      provenance: null,
    })),
    event: portalLinkUpdated({
      portalId: PORTAL_A,
      linkId: portalLinkId(linkId),
      categoryId: CATEGORY_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
}

async function saveSettings(input: {
  enabled?: boolean
  titles?: ReadonlyArray<{ locale: 'en' | 'bg'; title: string | null }>
}) {
  const command = await base()
  await store().savePortalLinktreeSettings({
    ...command,
    actorUserId: MANAGER,
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    titles: (input.titles ?? []).map((title) => ({ ...title, overrideId: randomUUID() })),
    event: portalUpdated({
      portalId: PORTAL_A,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      previousPublicationState: 'published',
      publicationState: 'published',
      sourceAggregateVersion: command.revision.toISOString(),
      occurredAt: command.occurredAt,
    }),
  })
}

const textRows = async (linkId: string) =>
  (
    await getPool().query(
      `SELECT locale, label, line, provenance, version, updated_by
       FROM portal_link_texts WHERE organization_id = $1 AND link_id = $2
       ORDER BY locale`,
      [ORG_A, linkId],
    )
  ).rows

const linkLabel = async (linkId: string) =>
  (
    await getPool().query(
      `SELECT label FROM portal_links WHERE organization_id = $1 AND id = $2`,
      [ORG_A, linkId],
    )
  ).rows[0]?.label as string | undefined

const pendingKeys = async () =>
  (
    await getPool().query(
      `SELECT change_kind, change_key FROM portal_pending_content_changes
       WHERE organization_id = $1 AND portal_id = $2 ORDER BY change_key`,
      [ORG_A, PORTAL_A],
    )
  ).rows.map((row) => `${row.change_kind}|${row.change_key}`)

const linkCount = async () =>
  Number(
    (
      await getPool().query(
        `SELECT count(*)::int AS n FROM portal_links WHERE organization_id = $1 AND portal_id = $2`,
        [ORG_A, PORTAL_A],
      )
    ).rows[0].n,
  )

describe.sequential('Linktree commands (real PostgreSQL)', () => {
  describe('creating a link', () => {
    it('writes the link and its primary-language text together', async () => {
      const id = await createLink('City guide', 'a0')

      expect(await linkLabel(id)).toBe('City guide')
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

    it('admits exactly one of two concurrent creates at the boundary', async () => {
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

      expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
      expect(await linkCount()).toBe(4)
    })
  })

  describe('saving link texts', () => {
    it('writes the primary-language label through to the link, and only that one', async () => {
      const id = await createLink('City guide', 'a0')

      await saveTexts(id, [
        { locale: 'en', label: 'Explore the city', line: 'Maps and tips' },
        { locale: 'bg', label: 'Разгледайте града', line: null },
      ])

      expect(await linkLabel(id)).toBe('Explore the city')
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

    it('leaves the link label alone when only another language is saved', async () => {
      const id = await createLink('City guide', 'a0')

      await saveTexts(id, [{ locale: 'bg', label: 'Градски справочник' }])

      expect(await linkLabel(id)).toBe('City guide')
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

    it('records nothing for a text that did not change', async () => {
      await seedPublishedSnapshot()
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [{ locale: 'bg', label: 'Градски справочник' }])
      const before = await pendingKeys()

      await saveTexts(id, [{ locale: 'bg', label: 'Градски справочник' }])

      expect(await pendingKeys()).toEqual(before)
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

      expect(await linkLabel(id)).toBe('City guide')
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
    it('keeps the primary text in step when the legacy label changes', async () => {
      const id = await createLink('City guide', 'a0')
      const command = await base()

      await store().updatePortalLink({
        ...command,
        actorUserId: MANAGER,
        linkId: portalLinkId(id),
        categoryId: CATEGORY_A,
        patch: {
          label: 'Updated guide',
          url: `https://example.test/${id}`,
          destinationId: null,
          legacyDestinationState: 'unclassified',
          iconKey: 'map-pin',
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

      expect((await textRows(id))[0]).toMatchObject({
        locale: 'en',
        label: 'Updated guide',
        version: 2,
      })
    })

    it('creates the primary text when a link written by old code is updated', async () => {
      const id = await seedLegacyLink('Old label', 'a0')
      const command = await base()

      await store().updatePortalLink({
        ...command,
        actorUserId: MANAGER,
        linkId: portalLinkId(id),
        categoryId: CATEGORY_A,
        patch: {
          label: 'New label',
          url: `https://example.test/${id}`,
          destinationId: null,
          legacyDestinationState: 'unclassified',
          iconKey: null,
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

      expect((await textRows(id)).map((row) => [row.locale, row.label])).toEqual([
        ['en', 'New label'],
      ])
    })

    it('drops every text with its link', async () => {
      const id = await createLink('City guide', 'a0')
      await saveTexts(id, [{ locale: 'bg', label: 'Справочник' }])
      const command = await base()

      await store().deletePortalLink({
        ...command,
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

  describe('Linktree settings', () => {
    const settings = async () =>
      (
        await getPool().query(
          `SELECT linktree_enabled FROM portals WHERE organization_id = $1 AND id = $2`,
          [ORG_A, PORTAL_A],
        )
      ).rows[0].linktree_enabled as boolean

    const titleRows = async () =>
      (
        await getPool().query(
          `SELECT locale, title, linktree_title, version FROM portal_localized_overrides
           WHERE organization_id = $1 AND portal_id = $2 ORDER BY locale`,
          [ORG_A, PORTAL_A],
        )
      ).rows

    it('starts on, and the switch is recorded as a pending change', async () => {
      await seedPublishedSnapshot()
      expect(await settings()).toBe(true)

      await saveSettings({ enabled: false })

      expect(await settings()).toBe(false)
      expect(await pendingKeys()).toEqual(['portal_links|linktree:enabled'])
    })

    it('records nothing when the switch already has that value', async () => {
      await seedPublishedSnapshot()

      await saveSettings({ enabled: true })

      expect(await pendingKeys()).toEqual([])
    })

    it('saves a title per language and records each as pending', async () => {
      await seedPublishedSnapshot()

      await saveSettings({
        titles: [
          { locale: 'en', title: 'Around town' },
          { locale: 'bg', title: 'Из града' },
        ],
      })

      expect(await titleRows()).toEqual([
        { locale: 'bg', title: null, linktree_title: 'Из града', version: 1 },
        { locale: 'en', title: null, linktree_title: 'Around town', version: 1 },
      ])
      expect(await pendingKeys()).toEqual([
        'portal_links|linktree:title:bg',
        'portal_links|linktree:title:en',
      ])
    })

    it('bumps the row version on a changed title and skips an unchanged one', async () => {
      await saveSettings({ titles: [{ locale: 'en', title: 'Around town' }] })
      await saveSettings({ titles: [{ locale: 'en', title: 'Around town' }] })
      expect((await titleRows())[0]?.version).toBe(1)

      await saveSettings({ titles: [{ locale: 'en', title: 'Nearby' }] })

      expect((await titleRows())[0]).toMatchObject({
        linktree_title: 'Nearby',
        version: 2,
      })
    })

    it('deletes a row that only held the title when the title is reset', async () => {
      await saveSettings({ titles: [{ locale: 'en', title: 'Around town' }] })

      await saveSettings({ titles: [{ locale: 'en', title: null }] })

      expect(await titleRows()).toEqual([])
    })

    it('keeps a row that also carries other override fields when the title is reset', async () => {
      await getPool().query(
        `INSERT INTO portal_localized_overrides
           (id, organization_id, property_id, portal_id, locale, title, linktree_title,
            version, updated_by, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 'en', 'Lobby', 'Around town', 1, $5, $6, $6)`,
        [randomUUID(), ORG_A, PROPERTY_A, PORTAL_A, MANAGER, CREATED_AT],
      )

      await saveSettings({ titles: [{ locale: 'en', title: null }] })

      expect(await titleRows()).toEqual([
        { locale: 'en', title: 'Lobby', linktree_title: null, version: 2 },
      ])
    })

    it('refuses a title in a language the Portal does not offer', async () => {
      await expect(
        saveSettings({ titles: [{ locale: 'de' as 'en', title: 'Nützlich' }] }),
      ).rejects.toMatchObject({ code: 'locale_not_offered' })

      expect(await titleRows()).toEqual([])
    })

    it('fences on the Portal revision', async () => {
      const command = await base()

      await expect(
        store().savePortalLinktreeSettings({
          ...command,
          expectedPortalUpdatedAt: new Date(
            command.expectedPortalUpdatedAt.getTime() - 1,
          ),
          actorUserId: MANAGER,
          enabled: false,
          titles: [],
          event: portalUpdated({
            portalId: PORTAL_A,
            organizationId: ORG_A,
            propertyId: PROPERTY_A,
            previousPublicationState: 'published',
            publicationState: 'published',
            sourceAggregateVersion: command.revision.toISOString(),
            occurredAt: command.occurredAt,
          }),
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' })

      expect(await settings()).toBe(true)
    })
  })
})
