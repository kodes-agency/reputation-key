// The links a Portal's Results read names (real PostgreSQL): the Portal's own, in
// guest order, each in the Portal's primary language or else its stored label.

import { beforeEach, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import { portalCreated } from '../../domain/events'
import { createAtomicPortalCommandStore } from '../portal-command-store'
import { createPortalResultsLinksReader } from './portal-results-links.reader'

const ORG_A = organizationId('org-resultlinks-000-0000-000000000001')
const ORG_B = organizationId('org-resultlinks-000-0000-000000000002')
const PROPERTY = propertyId('9a200000-0000-4000-8000-000000000001')
const PORTAL = portalId('9b200000-0000-4000-8000-000000000001')
const MANAGER = userId('manager-resultlinks-0000000000001')
const AT = new Date('2026-10-01T10:00:00.000Z')
const CATEGORY = '9c200000-0000-4000-8000-000000000001'
const MENU = '9e200000-0000-4000-8000-000000000001'
const SPA = '9e200000-0000-4000-8000-000000000002'
const UNWRITTEN = '9e200000-0000-4000-8000-000000000003'

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_link_texts',
    'portal_links',
    'portal_link_categories',
    'portal_responsible_managers',
    'outbox_events',
    'portal_page_edits',
    'portals',
    'properties',
  ],
})

const read = (organization = ORG_A) =>
  createPortalResultsLinksReader(getDb())(organization, PROPERTY, PORTAL)

async function insertLink(id: string, label: string, sortKey: string): Promise<void> {
  await getPool().query(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                               label, url, legacy_destination_state, sort_key,
                               created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'https://example.test/', 'unclassified', $7, $8, $8)`,
    [id, CATEGORY, PORTAL, ORG_A, PROPERTY, label, sortKey, AT],
  )
}

async function insertText(linkId: string, locale: string, label: string): Promise<void> {
  await getPool().query(
    `INSERT INTO portal_link_texts (organization_id, property_id, portal_id, link_id,
                                    locale, label, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [ORG_A, PROPERTY, PORTAL, linkId, locale, label, MANAGER],
  )
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Results links', 'results-links', 'UTC')`,
    [PROPERTY, ORG_A],
  )
  const portal = buildTestPortal({
    id: PORTAL,
    organizationId: ORG_A,
    propertyId: PROPERTY,
    entityId: PROPERTY,
    name: 'Reception',
    slug: 'reception',
    createdBy: MANAGER,
    primaryGuestLocale: 'en',
    additionalGuestLocales: ['bg'],
    createdAt: AT,
    updatedAt: AT,
  })
  await createAtomicPortalCommandStore(getDb()).createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: portalCreated({
      portalId: portal.id,
      organizationId: ORG_A,
      propertyId: PROPERTY,
      publicationState: portal.publicationState,
      sourceAggregateVersion: AT.toISOString(),
      occurredAt: AT,
    }),
  })
  await getPool().query(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                         created_at, updated_at)
     VALUES ($1, $2, $3, 'Links', 'a0', $4, $4)`,
    [CATEGORY, PORTAL, ORG_A, AT],
  )
  await insertLink(SPA, 'Stored spa label', 'a1')
  await insertLink(MENU, 'Stored menu label', 'a0')
  await insertLink(UNWRITTEN, '', 'a2')
  await insertText(MENU, 'en', 'Menu')
  await insertText(MENU, 'bg', 'Меню')
  await insertText(SPA, 'bg', 'Спа')
})

it('names each link in guest order, in the primary language or else its stored label', async () => {
  const links = await read()
  expect(links.enabled).toBe(true)
  expect(links.rows.map(({ linkId, label }) => [linkId, label])).toEqual([
    [MENU, 'Menu'],
    [SPA, 'Stored spa label'],
    [UNWRITTEN, ''],
  ])
})

it('gives another organization nothing', async () => {
  expect(await read(ORG_B)).toEqual({ enabled: false, rows: [] })
})

it('says when the Linktree is switched off', async () => {
  await getPool().query(`UPDATE portals SET linktree_enabled = false WHERE id = $1`, [
    PORTAL,
  ])
  expect((await read()).enabled).toBe(false)
})
