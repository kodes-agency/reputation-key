import { createPortalRatingGoalGuard } from '#/contexts/reporting/infrastructure/portal-rating-goal-guard'
// A phone number or an email address on a Linktree tile, against real
// PostgreSQL: the widened CHECK takes the `contact` source (migration 0073), a
// contact is approved as a manager enters it, the job that checks websites again
// never takes one, and the guest edge serves one however long ago it was stored.

import { beforeEach, describe, expect, it, vi } from 'vitest'
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
import { revalidatePortalApprovedDestinations } from '../application/use-cases/manage-portal-approved-destinations'
import { createRevalidateApprovedDestinationsHandler } from './jobs/revalidate-approved-destinations.job'
import type { PortalDestinationNetworkValidator } from '../application/ports/portal-destination-network-validator.port'
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
  await createAtomicPortalCommandStore(
    getDb(),
    createPortalRatingGoalGuard(),
  ).createPortal({
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

    const due = await repo().listDueForNetworkRevalidation(A_DAY_LATER, 500, {
      at: A_DAY_LATER,
    })
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

  // What a server from before contacts does to a contact row: its re-check
  // takes the row and refuses `tel:`/`mailto:` as an invalid redirect target.
  const quarantineAsAnOlderServer = (id: string) =>
    getPool().query(
      `UPDATE portal_approved_destinations
          SET approval_state = 'quarantined', approved_by = NULL, approved_at = NULL,
              disabled_at = $2, disabled_reason = 'network_validation:redirect_target_invalid',
              updated_at = $2
        WHERE id = $1`,
      [id, A_DAY_LATER],
    )

  it('approves again a contact an older server quarantined, once it is entered again', async () => {
    const phone = await request('5551234567')
    await quarantineAsAnOlderServer(phone.id)
    await expect(
      repo().listApprovedUris(ORG_A, PROPERTY_A, [phone.normalizedUri], new Date(0)),
    ).resolves.toEqual([])

    const again = await request('555 123 4567', new Date(A_DAY_LATER.getTime() + 1000))

    expect(again).toMatchObject({
      id: phone.id,
      approvalState: 'approved',
      approvedBy: MANAGER,
      disabledAt: null,
      disabledReason: null,
    })
    await expect(
      repo().listApprovedUris(ORG_A, PROPERTY_A, [phone.normalizedUri], new Date(0)),
    ).resolves.toEqual([phone.normalizedUri])
  })

  it('does not revive a contact turned off for any other reason', async () => {
    const phone = await request('5551234567')
    await getPool().query(
      `UPDATE portal_approved_destinations
          SET approval_state = 'disabled', approved_by = NULL, approved_at = NULL,
              disabled_at = $2, disabled_reason = 'Turned off by an account admin'
        WHERE id = $1`,
      [phone.id, A_DAY_LATER],
    )

    await expect(request('5551234567')).resolves.toMatchObject({
      id: phone.id,
      approvalState: 'disabled',
    })
  })

  it('never quarantines a contact, even when a stale re-check reaches one', async () => {
    const email = await request('front@hotel.com')

    const recorded = await repo().recordNetworkValidation({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id: email.id,
      expectedLastValidatedAt: email.lastValidatedAt,
      result: {
        outcome: 'unsafe',
        reason: 'redirect_target_invalid',
        observedAt: A_DAY_LATER,
      },
    })

    expect(recorded).toBeNull()
    await expect(repo().findById(ORG_A, PROPERTY_A, email.id)).resolves.toMatchObject({
      approvalState: 'approved',
      disabledReason: null,
    })
  })

  it('refuses a contact source on anything but a stored phone number or email address', async () => {
    const write = (normalizedUri: string, sourceType: 'contact' | 'custom') =>
      repo().request({
        id: portalApprovedDestinationId(nextId()),
        organizationId: ORG_A,
        propertyId: PROPERTY_A,
        destination: { normalizedUri, hostname: 'hotel.example.com', sourceType },
        requestedBy: MANAGER,
        approveCustom: false,
        at: STORED_AT,
      })

    await expect(write('https://hotel.example.com/', 'contact')).rejects.toThrow(
      'A Portal destination is a contact exactly when it is a stored tel: or mailto: address',
    )
    await expect(write('tel:+15551234567', 'custom')).rejects.toThrow(
      'A Portal destination is a contact exactly when it is a stored tel: or mailto: address',
    )
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM portal_approved_destinations WHERE organization_id = $1`,
      [ORG_A],
    )
    expect(rows[0].n).toBe(0)
  })

  it('creates a manager’s phone tile, approved, with a phone icon and no network check', async () => {
    const checked: string[] = []
    const db = getDb()
    const link = await createLink({
      portalRepo: createPortalRepository(db),
      portalLinkRepo: createPortalLinkRepository(db),
      staffPublicApi: staffApi,
      commandStore: createAtomicPortalCommandStore(db, createPortalRatingGoalGuard()),
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

describe('destination network retry scheduling (real PostgreSQL)', () => {
  it.each(['unavailable', 'unauthorized'] as const)(
    'validates a healthy destination after 50 %s rows in the same run',
    async (failure) => {
      const failingProperty = propertyId('9d000000-0000-4000-8000-000000000002')
      await getPool().query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
         VALUES ($1, $2, 'Failing scope', 'failing-scope', 'UTC', $3, $3)`,
        [failingProperty, ORG_B, STORED_AT],
      )
      for (let i = 0; i < 51; i += 1) {
        await repo().request({
          id: portalApprovedDestinationId(nextId()),
          organizationId: i === 50 ? ORG_A : ORG_B,
          propertyId: i === 50 ? PROPERTY_A : failingProperty,
          destination: validatePortalDestinationUri(
            `https://www.tripadvisor.com/Hotel${i}`,
          ),
          requestedBy: MANAGER,
          approveCustom: false,
          at: STORED_AT,
        })
      }
      const validate = vi.fn<PortalDestinationNetworkValidator['validate']>(
        async (uri) =>
          uri.endsWith('/Hotel50')
            ? {
                outcome: 'safe',
                validatedAt: A_DAY_LATER,
                finalUri: uri,
                redirectCount: 0,
              }
            : {
                outcome: 'unavailable',
                reason: 'dns_unavailable',
                observedAt: A_DAY_LATER,
              },
      )
      const run = createRevalidateApprovedDestinationsHandler({
        revalidate: revalidatePortalApprovedDestinations({
          destinationRepo: repo(),
          destinationNetworkValidator: { validate },
          clock: () => A_DAY_LATER,
        }),
        authorizeScope: async (org, property) =>
          (org === ORG_A && property === PROPERTY_A) ||
          (failure === 'unavailable' && org === ORG_B && property === failingProperty),
        clock: () => A_DAY_LATER,
        logger: { info: vi.fn() },
        alertDispatcher: { dispatch: vi.fn(async () => {}) },
      })
      await run({} as never)
      const healthy = (await repo().list(ORG_A, PROPERTY_A)).find((row) =>
        row.normalizedUri.endsWith('/Hotel50'),
      )
      expect(healthy?.lastValidatedAt).toEqual(A_DAY_LATER)
      expect(validate).toHaveBeenCalledTimes(failure === 'unavailable' ? 51 : 1)
      const { rows } = await getPool().query(
        `SELECT last_validated_at, validation_failures, next_attempt_at
         FROM portal_approved_destinations WHERE organization_id = $1 AND property_id = $2`,
        [ORG_B, failingProperty],
      )
      expect(rows).toHaveLength(50)
      for (const row of rows) {
        expect(row.last_validated_at).toEqual(STORED_AT)
        expect(row.validation_failures).toBe(failure === 'unavailable' ? 1 : 0)
        expect(row.next_attempt_at).toEqual(
          failure === 'unavailable' ? new Date(A_DAY_LATER.getTime() + 60_000) : null,
        )
      }
    },
  )

  it('persists backoff without changing approval or freshness, fences stale retries and resets after success', async () => {
    const destination = await request('https://www.tripadvisor.com/Hotel')
    const retryAt = new Date(A_DAY_LATER.getTime() + 60_000)
    const input = {
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id: destination.id,
      expectedLastValidatedAt: STORED_AT,
      expectedNextAttemptAt: null,
      result: { outcome: 'unavailable' as const, nextAttemptAt: retryAt },
    }
    const delayed = await repo().recordNetworkValidation(input)
    expect(delayed).toMatchObject({
      approvalState: 'approved',
      lastValidatedAt: STORED_AT,
      updatedAt: STORED_AT,
    })
    expect(await repo().recordNetworkValidation(input)).toBeNull()
    const due = () =>
      repo().listDueForNetworkRevalidation(A_DAY_LATER, 500, { at: A_DAY_LATER })
    expect((await due()).some((row) => row.id === destination.id)).toBe(false)
    const retried = (
      await repo().listDueForNetworkRevalidation(A_DAY_LATER, 500, { at: retryAt })
    ).find((row) => row.id === destination.id)
    expect(retried).toMatchObject({ nextAttemptAt: retryAt, validationFailures: 1 })
    await repo().recordNetworkValidation({
      ...input,
      expectedNextAttemptAt: retryAt,
      result: { outcome: 'safe', validatedAt: retryAt },
    })
    const later = new Date(retryAt.getTime() + 11 * 60_000)
    const refreshed = (
      await repo().listDueForNetworkRevalidation(later, 500, { at: later })
    ).find((row) => row.id === destination.id)
    expect(refreshed).toMatchObject({
      lastValidatedAt: retryAt,
      nextAttemptAt: null,
      validationFailures: 0,
    })
  })

  it('advances past visited rows even when validation changes', async () => {
    const first = await request('https://www.tripadvisor.com/First')
    const second = await request('https://www.tripadvisor.com/Second')
    const before = new Date(A_DAY_LATER.getTime() - 10 * 60_000)
    const page = await repo().listDueForNetworkRevalidation(before, 500, {
      at: A_DAY_LATER,
    })
    const firstCandidate = page.find((row) => row.id === first.id)!
    expect(firstCandidate).toBeDefined()
    // An old validation timestamp cannot cause a row already visited to move
    // into another page, including when another run records it concurrently.
    await repo().recordNetworkValidation({
      organizationId: ORG_A,
      propertyId: PROPERTY_A,
      id: first.id,
      expectedLastValidatedAt: STORED_AT,
      result: { outcome: 'safe', validatedAt: new Date(STORED_AT.getTime() + 60_000) },
    })
    const following = await repo().listDueForNetworkRevalidation(before, 500, {
      at: A_DAY_LATER,
      excludeIds: [first.id],
    })
    expect(following.some((row) => row.id === first.id)).toBe(false)
    expect(following.some((row) => row.id === second.id)).toBe(true)
  })
})
