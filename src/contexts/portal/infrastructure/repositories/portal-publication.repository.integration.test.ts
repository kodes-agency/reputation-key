// Portal publication repository — the activations read behind the goal-readiness
// facts (`listActivationsForPortals`), against real PostgreSQL.

import { describe, expect, it } from 'vitest'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId, type PortalId } from '#/shared/domain/ids'
import {
  portalPublicationActivations,
  portalPublicationSnapshots,
} from '#/shared/db/schema/portal-publication.schema'
import { buildLegacyPortalPublicationSnapshot } from '../../application/__fixtures__/legacy-snapshot-builder'
import { snapshotToRow } from '../portal-publication-commands'
import { createPortalPublicationRepository } from './portal-publication.repository'

const ORG = organizationId('org-portal-live-runs-00000000000001')
const OTHER_ORG = organizationId('org-portal-live-runs-00000000000002')
const PROPERTY = propertyId('f6d00000-0000-4000-8000-000000000001')
const OTHER_PROPERTY = propertyId('f6d00000-0000-4000-8000-000000000002')
const RECEPTION = portalId('f6e00000-0000-4000-8000-000000000001')
const SPA = portalId('f6e00000-0000-4000-8000-000000000002')
const ELSEWHERE = portalId('f6e00000-0000-4000-8000-000000000003')
const CREATED = new Date('2026-05-01T06:00:00.000Z')

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

type Closed = Readonly<{ at: string; reason: 'disabled' | 'archived' | 'replaced' }>

async function seedPortal(
  org: string,
  property: string,
  portal: PortalId,
  slug: string,
): Promise<string> {
  const tail = portal.slice(-1)
  await getPool().query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
     VALUES ($1, $2, $3, $3, 'Europe/Sofia', $4, $4)
     ON CONFLICT (id) DO NOTHING`,
    [property, org, `live-runs-${property.slice(-1)}`, CREATED],
  )
  await getPool().query(
    `INSERT INTO portals
       (id, organization_id, property_id, entity_type, entity_id, name, slug,
        theme, private_feedback_threshold, publication_state, created_at, updated_at)
     VALUES ($1, $2, $3, 'property', $4, $5, $5,
             '{"primaryColor":"#123456"}'::jsonb, 3, 'published', $6, $6)`,
    [portal, org, property, property, slug, CREATED],
  )
  const snapshot = buildLegacyPortalPublicationSnapshot({
    id: `f6f00000-0000-4000-8000-00000000000${tail}`,
    portalId: portal,
    organizationId: org,
    propertyId: property,
    version: 1,
    source: {
      portal: {
        id: portal,
        name: slug,
        slug,
        description: null,
        heroImageUrl: null,
        theme: null,
        organizationName: 'Org',
      },
      categories: [],
      links: [],
      privateFeedbackThreshold: 3,
      organizationId: org,
      propertyId: property,
    },
    destination: {
      state: 'verified',
      uri: 'https://search.google.com/local/writereview?placeid=live-runs',
      retrievedAt: CREATED,
      sourceEpoch: 1,
      profileVersion: 1,
    },
    createdBy: 'manager-live-runs',
    createdAt: CREATED,
  })
  await getDb().insert(portalPublicationSnapshots).values(snapshotToRow(snapshot))
  return snapshot.id
}

async function seedActivations(
  org: string,
  property: string,
  portal: PortalId,
  snapshotId: string,
  activations: readonly (readonly [string, Closed | null])[],
): Promise<void> {
  await getDb()
    .insert(portalPublicationActivations)
    .values(
      activations.map(([activatedAt, closed], index) => ({
        id: `f7${portal.slice(-1)}00000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
        organizationId: org,
        propertyId: property,
        portalId: portal,
        snapshotId,
        activationSequence: index + 1,
        kind: index === 0 ? 'publish' : 'rollback',
        activatedBy: 'manager-live-runs',
        activatedAt: new Date(activatedAt),
        deactivatedAt: closed ? new Date(closed.at) : null,
        deactivationReason: closed?.reason ?? null,
      })),
    )
}

describe.sequential('listActivationsForPortals (real PostgreSQL)', () => {
  it('lists activations of several portals in one read, another organization never', async () => {
    const reception = await seedPortal(ORG, PROPERTY, RECEPTION, 'reception')
    await seedActivations(ORG, PROPERTY, RECEPTION, reception, [
      // 1: a run that a disable ended — the break before the current run.
      [
        '2026-05-02T06:00:00.000Z',
        { at: '2026-05-20T06:00:00.000Z', reason: 'disabled' },
      ],
      // 2: the first activation of the current run.
      [
        '2026-05-25T06:00:00.000Z',
        { at: '2026-06-10T06:00:00.000Z', reason: 'replaced' },
      ],
      // 3: mid-run, closed before the window: left out.
      [
        '2026-06-10T06:00:00.000Z',
        { at: '2026-07-01T06:00:00.000Z', reason: 'replaced' },
      ],
      // 4: closed inside the window.
      [
        '2026-07-01T06:00:00.000Z',
        { at: '2026-08-20T06:00:00.000Z', reason: 'replaced' },
      ],
      // 5: open.
      ['2026-08-20T06:00:00.000Z', null],
    ])
    const spa = await seedPortal(ORG, PROPERTY, SPA, 'spa')
    await seedActivations(ORG, PROPERTY, SPA, spa, [
      [
        '2026-09-01T06:00:00.000Z',
        { at: '2026-09-01T12:00:00.000Z', reason: 'replaced' },
      ],
      [
        '2026-09-01T12:00:00.000Z',
        { at: '2026-09-05T06:00:00.000Z', reason: 'disabled' },
      ],
    ])
    const elsewhere = await seedPortal(OTHER_ORG, OTHER_PROPERTY, ELSEWHERE, 'elsewhere')
    await seedActivations(OTHER_ORG, OTHER_PROPERTY, ELSEWHERE, elsewhere, [
      ['2026-09-01T06:00:00.000Z', null],
    ])
    const repo = createPortalPublicationRepository(getDb())
    const since = new Date('2026-08-18T00:00:00.000Z')

    const read = await repo.listActivationsForPortals(
      ORG,
      [SPA, RECEPTION, ELSEWHERE],
      since,
    )

    expect(
      read.map((row) => [row.portalId, row.activationSequence, row.deactivationReason]),
    ).toEqual([
      [RECEPTION, 1, 'disabled'],
      [RECEPTION, 2, 'replaced'],
      [RECEPTION, 4, 'replaced'],
      [RECEPTION, 5, null],
      [SPA, 1, 'replaced'],
      [SPA, 2, 'disabled'],
    ])
    expect(read.find((row) => row.activationSequence === 5)).toMatchObject({
      organizationId: ORG,
      propertyId: PROPERTY,
      kind: 'rollback',
      activatedAt: new Date('2026-08-20T06:00:00.000Z'),
      deactivatedAt: null,
    })
    await expect(
      repo.listActivationsForPortals(OTHER_ORG, [RECEPTION, SPA], since),
    ).resolves.toEqual([])
    await expect(repo.listActivationsForPortals(ORG, [], since)).resolves.toEqual([])
  })
})
