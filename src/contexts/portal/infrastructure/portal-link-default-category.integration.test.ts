// Adding a link without a category, as the Linktree editor does, against real
// PostgreSQL. Starting the Portal's first category moves the Portal revision the
// link command is fenced on, so this is the test that proves the use case reads
// the Portal again before the second write.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext, buildTestPortal } from '#/shared/testing/fixtures'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { organizationId, portalId, propertyId, userId } from '#/shared/domain/ids'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createLink } from '../application/use-cases/create-link'
import { isPortalError } from '../domain/errors'
import { portalCreated } from '../domain/events'
import { createAtomicPortalCommandStore } from './portal-command-store'
import { createPortalApprovedDestinationRepository } from './repositories/portal-approved-destination.repository'
import { createPortalLinkRepository } from './repositories/portal-link.repository'
import type { PortalCommandStore } from '../application/ports/portal-command-store.port'
import { createPortalExperienceRepository } from './repositories/portal-experience.repository'
import { createPortalRepository } from './repositories/portal.repository'

const ORG_A = organizationId('org-defcat-0000-0000-000000000001')
const ORG_B = organizationId('org-defcat-0000-0000-000000000002')
const PROPERTY_A = propertyId('9a000000-0000-4000-8000-000000000001')
const PORTAL_A = portalId('9b000000-0000-4000-8000-000000000001')
const MANAGER = userId('manager-defcat-0000000000000001')
const CREATED_AT = new Date('2026-10-01T10:00:00.000Z')

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
    'portals',
    'properties',
  ],
})

const staffApi: StaffPublicApi = {
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
}

let ticks = 0
let ids = 0

function useCase(
  wrapStore: (store: PortalCommandStore) => PortalCommandStore = (store) => store,
) {
  const db = getDb()
  return createLink({
    experienceRepo: createPortalExperienceRepository(db),
    portalRepo: createPortalRepository(db),
    portalLinkRepo: createPortalLinkRepository(db, () => CREATED_AT),
    staffPublicApi: staffApi,
    commandStore: wrapStore(createAtomicPortalCommandStore(db)),
    destinationRepo: createPortalApprovedDestinationRepository(db),
    destinationNetworkValidator: {
      validate: async (uri: string) => ({
        outcome: 'safe' as const,
        validatedAt: CREATED_AT,
        finalUri: uri,
        redirectCount: 0,
      }),
    },
    idGen: () => `9c000000-0000-4000-8000-${String((ids += 1)).padStart(12, '0')}`,
    // Every call sees a later instant, as real time does.
    clock: () => new Date(CREATED_AT.getTime() + (ticks += 1) * 1000),
  })
}

// An AccountAdmin: a custom destination is approved by their own request.
const admin = () => buildTestAuthContext({ organizationId: ORG_A, role: 'AccountAdmin' })

const add = (label: string, path: string) =>
  useCase()(
    { portalId: PORTAL_A, label, url: `https://avela.example.com/${path}` },
    admin(),
  )

const count = async (table: string): Promise<number> => {
  const { rows } = await getPool().query(
    `SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`,
    [ORG_A],
  )
  return rows[0].n as number
}

beforeEach(async () => {
  ticks = 0
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
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  })
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, 'Harbour House', 'harbour-house', 'UTC', $3, $3)`,
    [PROPERTY_A, ORG_A, CREATED_AT],
  )
  await createAtomicPortalCommandStore(getDb()).createPortal({
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
})

describe('createLink without a category (real PostgreSQL)', () => {
  it('starts the first category and puts the link, and its text, in it', async () => {
    const link = await add('Olive Terrace menu', 'menu')

    const { rows } = await getPool().query(
      `SELECT c.title, l.label, t.locale, t.label AS text_label
         FROM portal_links l
         JOIN portal_link_categories c ON c.id = l.category_id
         JOIN portal_link_texts t ON t.link_id = l.id
        WHERE l.id = $1`,
      [link.id],
    )
    expect(rows).toEqual([
      {
        title: 'Useful links',
        label: 'Olive Terrace menu',
        locale: 'en',
        text_label: 'Olive Terrace menu',
      },
    ])
    expect(await count('portal_link_categories')).toBe(1)
  })

  it('reuses that category for the next links, in order', async () => {
    await add('First', 'one')
    await add('Second', 'two')
    await add('Third', 'three')

    expect(await count('portal_link_categories')).toBe(1)
    const { rows } = await getPool().query(
      `SELECT label FROM portal_links WHERE organization_id = $1 ORDER BY sort_key`,
      [ORG_A],
    )
    expect(rows.map((row) => row.label)).toEqual(['First', 'Second', 'Third'])
  })

  it('refuses an empty label without starting a category', async () => {
    await expect(add('  ', 'menu')).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'invalid_label',
    )

    expect(await count('portal_link_categories')).toBe(0)
  })

  it('leaves no category and no category fact behind when a concurrent edit refuses the link', async () => {
    // A manager saves the Portal between this create reading it and writing.
    const racing = (store: PortalCommandStore): PortalCommandStore => ({
      ...store,
      createPortalLink: async (command) => {
        await getPool().query(`UPDATE portals SET updated_at = $2 WHERE id = $1`, [
          PORTAL_A,
          new Date(command.revision.getTime() + 60_000),
        ])
        return store.createPortalLink(command)
      },
    })

    await expect(
      useCase(racing)(
        { portalId: PORTAL_A, label: 'Menu', url: 'https://avela.example.com/menu' },
        admin(),
      ),
    ).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'revision_conflict',
    )

    expect(await count('portal_links')).toBe(0)
    expect(await count('portal_link_categories')).toBe(0)
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM outbox_events
        WHERE organization_id = $1 AND event_type = 'portal_link_category.created'`,
      [ORG_A],
    )
    expect(rows[0].n).toBe(0)
  })

  it('rolls the category and its fact back when the link write fails after them', async () => {
    // The category is inserted first; a label past its column fails the link
    // insert behind it, so only a single transaction takes the category back.
    const tooLong = (store: PortalCommandStore): PortalCommandStore => ({
      ...store,
      createPortalLink: async (command) =>
        store.createPortalLink({
          ...command,
          link: { ...command.link, label: 'x'.repeat(101) },
        }),
    })

    await expect(
      useCase(tooLong)(
        { portalId: PORTAL_A, label: 'Menu', url: 'https://avela.example.com/menu' },
        admin(),
      ),
    ).rejects.toThrow()

    expect(await count('portal_links')).toBe(0)
    expect(await count('portal_link_categories')).toBe(0)
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM outbox_events
        WHERE organization_id = $1
          AND event_type IN ('portal_link_category.created', 'portal_link.created')`,
      [ORG_A],
    )
    expect(rows[0].n).toBe(0)
    expect(await count('portal_pending_content_changes')).toBe(0)
  })

  it('refuses a fifth link and leaves no extra category behind', async () => {
    for (const [index, label] of ['A', 'B', 'C', 'D'].entries()) {
      await add(label, `p${index}`)
    }

    await expect(add('E', 'p4')).rejects.toSatisfy(
      (error: unknown) => isPortalError(error) && error.code === 'link_limit_reached',
    )

    expect(await count('portal_links')).toBe(4)
    expect(await count('portal_link_categories')).toBe(1)
  })
})
