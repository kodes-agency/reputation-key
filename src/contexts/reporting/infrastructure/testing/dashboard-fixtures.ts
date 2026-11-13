// Real-PostgreSQL rows for dashboard reads: a Property, Reviews with their
// served content, published Replies, a Portal and the governed Metric readings
// the Dashboard Repository sums.

import type { Pool } from 'pg'
import type { Database } from '#/shared/db'
import type { DashboardRepository } from '../../application/ports/dashboard.repository'
import type { ReviewStatsPort } from '../../application/ports/review-stats.port'
import { createDashboardRepository } from '../repositories/dashboard.repository'
import { createMetricStatsAdapter } from '../adapters/metric-stats.adapter'

let fixtureSequence = 0

/** Deterministic UUID-shaped id, unique within the test process. */
function nextFixtureId(): string {
  fixtureSequence += 1
  return `00000000-0000-4000-8000-${String(fixtureSequence).padStart(12, '0')}`
}
import { METRIC_VERSION_IDS } from '../../readings/contracts'

const MS_PER_DAY = 86_400_000
const MS_PER_HOUR = 3_600_000

export async function seedDashboardProperty(
  pool: Pool,
  input: { id: string; organizationId: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, $3, $4, 'UTC')
     ON CONFLICT (id) DO NOTHING`,
    [
      input.id,
      input.organizationId,
      `Dashboard ${input.id.slice(0, 8)}`,
      `dashboard-${input.id.slice(0, 8)}`,
    ],
  )
}

/** A Review with eligible served content, reviewed `daysBefore` days before `now`. */
export async function seedDashboardReview(
  pool: Pool,
  input: {
    organizationId: string
    propertyId: string
    now: Date
    rating: number
    text?: string
    daysBefore: number
    publishedReplyAfterHours?: number
  },
): Promise<string> {
  const id = nextFixtureId()
  const reviewedAt = new Date(input.now.getTime() - input.daysBefore * MS_PER_DAY)
  const contentExpiresAt = new Date(input.now.getTime() + 30 * MS_PER_DAY)
  const externalId = `ext-${id}`
  const locationId = `loc-${id}`
  await pool.query(
    `INSERT INTO reviews (
       id, organization_id, property_id, platform, external_id, external_location_id,
       expires_at, first_fetched_at, source_epoch, source_revision, analysis_sequence
     ) VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, 0, 0, 0)`,
    [
      id,
      input.organizationId,
      input.propertyId,
      externalId,
      locationId,
      contentExpiresAt,
      reviewedAt,
    ],
  )
  await pool.query(
    `INSERT INTO review_source_contents (
       review_id, organization_id, property_id, platform, external_id,
       external_location_id, rating, text, reviewed_at, first_fetched_at,
       last_fetched_at, content_expires_at, source_epoch, source_revision,
       ai_source_byte_length, ai_source_digest
     ) VALUES ($1, $2, $3, 'google', $4, $5, $6, $7, $8, $8, $8, $9, 0, 0, 1,
               repeat('0', 64))`,
    [
      id,
      input.organizationId,
      input.propertyId,
      externalId,
      locationId,
      input.rating,
      input.text ?? 'Review text',
      reviewedAt,
      contentExpiresAt,
    ],
  )
  if (input.publishedReplyAfterHours !== undefined) {
    await pool.query(
      `INSERT INTO replies (id, review_id, organization_id, text, status, source, published_at)
       VALUES ($1, $2, $3, 'Thanks', 'published', 'internal', $4)`,
      [
        nextFixtureId(),
        id,
        input.organizationId,
        new Date(reviewedAt.getTime() + input.publishedReplyAfterHours * MS_PER_HOUR),
      ],
    )
  }
  return id
}

export async function seedDashboardPortal(
  pool: Pool,
  input: { id: string; organizationId: string; propertyId: string },
): Promise<void> {
  await pool.query(
    `INSERT INTO portals (id, organization_id, property_id, entity_type, entity_id, name, slug)
     VALUES ($1, $2, $3, 'property', $4, 'Test Portal', $5)
     ON CONFLICT (id) DO NOTHING`,
    [
      input.id,
      input.organizationId,
      input.propertyId,
      input.propertyId,
      `portal-${input.id.slice(0, 8)}`,
    ],
  )
}

const METRIC_CONTRACTS = {
  'portal.scan': {
    definitionVersionId: METRIC_VERSION_IDS.portalScanAnalytics,
    sourcePolicy: 'review_solicitation_analytics_only',
  },
  'portal.rating': {
    definitionVersionId: METRIC_VERSION_IDS.portalRatingAnalytics,
    sourcePolicy: 'first_party_guest_private',
  },
  'portal.feedback': {
    definitionVersionId: METRIC_VERSION_IDS.portalFeedbackAnalytics,
    sourcePolicy: 'first_party_guest_private',
  },
  'portal.review_link_click': {
    definitionVersionId: METRIC_VERSION_IDS.portalDestinationClickAnalytics,
    sourcePolicy: 'review_solicitation_analytics_only',
  },
} as const

export type DashboardMetricKey = keyof typeof METRIC_CONTRACTS

/** One governed Metric reading, `daysBefore` days before `now`. */
export async function seedDashboardMetricReading(
  pool: Pool,
  input: {
    organizationId: string
    propertyId: string
    portalId?: string
    metricKey: DashboardMetricKey
    value: number
    now: Date
    daysBefore: number
  },
): Promise<void> {
  const id = nextFixtureId()
  const contract = METRIC_CONTRACTS[input.metricKey]
  const eventAt = new Date(input.now.getTime() - input.daysBefore * MS_PER_DAY)
  await pool.query(
    `INSERT INTO metric_readings (
       id, organization_id, property_id, portal_id, metric_key, value,
       recorded_at, event_at, definition_version_id, source_event_id,
       source_policy, exact_value, sample_count, attribution_quality,
       property_local_date, data_quality, retention_class
     ) VALUES (
       $1, $2, $3, $4, $5, $6::real,
       $7, $7, $8, $9,
       $10, $6::numeric, 1, 'exact',
       $11, 'exact', 'standard'
     )`,
    [
      id,
      input.organizationId,
      input.propertyId,
      input.portalId ?? null,
      input.metricKey,
      input.value,
      eventAt,
      contract.definitionVersionId,
      `dashboard-fixture:${id}`,
      contract.sourcePolicy,
      eventAt.toISOString().slice(0, 10),
    ],
  )
}

/** Records which reads were issued, so a test can prove a refusal came before any read. */
export function recordedDashboardRepo(
  db: Database,
  reviewStats: ReviewStatsPort,
): {
  repo: DashboardRepository
  calls: string[]
} {
  const real = createDashboardRepository(reviewStats, createMetricStatsAdapter(db))
  const calls: string[] = []
  const repo = Object.fromEntries(
    Object.entries(real).map(([name, read]) => [
      name,
      (input: never) => {
        calls.push(name)
        return (read as (input: never) => unknown)(input)
      },
    ]),
  ) as DashboardRepository
  return { repo, calls }
}
