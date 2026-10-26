// Which Portal an account admin is sent to for a site waiting for approval, and
// whether the site still waits (real PostgreSQL). The notice names the Portal
// whose links open the site, the earliest first; a site no link opens yet
// (its tile was refused) is decided from the Property's earliest live Portal.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalApprovedDestinationId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { portalCreated } from '../../domain/events'
import { validatePortalDestinationUri } from '../../domain/approved-destination'
import { createAtomicPortalCommandStore } from '../portal-command-store'
import { createPortalApprovedDestinationRepository } from './portal-approved-destination.repository'
import { createPortalDestinationApprovalFactsReader } from './portal-destination-approval-facts.reader'

const ORG_A = organizationId('org-sitefacts-0000-0000-000000000001')
const ORG_B = organizationId('org-sitefacts-0000-0000-000000000002')
const PROPERTY_A = propertyId('9a100000-0000-4000-8000-000000000001')
const PROPERTY_B = propertyId('9a100000-0000-4000-8000-000000000002')
const RECEPTION = portalId('9b100000-0000-4000-8000-000000000001')
const SPA = portalId('9b100000-0000-4000-8000-000000000002')
const BAR = portalId('9b100000-0000-4000-8000-000000000003')
const OTHER_PROPERTY_PORTAL = portalId('9b100000-0000-4000-8000-000000000004')
const MANAGER = userId('manager-sitefacts-000000000000001')
const SITE = portalApprovedDestinationId('9d100000-0000-4000-8000-000000000001')
const OTHER_SITE = portalApprovedDestinationId('9d100000-0000-4000-8000-000000000002')
const DAY = 24 * 60 * 60 * 1000
const FIRST_DAY = new Date('2026-10-01T10:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_link_texts',
    'portal_links',
    'portal_link_categories',
    'portal_approved_destinations',
    'portal_responsible_managers',
    'outbox_events',
    'portal_page_edits',
    'portals',
    'properties',
  ],
})

const reader = () => createPortalDestinationApprovalFactsReader(getDb())

/** A Portal created `days` after the first, so "earliest" is not insertion order. */
async function createPortal(
  id: ReturnType<typeof portalId>,
  property: ReturnType<typeof propertyId>,
  name: string,
  days: number,
): Promise<void> {
  const at = new Date(FIRST_DAY.getTime() + days * DAY)
  const portal = buildTestPortal({
    id,
    organizationId: ORG_A,
    propertyId: property,
    entityId: property,
    name,
    slug: name.toLowerCase().replaceAll(' ', '-'),
    createdBy: MANAGER,
    primaryGuestLocale: 'en',
    additionalGuestLocales: [],
    createdAt: at,
    updatedAt: at,
  })
  await createAtomicPortalCommandStore(getDb()).createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: portalCreated({
      portalId: portal.id,
      organizationId: ORG_A,
      propertyId: property,
      publicationState: portal.publicationState,
      sourceAggregateVersion: at.toISOString(),
      occurredAt: at,
    }),
  })
}

/** A manager asks for the site: a custom one waits for an account admin. */
async function requestSite(
  id: ReturnType<typeof portalApprovedDestinationId>,
  uri: string,
): Promise<void> {
  await createPortalApprovedDestinationRepository(getDb()).request({
    id,
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    destination: validatePortalDestinationUri(uri),
    requestedBy: MANAGER,
    approveCustom: false,
    at: FIRST_DAY,
  })
}

/** A link on `portal` that opens the site, as a tile saved before it waited would. */
async function linkOpens(
  portal: ReturnType<typeof portalId>,
  site: ReturnType<typeof portalApprovedDestinationId>,
  n: number,
): Promise<void> {
  const category = `9c100000-0000-4000-8000-00000000000${n}`
  const link = `9e100000-0000-4000-8000-00000000000${n}`
  await getPool().query(
    `INSERT INTO portal_link_categories (id, portal_id, organization_id, title, sort_key,
                                         created_at, updated_at)
     VALUES ($1, $2, $3, 'Links', 'a0', $4, $4)`,
    [category, portal, ORG_A, FIRST_DAY],
  )
  await getPool().query(
    `INSERT INTO portal_links (id, category_id, portal_id, organization_id, property_id,
                               label, destination_id, legacy_destination_state, sort_key,
                               created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, '', $6, 'migrated', 'a0', $7, $7)`,
    [link, category, portal, ORG_A, PROPERTY_A, site, FIRST_DAY],
  )
}

beforeEach(async () => {
  clearEventSchemas()
  registerAllEventSchemas()
  for (const [id, slug] of [
    [PROPERTY_A, 'harbour-house'],
    [PROPERTY_B, 'hilltop-lodge'],
  ] as const) {
    await getPool().query(
      `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', $5, $5)`,
      [id, ORG_A, slug, slug, FIRST_DAY],
    )
  }
  // Created out of order on purpose: Spa is the earliest, Reception the latest.
  await createPortal(SPA, PROPERTY_A, 'Spa', 0)
  await createPortal(BAR, PROPERTY_A, 'Bar', 1)
  await createPortal(RECEPTION, PROPERTY_A, 'Reception', 2)
  await createPortal(OTHER_PROPERTY_PORTAL, PROPERTY_B, 'Lodge desk', -5)
})

describe('createPortalDestinationApprovalFactsReader (real PostgreSQL)', () => {
  it('sends a site no link opens yet to the Property’s earliest live Portal', async () => {
    await requestSite(SITE, 'https://menu.example.com/dinner?table=4')

    await expect(reader()(ORG_A, SITE)).resolves.toEqual({
      propertyId: PROPERTY_A,
      hostname: 'menu.example.com',
      approvalState: 'pending',
      requestedBy: MANAGER,
      portal: { id: SPA, name: 'Spa' },
      otherPortalCount: 0,
    })
  })

  it('names the earliest Portal whose links open the site and counts the others', async () => {
    await requestSite(SITE, 'https://menu.example.com/')
    await linkOpens(RECEPTION, SITE, 1)
    await linkOpens(BAR, SITE, 2)

    const facts = await reader()(ORG_A, SITE)

    expect(facts?.portal).toEqual({ id: BAR, name: 'Bar' })
    expect(facts?.otherPortalCount).toBe(1)
  })

  it('counts a Portal once however many of its links open the site', async () => {
    await requestSite(SITE, 'https://menu.example.com/')
    await linkOpens(BAR, SITE, 1)
    await linkOpens(BAR, SITE, 2)

    expect((await reader()(ORG_A, SITE))?.otherPortalCount).toBe(0)
  })

  it('leaves out a Portal that is archived or deleted', async () => {
    await requestSite(SITE, 'https://menu.example.com/')
    await linkOpens(BAR, SITE, 1)
    await linkOpens(RECEPTION, SITE, 2)
    await getPool().query(
      `UPDATE portals SET publication_state = 'archived' WHERE id = $1`,
      [BAR],
    )

    const facts = await reader()(ORG_A, SITE)
    expect(facts?.portal).toEqual({ id: RECEPTION, name: 'Reception' })
    expect(facts?.otherPortalCount).toBe(0)

    await getPool().query(`UPDATE portals SET deleted_at = now() WHERE id = $1`, [
      RECEPTION,
    ])
    // Nothing that opens it is live now: the Property's earliest live Portal.
    expect((await reader()(ORG_A, SITE))?.portal).toEqual({ id: SPA, name: 'Spa' })
  })

  it('has no Portal to name when the Property has none left', async () => {
    await requestSite(SITE, 'https://menu.example.com/')
    await getPool().query(
      `UPDATE portals SET publication_state = 'archived' WHERE property_id = $1`,
      [PROPERTY_A],
    )

    await expect(reader()(ORG_A, SITE)).resolves.toMatchObject({
      approvalState: 'pending',
      portal: null,
    })
  })

  it('reports the decision once the site is no longer waiting', async () => {
    await requestSite(SITE, 'https://menu.example.com/')
    await createPortalApprovedDestinationRepository(getDb()).disable({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id: SITE,
      reason: 'not ours',
      disabledBy: MANAGER,
      at: new Date(FIRST_DAY.getTime() + DAY),
    })

    expect((await reader()(ORG_A, SITE))?.approvalState).toBe('disabled')
  })

  it('never reads another Organization’s site, or one that is not there', async () => {
    await requestSite(SITE, 'https://menu.example.com/')

    await expect(reader()(ORG_B, SITE)).resolves.toBeNull()
    await expect(reader()(ORG_A, OTHER_SITE)).resolves.toBeNull()
  })
})
