// Portal Results measures tell the truth (real PG).
//
// Three defects this pins, each invisible to a fake because they are column and
// predicate choices in the repository:
//
//  1. "Scans" summed the raw `portal.scan` metric — every page open, bots and
//     refreshes included — while the governed, session-deduplicated measure is
//     `portal.qualified_scan`. Raw scans must be ignored.
//  2. "Review clicks" summed secondary-link clicks in with Google review
//     clicks. Only `google_review` destination readings are Google opens.
//  3. A click reading with no destination kind cannot be counted as a Google
//     open, and the period must say so instead of quietly under-counting. New
//     readings always carry a kind (the consumer records a missing one as
//     `secondary_link`), so this is a defensive guard for legacy rows only.
//
// Retractions are current-correction-tip aware, and another organisation's
// readings never leak in.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import type { Database } from '#/shared/db'
import * as schema from '#/shared/db/schema'
import { getEnv } from '#/shared/config/env'
import { deleteTestOrganizations } from '#/shared/testing/integration-helpers'
import { organizationId, portalId, propertyId } from '#/shared/domain/ids'
import { METRIC_VERSION_IDS } from '../../application/public-api'
import { createPortalAnalyticsRepository } from './portal-analytics.repository'

const ORG = organizationId('org-portal-results-measures')
const OTHER_ORG = organizationId('org-portal-results-measures-other')
const PROP = propertyId('d1000000-0000-4000-8000-000000000001')
const OTHER_PROP = propertyId('d1000000-0000-4000-8000-000000000002')
const PORTAL = portalId('d2000000-0000-4000-8000-000000000001')
const LEGACY_PORTAL = portalId('d2000000-0000-4000-8000-000000000002')
const OTHER_PORTAL = portalId('d2000000-0000-4000-8000-000000000003')
const RETRACTED_LEGACY_PORTAL = portalId('d2000000-0000-4000-8000-000000000004')
const UPDATING_LEGACY_PORTAL = portalId('d2000000-0000-4000-8000-000000000005')

const WINDOW_START = new Date('2026-09-01T00:00:00.000Z')
const WINDOW_END = new Date('2026-10-01T00:00:00.000Z')
const COMPUTED_AT = new Date('2026-10-01T00:05:00.000Z')

type Family = 'rawScan' | 'qualifiedScan' | 'click'
type DestinationKind = 'google_review' | 'secondary_link' | null

type Reading = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  family: Family
  sourceEventId: string
  eventAt: string
  destinationKind?: DestinationKind
}>

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
  click: {
    metricKey: 'portal.review_link_click',
    versionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
    sourcePolicy: 'review_solicitation_analytics_only',
  },
}

const scan = (
  family: 'rawScan' | 'qualifiedScan',
  sourceEventId: string,
  eventAt: string,
  targetPortal: string = PORTAL,
): Reading => ({
  organizationId: ORG,
  propertyId: PROP,
  portalId: targetPortal,
  family,
  sourceEventId,
  eventAt,
})

const click = (
  sourceEventId: string,
  destinationKind: DestinationKind,
  targetPortal: string = PORTAL,
): Reading => ({
  organizationId: ORG,
  propertyId: PROP,
  portalId: targetPortal,
  family: 'click',
  sourceEventId,
  eventAt: '2026-09-10T10:00:00.000Z',
  destinationKind,
})

const READINGS: readonly Reading[] = [
  // Raw page opens: three of them, none may be counted as scans.
  scan('rawScan', 'raw-scan-1', '2026-09-02T10:00:00.000Z'),
  scan('rawScan', 'raw-scan-2', '2026-09-03T10:00:00.000Z'),
  scan('rawScan', 'raw-scan-3', '2026-09-04T10:00:00.000Z'),
  // Qualified scans: three in the window, the third is retracted below, one
  // sits exactly on the exclusive end and belongs to the next period.
  scan('qualifiedScan', 'qualified-scan-1', '2026-09-05T10:00:00.000Z'),
  scan('qualifiedScan', 'qualified-scan-2', '2026-09-06T10:00:00.000Z'),
  scan('qualifiedScan', 'qualified-scan-retracted', '2026-09-07T10:00:00.000Z'),
  scan('qualifiedScan', 'qualified-scan-next-period', '2026-10-01T00:00:00.000Z'),
  // Google opens: two. Secondary links: three, none of them are Google opens.
  click('click-google-1', 'google_review'),
  click('click-google-2', 'google_review'),
  click('click-secondary-1', 'secondary_link'),
  click('click-secondary-2', 'secondary_link'),
  click('click-secondary-3', 'secondary_link'),
  // A second portal whose only clicks predate the recorded destination kind.
  click('click-legacy-unattributed', null, LEGACY_PORTAL),
  click('click-legacy-google', 'google_review', LEGACY_PORTAL),
  // A portal whose only kind-less click was retracted: nothing is unattributed.
  click('click-legacy-retracted', null, RETRACTED_LEGACY_PORTAL),
  // A portal with a kind-less click AND a click fact no consumer has applied.
  click('click-legacy-updating', null, UPDATING_LEGACY_PORTAL),
  // Another organisation on a different portal: never visible to ORG.
  {
    organizationId: OTHER_ORG,
    propertyId: OTHER_PROP,
    portalId: OTHER_PORTAL,
    family: 'qualifiedScan',
    sourceEventId: 'other-org-qualified-scan',
    eventAt: '2026-09-08T10:00:00.000Z',
  },
  {
    organizationId: OTHER_ORG,
    propertyId: OTHER_PROP,
    portalId: OTHER_PORTAL,
    family: 'click',
    sourceEventId: 'other-org-google-click',
    eventAt: '2026-09-08T10:00:00.000Z',
    destinationKind: 'google_review',
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
     VALUES ($1, $2, $3, now())`,
    [org, `Results measures ${slug}`, slug],
  )
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, $3, $3, 'UTC')`,
    [prop, org, `Results measures ${slug} property`],
  )
  for (const portal of portals) {
    await pool.query(
      `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug, publication_state)
       VALUES ($1, $2, $3::uuid, 'property', $3::text, $4, $4, 'published')`,
      [portal, org, prop, `results-measures-${portal.slice(-2)}`],
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
  await pool.query('DELETE FROM properties WHERE organization_id = ANY($1)', [orgs])
  await deleteTestOrganizations(pool, orgs)
}

beforeAll(async () => {
  pool = new Pool({ connectionString: getEnv().DATABASE_URL, max: 2 })
  await cleanup()
  await seedTenant(
    ORG,
    PROP,
    [PORTAL, LEGACY_PORTAL, RETRACTED_LEGACY_PORTAL, UPDATING_LEGACY_PORTAL],
    'results-measures',
  )
  await seedTenant(OTHER_ORG, OTHER_PROP, [OTHER_PORTAL], 'results-measures-other')

  for (const reading of READINGS) {
    const family = FAMILY[reading.family]
    await pool.query(
      `INSERT INTO metric_readings (
         organization_id, property_id, portal_id, metric_key, value,
         definition_version_id, source_event_id, source_policy, exact_value,
         sample_count, attribution_quality, recorded_at, event_at,
         property_local_date, data_quality, retention_class,
         portal_destination_kind
       )
       VALUES ($1, $2, $3, $4, 1, $5, $6, $7, 1, 1, 'exact',
         $8, $8, ($8::timestamptz AT TIME ZONE 'UTC')::date::text, 'exact',
         'standard', $9)`,
      [
        reading.organizationId,
        reading.propertyId,
        reading.portalId,
        family.metricKey,
        family.versionId,
        `${randomUUID()}:${reading.sourceEventId}`,
        family.sourcePolicy,
        reading.eventAt,
        reading.destinationKind ?? null,
      ],
    )
  }
  await pool.query(
    `INSERT INTO metric_corrections (
       reading_id, source_event_id, kind, reason, actor_type, actor_id, event_at
     )
     SELECT id, 'retract-qualified-scan', 'retract', 'guest retraction',
       'system', 'results-measures-test', '2026-09-08T00:00:00.000Z'
     FROM metric_readings
     WHERE organization_id = $1 AND source_event_id LIKE '%:qualified-scan-retracted'`,
    [ORG],
  )
  await pool.query(
    `INSERT INTO metric_corrections (
       reading_id, source_event_id, kind, reason, actor_type, actor_id, event_at
     )
     SELECT id, 'retract-legacy-click', 'retract', 'guest retraction',
       'system', 'results-measures-test', '2026-09-11T00:00:00.000Z'
     FROM metric_readings
     WHERE organization_id = $1 AND source_event_id LIKE '%:click-legacy-retracted'`,
    [ORG],
  )
  // A click fact that happened in the window but that no consumer has applied.
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
    [randomUUID(), ORG, PROP, UPDATING_LEGACY_PORTAL],
  )

  db = drizzle(pool, { schema }) as unknown as Database
})

afterAll(async () => {
  await cleanup()
  await pool.end()
})

const repository = () => createPortalAnalyticsRepository(db, () => COMPUTED_AT)

describe('Portal results measures (integration)', () => {
  it('counts qualified scans, subtracts retractions, and ignores raw scans', async () => {
    const sums = await repository().getPortalKpiSums(
      ORG,
      PROP,
      PORTAL,
      WINDOW_START,
      WINDOW_END,
    )

    expect(sums.find((row) => row.metricKey === 'portal.scan')).toBeUndefined()
    expect(sums.find((row) => row.metricKey === 'portal.qualified_scan')).toEqual({
      metricKey: 'portal.qualified_scan',
      total: 2,
      count: 2,
    })
  })

  it('counts Google opens only, never secondary-link clicks', async () => {
    const sums = await repository().getPortalKpiSums(
      ORG,
      PROP,
      PORTAL,
      WINDOW_START,
      WINDOW_END,
    )

    expect(sums.find((row) => row.metricKey === 'portal.review_link_click')).toEqual({
      metricKey: 'portal.review_link_click',
      total: 2,
      count: 2,
    })
  })

  it('leaves clicks that never recorded a destination out of the Google opens', async () => {
    const sums = await repository().getPortalKpiSums(
      ORG,
      PROP,
      LEGACY_PORTAL,
      WINDOW_START,
      WINDOW_END,
    )

    expect(sums.find((row) => row.metricKey === 'portal.review_link_click')).toEqual({
      metricKey: 'portal.review_link_click',
      total: 1,
      count: 1,
    })
  })

  it('reports Google-opens evidence as insufficient when destinations are unattributed', async () => {
    const analytics = repository()

    const legacy = await analytics.getPortalMetricEvidence(
      ORG,
      PROP,
      LEGACY_PORTAL,
      WINDOW_START,
      WINDOW_END,
    )
    expect(legacy.reviewLinkClicks).toMatchObject({
      definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
      state: 'insufficient',
      availabilityReason: 'destination_unattributed',
      verifiedThrough: null,
    })

    const attributed = await analytics.getPortalMetricEvidence(
      ORG,
      PROP,
      PORTAL,
      WINDOW_START,
      WINDOW_END,
    )
    expect(attributed.reviewLinkClicks).toMatchObject({
      state: 'ready',
      availabilityReason: null,
    })
  })

  it('does not count a retracted kind-less click as unattributed', async () => {
    const analytics = repository()

    const evidence = await analytics.getPortalMetricEvidence(
      ORG,
      PROP,
      RETRACTED_LEGACY_PORTAL,
      WINDOW_START,
      WINDOW_END,
    )
    expect(evidence.reviewLinkClicks).toMatchObject({
      state: 'ready',
      availabilityReason: null,
    })
    const sums = await analytics.getPortalKpiSums(
      ORG,
      PROP,
      RETRACTED_LEGACY_PORTAL,
      WINDOW_START,
      WINDOW_END,
    )
    expect(
      sums.find((row) => row.metricKey === 'portal.review_link_click'),
    ).toBeUndefined()
  })

  it('reports an unapplied click fact as updating, ahead of the unattributed reason', async () => {
    const evidence = await repository().getPortalMetricEvidence(
      ORG,
      PROP,
      UPDATING_LEGACY_PORTAL,
      WINDOW_START,
      WINDOW_END,
    )

    expect(evidence.reviewLinkClicks).toMatchObject({
      state: 'updating',
      availabilityReason: 'consumer_receipt_pending',
    })
  })

  it('points the scans evidence at the qualified scan definition', async () => {
    const evidence = await repository().getPortalMetricEvidence(
      ORG,
      PROP,
      PORTAL,
      WINDOW_START,
      WINDOW_END,
    )

    expect(evidence.scans.definitionVersionId).toBe(METRIC_VERSION_IDS.qualifiedScanGoal)
  })

  it('never lets another organisation influence a period', async () => {
    const analytics = repository()

    const foreign = await analytics.getPortalKpiSums(
      ORG,
      PROP,
      OTHER_PORTAL,
      WINDOW_START,
      WINDOW_END,
    )
    expect(foreign).toEqual([])
    // ORG's scope over the other organisation's portal sees no click at all.
    const foreignEvidence = await analytics.getPortalMetricEvidence(
      ORG,
      PROP,
      OTHER_PORTAL,
      WINDOW_START,
      WINDOW_END,
    )
    expect(foreignEvidence.reviewLinkClicks.state).toBe('ready')
  })

  describe('retraction evidence for qualified scans', () => {
    const RETRACTION_START = new Date('2026-11-01T00:00:00.000Z')
    const RETRACTION_END = new Date('2026-12-01T00:00:00.000Z')
    const RECORDED = 'd3000000-0000-4000-8000-000000000001'
    const RETRACTED = 'd3000000-0000-4000-8000-000000000002'
    const OCCURRED_AT = '2026-11-05T10:00:00.000Z'
    const QUALIFIED_VERSION = METRIC_VERSION_IDS.qualifiedScanGoal

    async function seedFact(
      id: string,
      eventType: string,
      supersedesSourceEventId: string | null,
    ) {
      await pool.query(
        `INSERT INTO outbox_events (
           id, event_type, event_version, payload, organization_id, property_id,
           source_context, source_aggregate_id, created_at, published_at
         ) VALUES (
           $1, $2, 1, jsonb_strip_nulls(jsonb_build_object(
             'organizationId', $3::text,
             'propertyId', $4::text,
             'portalId', $5::text,
             'occurredAt', $6::text,
             'supersedesSourceEventId', $7::text
           )), $3, $4, 'guest', $5, $6::timestamptz, $6::timestamptz
         )`,
        [id, eventType, ORG, PROP, PORTAL, OCCURRED_AT, supersedesSourceEventId],
      )
      await pool.query(
        `INSERT INTO event_consumer_receipts (event_id, consumer_name, status)
         VALUES ($1, 'metric.guest-analytics', 'applied')`,
        [id],
      )
    }

    beforeAll(async () => {
      await seedFact(RECORDED, 'guest.qualified_scan.recorded', null)
      await pool.query(
        `INSERT INTO metric_readings (
           organization_id, property_id, portal_id, metric_key, value,
           definition_version_id, source_event_id, source_policy, exact_value,
           sample_count, attribution_quality, recorded_at, event_at,
           property_local_date, data_quality, retention_class
         )
         VALUES ($1, $2, $3, 'portal.qualified_scan', 1, $4, $5,
           'first_party_guest_gateway_metric', 1, 1, 'exact',
           $6, $6, '2026-11-05', 'exact', 'standard')`,
        [ORG, PROP, PORTAL, QUALIFIED_VERSION, RECORDED, OCCURRED_AT],
      )
    })

    it('waits for the retraction correction before calling the scans ready', async () => {
      await seedFact(RETRACTED, 'guest.qualified_scan.retracted', RECORDED)

      const missing = await repository().getPortalMetricEvidence(
        ORG,
        PROP,
        PORTAL,
        RETRACTION_START,
        RETRACTION_END,
      )
      expect(missing.scans).toMatchObject({
        state: 'unavailable',
        availabilityReason: 'projection_missing',
      })

      await pool.query(
        `INSERT INTO metric_corrections (
           reading_id, source_event_id, kind, reason, actor_type, actor_id, event_at
         )
         SELECT id, $2, 'retract', 'guest retraction', 'system',
           'results-measures-test', $3
         FROM metric_readings
         WHERE organization_id = $1 AND source_event_id = $4`,
        [ORG, `${RETRACTED}:${QUALIFIED_VERSION}`, OCCURRED_AT, RECORDED],
      )

      const settled = await repository().getPortalMetricEvidence(
        ORG,
        PROP,
        PORTAL,
        RETRACTION_START,
        RETRACTION_END,
      )
      expect(settled.scans).toMatchObject({
        state: 'ready',
        completeness: 1,
        availabilityReason: null,
      })
      const sums = await repository().getPortalKpiSums(
        ORG,
        PROP,
        PORTAL,
        RETRACTION_START,
        RETRACTION_END,
      )
      expect(sums).toEqual([{ metricKey: 'portal.qualified_scan', total: 0, count: 0 }])
    })
  })
})
