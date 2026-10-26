// A phone number or an email address on a Linktree tile, against real
// PostgreSQL: the widened CHECK takes the `contact` source (migration 0073), a
// contact is approved as a manager enters it, the job that checks websites again
// never takes one, and the guest edge serves one however long ago it was stored.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  organizationId,
  portalApprovedDestinationId,
  portalId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createLink } from '../application/use-cases/create-link'
import {
  validatePortalDestinationUri,
  validatePortalLinkDestination,
} from '../domain/approved-destination'
import { portalCreated } from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { createPortalApprovedDestinationRepository } from './repositories/portal-approved-destination.repository'
import { createPortalLinkRepository } from './repositories/portal-link.repository'
import { createPortalRepository } from './repositories/portal.repository'

const ORG_A = organizationId('org-contact-0000-0000-000000000001')
const ORG_B = organizationId('org-contact-0000-0000-000000000002')
const PROPERTY_A = propertyId('9d000000-0000-4000-8000-000000000001')
const PORTAL_A = portalId('9e000000-0000-4000-8000-000000000001')
const MANAGER = userId('manager-contact-000000000000001')
const STORED_AT = new Date('2026-10-01T10:00:00.000Z')
// A day later: far past the guest edge's 30 minute cut-off for a website.
const A_DAY_LATER = new Date(STORED_AT.getTime() + 24 * 60 * 60 * 1000)

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: [
    'portal_pending_content_changes',
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

const staffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

let ids = 0
const nextId = () => `9f000000-0000-4000-8000-${String((ids += 1)).padStart(12, '0')}`

const repo = () => createPortalApprovedDestinationRepository(getDb())

const request = (uri: string, at: Date = STORED_AT) =>
  repo().request({
    id: portalApprovedDestinationId(nextId()),
    organizationId: ORG_A,
    propertyId: PROPERTY_A,
    destination: validatePortalLinkDestination(uri),
    requestedBy: MANAGER,
    // A manager's request: a custom site would wait for an account admin.
    approveCustom: false,
    at,
  })

beforeEach(async () => {
  ids = 0
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
    additionalGuestLocales: [],
    createdAt: STORED_AT,
    updatedAt: STORED_AT,
  })
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house-contact', 'UTC', $3, $3)`,
    [PROPERTY_A, ORG_A, STORED_AT],
  )
  await createAtomicPortalCommandStore(getDb()).createPortal({
    organizationId: ORG_A,
    portal,
    initialResponsibleManagerIds: [MANAGER],
    event: portalCreated({
      portalId: portal.id,
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      publicationState: portal.publicationState,
      sourceAggregateVersion: portal.updatedAt.toISOString(),
      occurredAt: portal.createdAt,
    }),
  })
})

describe('contact destinations (real PostgreSQL)', () => {
  it('approves a manager’s phone number and email address as they are requested', async () => {
    const phone = await request('+1 (555) 123-4567')
    const email = await request('Front@Hotel.com')

    expect(phone).toMatchObject({
      normalizedUri: 'tel:+15551234567',
      hostname: '+15551234567',
      sourceType: 'contact',
      approvalState: 'approved',
      approvedBy: MANAGER,
      approvedAt: STORED_AT,
    })
    expect(email).toMatchObject({
      normalizedUri: 'mailto:Front@hotel.com',
      hostname: 'Front@hotel.com',
      sourceType: 'contact',
      approvalState: 'approved',
    })
    // Asking again for the same number finds the same row.
    expect((await request('tel:+15551234567')).id).toBe(phone.id)
  })

  it('leaves contact rows out of the network re-check, and keeps websites in it', async () => {
    const phone = await request('5551234567')
    const site = await repo().request({
      id: portalApprovedDestinationId(nextId()),
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destination: validatePortalDestinationUri('https://www.tripadvisor.com/Hotel'),
      requestedBy: MANAGER,
      approveCustom: false,
      at: STORED_AT,
    })

    const due = await repo().listDueForNetworkRevalidation(A_DAY_LATER, 500)
    const ours = due.filter((row) => row.organizationId === ORG_A).map((row) => row.id)

    expect(ours).toEqual([site.id])
    expect(ours).not.toContain(phone.id)
  })

  it('serves a contact to guests however old its last check, and a website only while recent', async () => {
    const phone = await request('+359 88 123 4567')
    const email = await request('front@hotel.com')
    const site = await repo().request({
      id: portalApprovedDestinationId(nextId()),
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      destination: validatePortalDestinationUri('https://www.booking.com/hotel'),
      requestedBy: MANAGER,
      approveCustom: false,
      at: STORED_AT,
    })
    const uris = [phone.normalizedUri, email.normalizedUri, site.normalizedUri]

    await expect(
      repo().listApprovedUris(ORG_A, PROPERTY_A, uris, A_DAY_LATER),
    ).resolves.toEqual([email.normalizedUri, phone.normalizedUri])
    await expect(
      repo().listApprovedUris(ORG_A, PROPERTY_A, uris, new Date(STORED_AT.getTime() - 1)),
    ).resolves.toEqual([...uris].sort())
    // Still scoped: another tenant is never served this Property's contacts.
    await expect(
      repo().listApprovedUris(ORG_B, PROPERTY_A, uris, new Date(0)),
    ).resolves.toEqual([])
  })

  it('stops serving a contact an account admin turned off', async () => {
    const phone = await request('5551234567')
    await repo().disable({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id: phone.id,
      reason: 'Turned off by an account admin',
      disabledBy: MANAGER,
      at: A_DAY_LATER,
    })

    await expect(
      repo().listApprovedUris(ORG_A, PROPERTY_A, [phone.normalizedUri], new Date(0)),
    ).resolves.toEqual([])
  })

  it('creates a manager’s phone tile, approved, with a phone icon and no network check', async () => {
    const checked: string[] = []
    const db = getDb()
    const link = await createLink({
      portalRepo: createPortalRepository(db),
      portalLinkRepo: createPortalLinkRepository(db, () => STORED_AT),
      staffPublicApi: staffApi,
      commandStore: createAtomicPortalCommandStore(db),
      destinationRepo: createPortalApprovedDestinationRepository(db),
      destinationNetworkValidator: {
        validate: async (uri: string) => {
          checked.push(uri)
          return {
            outcome: 'unavailable',
            reason: 'request_unavailable',
            observedAt: STORED_AT,
          }
        },
      },
      idGen: nextId,
      clock: () => new Date(STORED_AT.getTime() + (ids + 1) * 1000),
    })(
      { portalId: PORTAL_A, label: 'Call reception', url: '+1 555 123 4567' },
      buildTestAuthContext({ organizationId: ORG_A, role: 'PropertyManager' }),
    )

    expect(checked).toEqual([])
    const { rows } = await getPool().query(
      `SELECT l.url, l.icon_key, d.normalized_uri, d.source_type, d.approval_state
         FROM portal_links l
         JOIN portal_approved_destinations d ON d.id = l.destination_id
        WHERE l.id = $1`,
      [link.id],
    )
    expect(rows).toEqual([
      {
        // The link holds the destination, never its own address.
        url: null,
        icon_key: 'phone',
        normalized_uri: 'tel:+15551234567',
        source_type: 'contact',
        approval_state: 'approved',
      },
    ])
  })
})
