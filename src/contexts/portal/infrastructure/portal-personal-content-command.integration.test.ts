// A person's guest page takes over another Portal's wording, links and look in one
// commit (R19). The rows and the working copy publication reads, on real PostgreSQL.

import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { portalId as toPortalId, userId, type PortalId } from '#/shared/domain/ids'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { loadCopySource } from '../application/create-portal-resolvers'
import { planPortalContentCopy } from '../application/portal-content-copy'
import { portalUpdated } from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { createPortalExperienceRepository } from './repositories/portal-experience.repository'
import { createPortalLinkRepository } from './repositories/portal-link.repository'
import { createPortalLookRepository } from './repositories/portal-look.repository'
import { createPortalPublicationRepository } from './repositories/portal-publication.repository'
import { createPortalRepository } from './repositories/portal.repository'
import { publishFromSource } from './testing/portal-working-copy-publish'
import {
  COMPLETE_SCENARIO as SOURCE,
  WORKING_COPY_ORG,
  WORKING_COPY_OTHER_ORG,
} from './testing/portal-working-copy-scenarios'
import {
  seedPortalLookOverride,
  seedPortalWorkingCopy,
  seedSiblingPortal,
} from './testing/portal-working-copy-seed'

const PAGE = toPortalId('6d000000-0000-4000-8000-0000000000aa')
const READ_AT = new Date('2026-08-26T12:00:00.000Z')
const REPLACED_AT = new Date('2026-08-26T13:00:00.000Z')
const ctx = buildTestAuthContext({ organizationId: SOURCE.organizationId })
const staffPublicApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

const { getPool } = setupIntegrationDb({
  orgA: WORKING_COPY_ORG,
  orgB: WORKING_COPY_OTHER_ORG,
  tables: [
    'portal_page_edits',
    'portal_pending_content_changes',
    'portal_print_wordings',
    'portal_look_overrides',
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portal_localized_overrides',
    'property_portal_brand_contents',
    'property_portal_brand_profiles',
    'portal_link_texts',
    'portal_links',
    'portal_media_assets',
    'portal_approved_destinations',
    'portal_link_categories',
    'outbox_events',
    'portals',
    'properties',
  ],
})

beforeEach(() => {
  clearEventSchemas()
  registerAllEventSchemas()
})

const rows = async (sql: string, ...values: unknown[]) =>
  (await getPool().query(sql, values)).rows

/** The source live, and a person's page holding wording, a link, a look and print words of its own. */
async function world() {
  await seedPortalWorkingCopy(getPool(), SOURCE)
  const publication = createPortalPublicationRepository(getDb())
  const working = await publication.loadWorkingCopy(
    SOURCE.organizationId,
    SOURCE.portalId,
  )
  await publishFromSource(SOURCE, working!)
  await seedSiblingPortal(getPool(), SOURCE, {
    portalId: PAGE,
    slug: 'portal-polly',
    name: 'Polly Smith',
  })
  await getPool().query(
    `UPDATE portals SET kind = 'personal', public_name = 'Old name', updated_at = $2 WHERE id = $1`,
    [PAGE, READ_AT],
  )
  const category = randomUUID()
  await getPool().query(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key)
     VALUES ($1, $2, $3, 'Old links', 'a')`,
    [category, PAGE, SOURCE.organizationId],
  )
  await getPool().query(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id, label, url, legacy_destination_state, sort_key)
     VALUES ($1, $2, $3, $4, $5, 'Old link', 'https://legacy.example/old', 'unclassified', 'a')`,
    [randomUUID(), category, PAGE, SOURCE.organizationId, SOURCE.propertyId],
  )
  await getPool().query(
    `INSERT INTO portal_localized_overrides (id, portal_id, organization_id, property_id, locale, title, version, updated_by)
     VALUES ($1, $2, $3, $4, 'en', 'Polly’s own title', 1, 'seed-manager')`,
    [randomUUID(), PAGE, SOURCE.organizationId, SOURCE.propertyId],
  )
  await seedPortalLookOverride(getPool(), { ...SOURCE, portalId: PAGE }, {
    colours: {
      accent: '#112233',
      backgroundMode: 'manual',
      backgroundColour: '#000000',
    },
    lookVersion: 40,
  } as never)
  await getPool().query(
    `INSERT INTO portal_print_wordings (organization_id, property_id, portal_id, call_to_action, updated_at)
     VALUES ($1, $2, $3, 'how_did_we_do', $4)`,
    [SOURCE.organizationId, SOURCE.propertyId, PAGE, READ_AT],
  )
  const db = getDb()
  const copy = await loadCopySource(
    {
      portalRepo: createPortalRepository(db),
      staffPublicApi,
      experienceRepo: createPortalExperienceRepository(db),
      portalLinkRepo: createPortalLinkRepository(db),
      // The seed's destinations carry a test validation version the repository refuses.
      destinationRepo: {
        list: async () =>
          (
            await rows(
              `SELECT id, approval_state FROM portal_approved_destinations WHERE organization_id = $1`,
              SOURCE.organizationId,
            )
          ).map((row) => ({ id: row.id, approvalState: row.approval_state })) as never,
      },
      portalLookRepo: createPortalLookRepository(db),
    },
    ctx,
    SOURCE.propertyId,
    SOURCE.portalId,
  )
  const snapshot = await publication.findActiveForPortal(
    SOURCE.organizationId,
    SOURCE.portalId,
  )
  const command = (overrides: Readonly<{ expectedUpdatedAt?: Date }> = {}) => {
    const plan = planPortalContentCopy({
      source: copy,
      target: {
        portalId: PAGE,
        locales: { primary: 'bg', additional: ['en'] },
      },
      idGen: randomUUID,
      now: REPLACED_AT,
    })
    return {
      organizationId: SOURCE.organizationId,
      propertyId: SOURCE.propertyId,
      portalId: PAGE as PortalId,
      actorUserId: userId('manager-replaces-page'),
      expectedUpdatedAt: overrides.expectedUpdatedAt ?? READ_AT,
      revision: REPLACED_AT,
      publicName: 'Lobby portal',
      primaryGuestLocale: 'bg' as const,
      additionalGuestLocales: ['en' as const],
      linktreeEnabled: plan.settings.linktreeEnabled,
      content: plan.content,
      printWording: { callToAction: 'got_30_seconds' as const, customWords: null },
      sourceFence: {
        portalId: SOURCE.portalId,
        updatedAt: copy.portal.updatedAt,
        snapshot: snapshot!,
      },
      event: portalUpdated({
        portalId: PAGE,
        organizationId: SOURCE.organizationId,
        propertyId: SOURCE.propertyId,
        previousPublicationState: 'draft',
        publicationState: 'draft',
        sourceAggregateVersion: REPLACED_AT.toISOString(),
        occurredAt: REPLACED_AT,
      }),
    }
  }
  return { command, publication, store: createAtomicPortalCommandStore(db) }
}

const pageContent = async () => ({
  portal: (
    await rows(
      `SELECT public_name, primary_guest_locale, additional_guest_locales, updated_at FROM portals WHERE id = $1`,
      PAGE,
    )
  )[0],
  titles: (
    await rows(
      `SELECT locale, title FROM portal_localized_overrides WHERE portal_id = $1 ORDER BY locale`,
      PAGE,
    )
  ).map((row) => [row.locale, row.title]),
  links: (
    await rows(
      `SELECT t.label FROM portal_links l JOIN portal_link_texts t ON t.link_id = l.id AND t.locale = 'en' WHERE l.portal_id = $1 ORDER BY l.sort_key`,
      PAGE,
    )
  ).map((row) => row.label),
  rawLinks: (await rows(`SELECT label FROM portal_links WHERE portal_id = $1`, PAGE)).map(
    (row) => row.label,
  ),
  look: (
    await rows(
      `SELECT primary_color, look_version FROM portal_look_overrides WHERE portal_id = $1`,
      PAGE,
    )
  )[0],
  print: await rows(
    `SELECT call_to_action FROM portal_print_wordings WHERE portal_id = $1`,
    PAGE,
  ),
})

describe.sequential('replacing a person’s guest page (real PostgreSQL)', () => {
  it('leaves the page saying exactly what the source says, and nothing it said before', async () => {
    const { command, store, publication } = await world()
    await store.replacePersonalPortalContent(command())

    const after = await pageContent()
    expect(after.portal).toMatchObject({
      public_name: 'Lobby portal',
      primary_guest_locale: 'bg',
      additional_guest_locales: ['en'],
    })
    expect(new Date(after.portal.updated_at).getTime()).toBe(REPLACED_AT.getTime())
    expect(after.titles.flat()).not.toContain('Polly’s own title')
    expect(after.rawLinks).not.toContain('Old link')
    expect(after.print).toEqual([{ call_to_action: 'got_30_seconds' }])

    const [source, page] = await Promise.all([
      publication.loadWorkingCopy(SOURCE.organizationId, SOURCE.portalId),
      publication.loadWorkingCopy(SOURCE.organizationId, PAGE),
    ])
    expect(page!.wording).toEqual(source!.wording)
    expect(page!.links.map((link) => link.id)).not.toEqual(
      source!.links.map((link) => link.id),
    )
    expect(page!.links.map(({ id: _id, ...link }) => link)).toEqual(
      source!.links.map(({ id: _id, ...link }) => link),
    )
    await expect(
      rows(
        `SELECT event_type FROM outbox_events WHERE organization_id = $1 AND payload->>'portalId' = $2`,
        SOURCE.organizationId,
        PAGE,
      ),
    ).resolves.toEqual([expect.objectContaining({ event_type: 'portal.updated' })])
  })

  it('takes away the page’s own look when the source follows the Property', async () => {
    const { command, store } = await world()
    await store.replacePersonalPortalContent(command())
    expect((await pageContent()).look).toBeUndefined()
  })

  it('keeps a copied look above the version the page already had', async () => {
    const { command, store } = await world()
    const replaced = command()
    await store.replacePersonalPortalContent({
      ...replaced,
      content: {
        ...replaced.content,
        look: {
          photoMode: 'inherit',
          heroAssetId: null,
          heroFocalX: null,
          heroFocalY: null,
          heroAltTexts: {},
          coloursMode: 'own',
          primaryColor: '#445566',
          backgroundMode: 'manual',
          backgroundColor: '#000000',
          identityMode: 'inherit',
          wordmark: null,
          logoAssetId: null,
          lookVersion: 5,
        },
      },
    })
    expect((await pageContent()).look).toEqual({
      primary_color: '#445566',
      look_version: 41,
    })
  })

  it('records who replaced what, so History can say', async () => {
    const { command, store } = await world()
    await store.replacePersonalPortalContent(command())
    await expect(
      rows(
        `SELECT DISTINCT change_kind AS kind, actor_user_id FROM portal_page_edits WHERE portal_id = $1 ORDER BY kind`,
        PAGE,
      ),
    ).resolves.toEqual([
      { kind: 'portal_configuration', actor_user_id: 'manager-replaces-page' },
      { kind: 'portal_links', actor_user_id: 'manager-replaces-page' },
      { kind: 'portal_localized_override', actor_user_id: 'manager-replaces-page' },
    ])
  })

  it('takes an id back in the same commit that deletes it', async () => {
    const { command, store } = await world()
    const replaced = command()
    const [first] = replaced.content.links
    const kept = '6d000000-0000-4000-8000-0000000000bb' as never
    await getPool().query(
      `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id, label, url, legacy_destination_state, sort_key)
       SELECT $1, category_id, portal_id, organization_id, property_id, 'Same place', url, legacy_destination_state, 'b'
       FROM portal_links WHERE portal_id = $2 LIMIT 1`,
      [kept, PAGE],
    )
    await store.replacePersonalPortalContent({
      ...replaced,
      content: {
        ...replaced.content,
        links: replaced.content.links.map((link) =>
          link.id === first!.id ? { ...link, id: kept } : link,
        ),
        linkTexts: replaced.content.linkTexts.map((text) =>
          text.linkId === first!.id ? { ...text, linkId: kept } : text,
        ),
      },
    })
    await expect(
      rows(
        `SELECT id FROM portal_links WHERE id = $1 AND destination_id IS NOT NULL`,
        kept,
      ),
    ).resolves.toHaveLength(1)
  })

  it('changes nothing when the page moved after it was read', async () => {
    const { command, store } = await world()
    const before = await pageContent()
    await expect(
      store.replacePersonalPortalContent(
        command({ expectedUpdatedAt: new Date(READ_AT.getTime() - 1000) }),
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' })
    expect(await pageContent()).toEqual(before)
  })

  it('changes nothing when the source moved after it was reviewed', async () => {
    const { command, store } = await world()
    const before = await pageContent()
    await getPool().query(
      `UPDATE portals SET updated_at = updated_at + interval '1 second' WHERE id = $1`,
      [SOURCE.portalId],
    )
    await expect(store.replacePersonalPortalContent(command())).rejects.toMatchObject({
      code: 'source_has_unpublished_changes',
    })
    expect(await pageContent()).toEqual(before)
  })

  it('refuses a Portal that is not a person’s, changing nothing', async () => {
    const { command, store } = await world()
    await getPool().query(`UPDATE portals SET kind = 'place' WHERE id = $1`, [PAGE])
    const before = await pageContent()
    await expect(store.replacePersonalPortalContent(command())).rejects.toMatchObject({
      code: 'revision_conflict',
    })
    expect(await pageContent()).toEqual(before)
  })
})
