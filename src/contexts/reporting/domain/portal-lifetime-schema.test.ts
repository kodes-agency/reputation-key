import { describe, expect, it } from 'vitest'
import { PgDialect, getTableConfig } from 'drizzle-orm/pg-core'
import {
  metricReadings,
  portalMetricLifetimeAggregates,
} from '#/shared/db/schema/metric.schema'

describe('portalMetricLifetimeAggregates privacy contract', () => {
  it('retains only anonymous counts, checkpoints, and operational rebuild clocks', () => {
    const columns = getTableConfig(portalMetricLifetimeAggregates).columns.map(
      (column) => column.name,
    )

    expect(columns).toEqual(
      expect.arrayContaining([
        'qualified_scan_count',
        'private_rating_count',
        'private_rating_sum',
        'private_rating_1_count',
        'private_rating_5_count',
        'private_feedback_count',
        'google_review_selection_count',
        'secondary_link_selection_count',
        'sealed_through_local_date',
        'projection_revision',
      ]),
    )
    for (const forbidden of [
      'response_id',
      'session_id',
      'source_event_id',
      'contact',
      'email',
      'phone',
      'event_at',
      'latest_activity',
    ]) {
      expect(columns).not.toContain(forbidden)
    }
  })

  it('pins tenant/Property/Portal ownership and numeric invariants', () => {
    const config = getTableConfig(portalMetricLifetimeAggregates)
    expect(config.foreignKeys.map((key) => key.getName())).toContain(
      'portal_metric_lifetime_portal_fk',
    )
    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        'portal_metric_lifetime_nonnegative_check',
        'portal_metric_lifetime_rating_check',
        'portal_metric_lifetime_sealed_nonnegative_check',
        'portal_metric_lifetime_sealed_rating_check',
      ]),
    )
  })
})

describe('metric reading link attribution', () => {
  it('allows a content-free link id only on a secondary destination click', () => {
    const config = getTableConfig(metricReadings)
    expect(
      config.columns.find((column) => column.name === 'portal_link_id')?.getSQLType(),
    ).toBe('uuid')
    const check = config.checks.find(
      (constraint) => constraint.name === 'metric_readings_portal_link_check',
    )
    expect(check).toBeDefined()
    const sql = new PgDialect().sqlToQuery(check!.value).sql
    expect(sql).toContain('"portal_link_id" IS NULL OR')
    expect(sql).toContain("'portal.review_link_click'")
    expect(sql).toContain("'secondary_link'")
  })
})
