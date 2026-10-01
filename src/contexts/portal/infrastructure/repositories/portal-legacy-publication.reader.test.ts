// Which live Portals are still on a v1 or v2 page (round 4, slice 46). Real
// PostgreSQL: the selection is a join over the Portal, its open activation and
// that activation's snapshot, and only the database can say that a draft-only,
// disabled or deleted Portal with an old snapshot is not in it.

import { beforeEach, describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { seedLegacySnapshot } from '../testing/portal-legacy-live-seed'
import { createPortalLegacyPublicationReader } from './portal-legacy-publication.reader'

const ORG = organizationId('org-legacy-reader-00000000000001')
const OTHER_ORG = organizationId('org-legacy-reader-00000000000002')
const PROPERTY_A = propertyId('e1000000-0000-4000-8000-00000000000a')
const PROPERTY_B = propertyId('e1000000-0000-4000-8000-00000000000b')
const OTHER_PROPERTY = propertyId('e1000000-0000-4000-8000-00000000000c')
const NOW = new Date('2026-10-01T09:00:00.000Z')

const { getPool } = setupIntegrationDb({
  orgA: ORG,
  orgB: OTHER_ORG,
  tables: [
    'portal_publication_activations',
    'portal_publication_snapshots',
    'portals',
    'properties',
  ],
})

const id = (kind: string, index: number) =>
  `${kind}000000-0000-4000-8000-${String(index).padStart(12, '0')}`
const PORTAL = (index: number) => portalId(id('f1', index))

type PortalSeed = Readonly<{
  index: number
  org?: typeof ORG
  property?: typeof PROPERTY_A
  state: 'draft' | 'published' | 'disabled' | 'archived'
  deleted?: boolean
  /** The schema version of each snapshot, oldest first; the last may be live. */
  versions: ReadonlyArray<1 | 2 | 3>
  /** Whether the newest snapshot's activation is still open. */
  live: boolean
  closedAs?: 'disabled' | 'archived' | 'replaced'
}>

async function seedPortal(seed: PortalSeed): Promise<void> {
  const org = seed.org ?? ORG
  const property = seed.property ?? PROPERTY_A
  const portal = PORTAL(seed.index)
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        private_feedback_threshold, publication_state, deleted_at, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $9, $4, $5, 3, $6, $7, $8, $8)`,
    [
      portal,
      org,
      property,
      `Portal ${seed.index}`,
      `portal-${seed.index}`,
      seed.state,
      seed.deleted ? NOW : null,
      NOW,
      property,
    ],
  )
  for (const [position, schemaVersion] of seed.versions.entries()) {
    const version = position + 1
    const isNewest = position === seed.versions.length - 1
    await seedLegacySnapshot({
      organizationId: org,
      propertyId: property,
      portalId: portal,
      idTail: seed.index,
      version,
      schemaVersion,
      at: new Date(NOW.getTime() + version),
      activation: isNewest && seed.live ? 'open' : (seed.closedAs ?? 'replaced'),
    })
  }
}

const reader = () => createPortalLegacyPublicationReader(getDb())
const list = (
  overrides: Partial<
    Parameters<ReturnType<typeof reader>['listLiveLegacyPortals']>[0]
  > = {},
) =>
  reader().listLiveLegacyPortals({
    organizationId: ORG,
    afterPortalId: null,
    limit: 100,
    ...overrides,
  })

beforeEach(async () => {
  for (const [property, org, slug] of [
    [PROPERTY_A, ORG, 'a'],
    [PROPERTY_B, ORG, 'b'],
    [OTHER_PROPERTY, OTHER_ORG, 'c'],
  ] as const) {
    await getPool().query(
      `INSERT INTO properties
         (id, organization_id, name, slug, timezone, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'UTC', $5, $5)`,
      [property, org, `Property ${slug}`, `property-${slug}`, NOW],
    )
  }
})

describe.sequential('Portal legacy publication reader (real PostgreSQL)', () => {
  it('lists a live Portal whose active version is schema 1 or 2, with that version', async () => {
    await seedPortal({ index: 1, state: 'published', versions: [1], live: true })
    await seedPortal({
      index: 2,
      property: PROPERTY_B,
      state: 'published',
      versions: [1, 2],
      live: true,
    })

    await expect(list()).resolves.toEqual([
      {
        organizationId: ORG,
        propertyId: PROPERTY_A,
        portalId: PORTAL(1),
        liveVersion: 1,
        liveSchemaVersion: 1,
      },
      {
        organizationId: ORG,
        propertyId: PROPERTY_B,
        portalId: PORTAL(2),
        liveVersion: 2,
        liveSchemaVersion: 2,
      },
    ])
  })

  it('leaves out a live Portal that is already on schema 3, whatever its history holds', async () => {
    await seedPortal({ index: 1, state: 'published', versions: [3], live: true })
    await seedPortal({ index: 2, state: 'published', versions: [1, 2, 3], live: true })

    await expect(list()).resolves.toEqual([])
  })

  it.each(['draft', 'disabled', 'archived'] as const)(
    'never selects a %s Portal, even one whose last snapshot is v2',
    async (state) => {
      await seedPortal({
        index: 1,
        state,
        versions: [2],
        live: false,
        closedAs: state === 'archived' ? 'archived' : 'disabled',
      })

      await expect(list()).resolves.toEqual([])
    },
  )

  it.each(['draft', 'disabled', 'archived'] as const)(
    'never selects a %s Portal even if a stray activation is still open',
    async (state) => {
      await seedPortal({ index: 1, state, versions: [2], live: true })

      await expect(list()).resolves.toEqual([])
    },
  )

  it('never selects a draft Portal that has no snapshot at all', async () => {
    await seedPortal({ index: 1, state: 'draft', versions: [], live: false })

    await expect(list()).resolves.toEqual([])
  })

  it('never selects a deleted Portal', async () => {
    await seedPortal({
      index: 1,
      state: 'published',
      deleted: true,
      versions: [2],
      live: true,
    })

    await expect(list()).resolves.toEqual([])
  })

  it('never selects a Portal whose live activation has closed, even if it is marked published', async () => {
    await seedPortal({ index: 1, state: 'published', versions: [2], live: false })

    await expect(list()).resolves.toEqual([])
  })

  it('stays inside the organisation it is asked about', async () => {
    await seedPortal({ index: 1, state: 'published', versions: [2], live: true })
    await seedPortal({
      index: 2,
      org: OTHER_ORG,
      property: OTHER_PROPERTY,
      state: 'published',
      versions: [2],
      live: true,
    })

    expect((await list()).map((row) => row.portalId)).toEqual([PORTAL(1)])
    expect(
      (await list({ organizationId: OTHER_ORG })).map((row) => row.portalId),
    ).toEqual([PORTAL(2)])
  })

  it('narrows to one Property', async () => {
    await seedPortal({ index: 1, state: 'published', versions: [2], live: true })
    await seedPortal({
      index: 2,
      property: PROPERTY_B,
      state: 'published',
      versions: [2],
      live: true,
    })

    expect((await list({ propertyId: PROPERTY_B })).map((row) => row.portalId)).toEqual([
      PORTAL(2),
    ])
  })

  it('pages by Portal id with a keyset cursor', async () => {
    for (const index of [1, 2, 3, 4, 5]) {
      await seedPortal({ index, state: 'published', versions: [2], live: true })
    }

    const first = await list({ limit: 2 })
    const second = await list({ limit: 2, afterPortalId: first.at(-1)?.portalId ?? null })
    const third = await list({ limit: 2, afterPortalId: second.at(-1)?.portalId ?? null })

    expect([...first, ...second, ...third].map((row) => row.portalId)).toEqual([
      PORTAL(1),
      PORTAL(2),
      PORTAL(3),
      PORTAL(4),
      PORTAL(5),
    ])
    expect(third).toHaveLength(1)
  })
})
