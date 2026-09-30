// The Portals overview's batched results read (real PG).
//
// The read answers for many Portals in a fixed number of statements, so the
// property that matters is that it agrees, Portal by Portal, with the single
// Portal read the Results view already uses: the same sums (qualified scans,
// Google opens only, retractions subtracted, whole-star ratings) and the same
// evidence (updating, unavailable, unattributed clicks). On top of that it
// reports each reading under the group the Portal had when the guest acted, and
// never lets another organisation, a neighbouring window or a Portal that was
// not asked about leak in.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { Database } from '#/shared/db'
import * as schema from '#/shared/db/schema'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import {
  organizationId,
  portalGroupId,
  portalId,
  propertyId,
  type PortalId,
} from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '../../application/public-api'
import { getPortalAnalytics } from '../../application/use-cases/get-portal-analytics'
import { getPortalResultsOverview } from '../../application/use-cases/get-portal-results-overview'
import { localDaysWindow, priorPeriodDates } from '../../application/utils'
import { createPortalAnalyticsRepository } from './portal-analytics.repository'
import { createPortalResultsOverviewRepository } from './portal-results-overview.repository'

const ORG = organizationId('org-portal-results-overview')
const OTHER_ORG = organizationId('org-portal-results-overview-other')
const PROP_A = propertyId('e1000000-0000-4000-8000-000000000001')
const PROP_B = propertyId('e1000000-0000-4000-8000-000000000002')
const OTHER_PROP = propertyId('e1000000-0000-4000-8000-000000000003')
const G1 = portalGroupId('e3000000-0000-4000-8000-000000000001')
const G2 = portalGroupId('e3000000-0000-4000-8000-000000000002')

const BUSY = portalId('e2000000-0000-4000-8000-000000000001')
const UNATTRIBUTED = portalId('e2000000-0000-4000-8000-000000000002')
const UPDATING = portalId('e2000000-0000-4000-8000-000000000003')
const EMPTY = portalId('e2000000-0000-4000-8000-000000000004')
const INVALID_RATING = portalId('e2000000-0000-4000-8000-000000000005')
const NEIGHBOUR = portalId('e2000000-0000-4000-8000-000000000006')
const FOREIGN = portalId('e2000000-0000-4000-8000-000000000007')

const WINDOW = {
  startAt: new Date('2026-09-01T00:00:00.000Z'),
  endAt: new Date('2026-10-01T00:00:00.000Z'),
}
const COMPUTED_AT = new Date('2026-10-01T00:05:00.000Z')

const ROSTER = [
  { portalId: BUSY, propertyId: PROP_A },
  { portalId: UNATTRIBUTED, propertyId: PROP_A },
  { portalId: UPDATING, propertyId: PROP_A },
  { portalId: EMPTY, propertyId: PROP_A },
  { portalId: INVALID_RATING, propertyId: PROP_A },
  { portalId: NEIGHBOUR, propertyId: PROP_B },
] as const

type Family = 'rawScan' | 'qualifiedScan' | 'rating' | 'feedback' | 'click'

const FAMILY: Record<
  Family,
  Readonly<{ metricKey: string; versionId: string; sourcePolicy: string }>
> = {
  rawScan: {
    metricKey: 'portal.scan',
    versionId: METRIC_VERSION_IDS.portalScanAnalytics,
    sourcePolicy: 'review_solicitation_analytics_only',
  },
  qualifiedScan: {
    metricKey: 'portal.qualified_scan',
    versionId: METRIC_VERSION_IDS.qualifiedScanGoal,
    sourcePolicy: 'first_party_guest_gateway_metric',
  },
  rating: {
    metricKey: 'portal.rating',
    versionId: METRIC_VERSION_IDS.portalRatingAnalytics,
    sourcePolicy: 'first_party_guest_private',
  },
  feedback: {
    metricKey: 'portal.feedback',
    versionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
    sourcePolicy: 'first_party_guest_private',
  },
  click: {
    metricKey: 'portal.review_link_click',
    versionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
    sourcePolicy: 'review_solicitation_analytics_only',
  },
}

type Reading = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  groupId: string | null
  family: Family
  sourceEventId: string
  eventAt: string
  value?: number
  destinationKind?: 'google_review' | 'secondary_link' | null
}>

const reading = (
  target: PortalId,
  groupId: string | null,
  family: Family,
  sourceEventId: string,
  eventAt = '2026-09-10T10:00:00.000Z',
  extra: Partial<Reading> = {},
): Reading => ({
  organizationId: ORG,
  propertyId: target === NEIGHBOUR ? PROP_B : PROP_A,
  portalId: target,
  groupId,
  family,
  sourceEventId,
  eventAt,
  ...extra,
})

const READINGS: readonly Reading[] = [
  // BUSY: in G1 for most of the window, then moved to G2.
  reading(BUSY, G1, 'qualifiedScan', 'busy-scan-1'),
  reading(BUSY, G1, 'qualifiedScan', 'busy-scan-2'),
  reading(BUSY, G1, 'qualifiedScan', 'busy-scan-retracted'),
  reading(BUSY, G2, 'qualifiedScan', 'busy-scan-moved'),
  reading(BUSY, G1, 'rawScan', 'busy-raw-scan'),
  reading(BUSY, G1, 'qualifiedScan', 'busy-scan-on-the-end', '2026-10-01T00:00:00.000Z'),
  reading(BUSY, G1, 'rating', 'busy-rating-5', undefined, { value: 5 }),
  reading(BUSY, G1, 'rating', 'busy-rating-4', undefined, { value: 4 }),
  reading(BUSY, G2, 'rating', 'busy-rating-3', undefined, { value: 3 }),
  reading(BUSY, G1, 'feedback', 'busy-feedback'),
  reading(BUSY, G1, 'click', 'busy-click-google-1', undefined, {
    destinationKind: 'google_review',
  }),
  reading(BUSY, G1, 'click', 'busy-click-google-2', undefined, {
    destinationKind: 'google_review',
  }),
  reading(BUSY, G1, 'click', 'busy-click-secondary', undefined, {
    destinationKind: 'secondary_link',
  }),
  // UNATTRIBUTED: no group; a click that never recorded its destination.
  reading(UNATTRIBUTED, null, 'qualifiedScan', 'unattributed-scan'),
  reading(UNATTRIBUTED, null, 'click', 'unattributed-click', undefined, {
    destinationKind: null,
  }),
  // UPDATING: a click reading whose source fact no consumer has applied.
  reading(UPDATING, G2, 'click', 'updating-click', undefined, {
    destinationKind: 'google_review',
  }),
  // INVALID_RATING: a rating that is not a whole number of stars.
  reading(INVALID_RATING, null, 'rating', 'invalid-rating', undefined, { value: 6 }),
  // NEIGHBOUR: another Property in the same organisation.
  reading(NEIGHBOUR, null, 'qualifiedScan', 'neighbour-scan'),
  reading(NEIGHBOUR, null, 'feedback', 'neighbour-feedback'),
  // Another organisation on its own Portal: never visible to ORG.
  {
    organizationId: OTHER_ORG,
    propertyId: OTHER_PROP,
    portalId: FOREIGN,
    groupId: null,
    family: 'qualifiedScan',
    sourceEventId: 'foreign-scan',
    eventAt: '2026-09-10T10:00:00.000Z',
  },
]

let pool: Pool
let db: Database

async function seedTenant(
  org: string,
  prop: string,
  portals: readonly string[],
  slug: string,
) {
  await pool.query(
    `INSERT INTO organization (id, name, slug, "createdAt")
     VALUES ($1, $2, $3, now()) ON CONFLICT (id) DO NOTHING`,
    [org, `Results overview ${slug}`, slug],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, $3, $3, 'UTC')`,
    [prop, org, `Results overview ${slug} property`],
  )
  for (const portal of portals) {
    await pool.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state)
       VALUES ($1, $2, $3::uuid, 'property', $3::text, $4, $4, 'published')`,
      [portal, org, prop, `results-overview-${portal.slice(-2)}`],
    )
  }
}

async function cleanup() {
  const orgs = [ORG, OTHER_ORG]
  await pool.query(
    `DELETE FROM metric_corrections
     WHERE reading_id IN (
       SELECT id FROM metric_readings WHERE organization_id = ANY($1)
     )`,
    [orgs],
  )
  await pool.query('DELETE FROM metric_readings WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM outbox_events WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM portals WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM portal_groups WHERE organization_id = ANY($1)', [orgs])
  await pool.query('DELETE FROM properties WHERE organization_id = ANY($1)', [orgs])
  await deleteTestOrganizations(pool, orgs)
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await cleanup()
  await seedTenant(
    ORG,
    PROP_A,
    [BUSY, UNATTRIBUTED, UPDATING, EMPTY, INVALID_RATING],
    'results-overview',
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Results overview second property', 'results-overview-b', 'UTC')`,
    [PROP_B, ORG],
  )
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state)
     VALUES ($1, $2, $3::uuid, 'property', $3::text, 'neighbour', 'results-overview-neighbour', 'published')`,
    [NEIGHBOUR, ORG, PROP_B],
  )
  await seedTenant(OTHER_ORG, OTHER_PROP, [FOREIGN], 'results-overview-other')
  for (const [id, name] of [
    [G1, 'Pool side'],
    [G2, 'Front of house'],
  ] as const) {
    await pool.query(
      `INSERT INTO portal_groups (id, organization_id, property_id, name)
       VALUES ($1, $2, $3, $4)`,
      [id, ORG, PROP_A, name],
    )
  }

  for (const row of READINGS) {
    const family = FAMILY[row.family]
    await pool.query(
      `INSERT INTO metric_readings (
         organization_id, property_id, portal_id, group_id, metric_key, value,
         definition_version_id, source_event_id, source_policy, exact_value,
         sample_count, attribution_quality, recorded_at, event_at,
         property_local_date, data_quality, retention_class,
         portal_destination_kind
       )
       VALUES ($1, $2, $3, $4, $5, $6::real, $7, $8, $9, $6::numeric, 1, 'exact',
         $10, $10, ($10::timestamptz AT TIME ZONE 'UTC')::date::text, 'exact',
         'standard', $11)`,
      [
        row.organizationId,
        row.propertyId,
        row.portalId,
        row.groupId,
        family.metricKey,
        row.value ?? 1,
        family.versionId,
        `${randomUUID()}:${row.sourceEventId}`,
        family.sourcePolicy,
        row.eventAt,
        row.destinationKind ?? null,
      ],
    )
  }
  await pool.query(
    `INSERT INTO metric_corrections (
       reading_id, source_event_id, kind, reason, actor_type, actor_id, event_at
     )
     SELECT id, 'retract-busy-scan', 'retract', 'guest retraction',
       'system', 'results-overview-test', '2026-09-08T00:00:00.000Z'
     FROM metric_readings
     WHERE organization_id = $1 AND source_event_id LIKE '%:busy-scan-retracted'`,
    [ORG],
  )
  // A click fact inside the window that no consumer has applied yet.
  await pool.query(
    `INSERT INTO outbox_events (
       id, event_type, event_version, payload, organization_id, property_id,
       source_context, source_aggregate_id, created_at, published_at
     ) VALUES (
       $1, 'guest.review_link.clicked', 1, jsonb_build_object(
         'organizationId', $2::text,
         'propertyId', $3::text,
         'portalId', $4::text,
         'occurredAt', '2026-09-10T10:00:00.000Z'
       ), $2, $3, 'guest', $4, '2026-09-10T10:00:00.000Z'::timestamptz,
       '2026-09-10T10:00:00.000Z'::timestamptz
     )`,
    [randomUUID(), ORG, PROP_A, UPDATING],
  )

  db = drizzle(pool, { schema }) as unknown as Database
})

afterAll(async () => {
  await cleanup()
  await pool.end()
})

const overview = () => createPortalResultsOverviewRepository(db, () => COMPUTED_AT)
const single = () => createPortalAnalyticsRepository(db, () => COMPUTED_AT)

const cellsOf = (
  reading: Awaited<ReturnType<ReturnType<typeof overview>['readWindow']>>,
  target: PortalId,
) =>
  reading.cells
    .filter((cell) => cell.portalId === target)
    .map(({ groupId, metricKey, total, count }) => ({ groupId, metricKey, total, count }))
    .sort((a, b) =>
      `${a.metricKey}/${a.groupId}`.localeCompare(`${b.metricKey}/${b.groupId}`),
    )

describe('Portal results overview repository (integration)', () => {
  it('agrees with the single Portal read, Portal by Portal', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: ROSTER,
      window: WINDOW,
    })

    for (const { portalId: target, propertyId: property } of ROSTER) {
      const sums = await single().getPortalKpiSums(
        ORG,
        property,
        target,
        WINDOW.startAt,
        WINDOW.endAt,
      )
      const byKey = new Map<string, { total: number; count: number }>()
      for (const cell of batched.cells.filter((c) => c.portalId === target)) {
        const soFar = byKey.get(cell.metricKey) ?? { total: 0, count: 0 }
        byKey.set(cell.metricKey, {
          total: soFar.total + cell.total,
          count: soFar.count + cell.count,
        })
      }
      expect(
        [...byKey.entries()]
          .map(([metricKey, sum]) => ({ metricKey, ...sum }))
          .sort((a, b) => a.metricKey.localeCompare(b.metricKey)),
        `sums for ${target}`,
      ).toEqual([...sums].sort((a, b) => a.metricKey.localeCompare(b.metricKey)))

      const evidence = await single().getPortalMetricEvidence(
        ORG,
        property,
        target,
        WINDOW.startAt,
        WINDOW.endAt,
      )
      expect(
        batched.evidence.find((row) => row.portalId === target)?.evidence,
        `evidence for ${target}`,
      ).toEqual(evidence)
    }
  })

  it('reports each reading under the group the Portal had when the guest acted', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: ROSTER,
      window: WINDOW,
    })

    expect(cellsOf(batched, BUSY)).toEqual([
      { groupId: G1, metricKey: 'portal.feedback', total: 1, count: 1 },
      { groupId: G1, metricKey: 'portal.qualified_scan', total: 2, count: 2 },
      { groupId: G2, metricKey: 'portal.qualified_scan', total: 1, count: 1 },
      { groupId: G1, metricKey: 'portal.rating', total: 9, count: 2 },
      { groupId: G2, metricKey: 'portal.rating', total: 3, count: 1 },
      { groupId: G1, metricKey: 'portal.review_link_click', total: 2, count: 2 },
    ])
  })

  it('reports every group a reading sat under, including readings it could not count', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: ROSTER,
      window: WINDOW,
    })
    const groupsOf = (target: PortalId) =>
      batched.readingGroups
        .filter((pair) => pair.portalId === target)
        .map((pair) => pair.groupId)
        .sort()

    // BUSY had readings under both groups; UNATTRIBUTED's sit under no group.
    expect(groupsOf(BUSY)).toEqual([G1, G2])
    expect(groupsOf(UNATTRIBUTED)).toEqual([null])
    // An invalid rating and a click nobody applied yet have no counted cell but
    // still say which group they belong to.
    expect(cellsOf(batched, INVALID_RATING)).toEqual([])
    expect(groupsOf(INVALID_RATING)).toEqual([null])
    expect(groupsOf(UPDATING)).toEqual([G2])
    // Neither a Portal outside the roster nor another organisation appears.
    expect(groupsOf(FOREIGN)).toEqual([])
    expect(batched.readingGroups.every((pair) => pair.portalId !== EMPTY)).toBe(true)
  })

  it('counts qualified scans and Google opens only, and leaves readings outside the window', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: ROSTER,
      window: WINDOW,
    })
    const keys = new Set(batched.cells.map((cell) => cell.metricKey))

    // Raw page opens never count; a retracted scan and one on the exclusive end are out
    // (2 + 1 scans for BUSY above), and the secondary-link click is not a Google open.
    expect(keys.has('portal.scan')).toBe(false)
    expect(
      cellsOf(batched, UNATTRIBUTED).find(
        (c) => c.metricKey === 'portal.review_link_click',
      ),
    ).toBeUndefined()
  })

  it('answers for a Portal with nothing counted with no cells and ready evidence', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: ROSTER,
      window: WINDOW,
    })

    expect(cellsOf(batched, EMPTY)).toEqual([])
    const evidence = batched.evidence.find((row) => row.portalId === EMPTY)?.evidence
    expect(evidence?.scans).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      state: 'ready',
      completeness: 1,
      availabilityReason: null,
      latestActivity: null,
      correctionHead: null,
    })
  })

  it('carries the evidence states of each Portal', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: ROSTER,
      window: WINDOW,
    })
    const evidenceOf = (target: PortalId) =>
      batched.evidence.find((row) => row.portalId === target)?.evidence

    expect(evidenceOf(UNATTRIBUTED)?.reviewLinkClicks).toMatchObject({
      state: 'insufficient',
      availabilityReason: 'destination_unattributed',
    })
    expect(evidenceOf(UPDATING)?.reviewLinkClicks).toMatchObject({
      state: 'updating',
      availabilityReason: 'consumer_receipt_pending',
    })
    expect(evidenceOf(INVALID_RATING)?.privateRatings).toMatchObject({
      state: 'unavailable',
      availabilityReason: 'invalid_governed_reading',
    })
    expect(evidenceOf(BUSY)?.reviewLinkClicks).toMatchObject({ state: 'ready' })
    // A whole-star rating that is not 1-5 is never summed.
    expect(cellsOf(batched, INVALID_RATING)).toEqual([])
  })

  it('returns one evidence entry per requested Portal, in request order', async () => {
    const reversed = [...ROSTER].reverse()

    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: reversed,
      window: WINDOW,
    })

    expect(batched.evidence.map((row) => row.portalId)).toEqual(
      reversed.map((row) => row.portalId),
    )
    expect(batched.computedAt).toEqual(COMPUTED_AT)
  })

  it('never lets another organisation influence a window', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: [{ portalId: FOREIGN, propertyId: OTHER_PROP }],
      window: WINDOW,
    })

    expect(batched.cells).toEqual([])
    expect(batched.evidence[0]?.evidence.scans.state).toBe('ready')
  })

  it('keeps a Portal from being read through another Property', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: [{ portalId: BUSY, propertyId: PROP_B }],
      window: WINDOW,
    })

    expect(batched.cells).toEqual([])
  })

  it('answers an empty roster without touching the database', async () => {
    const execute = vi.fn()
    const untouched = createPortalResultsOverviewRepository(
      { transaction: execute } as unknown as Database,
      () => COMPUTED_AT,
    )

    const batched = await untouched.readWindow({
      organizationId: ORG,
      portals: [],
      window: WINDOW,
    })

    expect(batched).toEqual({
      computedAt: COMPUTED_AT,
      cells: [],
      readingGroups: [],
      evidence: [],
    })
    expect(execute).not.toHaveBeenCalled()
  })

  it('reads a later window on its own', async () => {
    const batched = await overview().readWindow({
      organizationId: ORG,
      portals: ROSTER,
      window: { startAt: WINDOW.endAt, endAt: new Date('2026-11-01T00:00:00.000Z') },
    })

    // Only the scan that sits exactly on the exclusive end of September.
    expect(batched.cells).toEqual([
      expect.objectContaining({
        portalId: BUSY,
        groupId: G1,
        metricKey: 'portal.qualified_scan',
        total: 1,
        count: 1,
      }),
    ])
  })

  it("gives every Portal the same five measures as that Portal's own Results view", async () => {
    // The use case over the real store, against getPortalAnalytics over the
    // single Portal store: one Portal row must never say something the Portal's
    // Results view would not, with the prior window and its trends included, and
    // with each Property read through its own time zone.
    const now = () => WINDOW.endAt
    const results = getPortalResultsOverview({ results: overview(), now })
    const resultsView = getPortalAnalytics({
      portalMetrics: single(),
      portalLifetime: { get: async () => null },
      responseIntegrity: {
        getPortalResponseIntegritySummary: async () => ({
          accepted: 0,
          filteredAutomatically: 0,
          underReview: 0,
          total: 0,
        }),
        getPortalRatingLanguages: async () => ({
          total: 0,
          languages: [],
          unrecorded: 0,
        }),
      },
      portalVersions: { listPublicationActivationsBetween: async () => [] },
    })
    const zones = new Map([
      [PROP_A, 'UTC'],
      [PROP_B, 'Pacific/Auckland'],
    ])

    const rows = await results({
      scope: { organizationId: ORG, propertyId: null },
      portals: ROSTER.map((portal) => ({ ...portal, groupId: null })),
      properties: [...zones].map(([property, timezone]) => ({
        propertyId: property,
        timezone,
      })),
      timeRange: '30d',
      compare: true,
    })

    for (const { portalId: target, propertyId: property } of ROSTER) {
      const timezone = zones.get(property) ?? 'UTC'
      const { startDate, endDate } = localDaysWindow('30d', now(), timezone)
      const view = await resultsView({
        organizationId: ORG,
        propertyId: property,
        portalId: target,
        startDate,
        endDate,
        timeRange: '30d',
        propertyTimezone: timezone,
      })
      const row = rows.portals.find((candidate) => candidate.portalId === target)
      expect(row?.kpis, target).toEqual(view.kpis)
      expect(row?.engagementFunnel, target).toEqual(view.engagementFunnel)
    }
    // Each Property's subtotal reads its own local window.
    const local = localDaysWindow('30d', now(), 'Pacific/Auckland')
    const prior = priorPeriodDates(
      '30d',
      local.startDate,
      local.endDate,
      'Pacific/Auckland',
    )
    expect(rows.properties.find((row) => row.propertyId === PROP_B)).toMatchObject({
      period: { startAt: local.startDate, endAt: local.endDate },
      comparePeriod: { startAt: prior?.priorStartDate, endAt: prior?.priorEndDate },
    })
    // The group rows split BUSY's readings by the group each sat under.
    const busyRatings = (id: typeof G1 | typeof G2) =>
      rows.groups.find((row) => row.groupId === id)?.kpis.ratings.value
    expect(busyRatings(G1)).toBe(2)
    expect(busyRatings(G2)).toBe(1)
  })

  it('asks the database the same number of questions however many Portals it is asked about', async () => {
    const statements: string[] = []
    const counting = drizzle(pool, {
      schema,
      logger: { logQuery: (query) => statements.push(query) },
    }) as unknown as Database
    const repository = createPortalResultsOverviewRepository(counting, () => COMPUTED_AT)
    const many = Array.from({ length: 150 }, (_, i) => ({
      portalId: portalId(`e9000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
      propertyId: PROP_A,
    }))

    await repository.readWindow({ organizationId: ORG, portals: ROSTER, window: WINDOW })
    const forSix = statements.length
    statements.length = 0
    const batched = await repository.readWindow({
      organizationId: ORG,
      portals: [...ROSTER, ...many],
      window: WINDOW,
    })

    expect(forSix).toBeGreaterThan(0)
    expect(statements.length).toBe(forSix)
    expect(batched.evidence).toHaveLength(ROSTER.length + many.length)
  })
})
