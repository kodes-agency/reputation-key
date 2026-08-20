// Dashboard read facade — the metric_readings scope predicates bind the
// analytics window to EVENT time.
//
// This is a compiled-SQL pin, not a data test: the regression it guards is a
// column swap that no in-memory fake can see. `metricReadings.occurredAt` is
// the drizzle field for the `recorded_at` column (metric.schema.ts) — the
// INGESTION timestamp — while the guest-action time lives in `event_at`
// (metric-command-store.ts writes `eventAt: reading.occurredAt`). Bounding the
// window on ingestion means outbox lag, a retry or a replay silently shifts a
// day's numbers.

import { describe, it, expect } from 'vitest'
import type { SQL } from 'drizzle-orm'
import { PgDialect } from 'drizzle-orm/pg-core'
import { organizationId, propertyId, portalId } from '#/shared/domain/ids'
import { metricPeriodWhere, metricPortalWhere, metricPortalsWhere } from './read-facade'

const dialect = new PgDialect()

const render = (fragment: SQL | undefined): string => {
  if (!fragment) throw new Error('scope predicate must not be empty')
  return dialect.sqlToQuery(fragment).sql
}

const ORG = organizationId('org-read-facade')
const PROP = propertyId('a0000000-0000-0000-0000-000000000001')
const PORTAL_A = portalId('b0000000-0000-0000-0000-000000000001')
const PORTAL_B = portalId('b0000000-0000-0000-0000-000000000002')
const START = new Date('2026-06-01T00:00:00Z')
const END = new Date('2026-06-30T23:59:59.999Z')

describe('metric_readings scope predicates', () => {
  it('bounds the period on event_at, never on the recorded_at ingestion column', () => {
    const compiled = render(metricPeriodWhere(ORG, PROP, START, END))

    expect(compiled).toContain('"event_at" >=')
    expect(compiled).toContain('"event_at" <=')
    expect(compiled).not.toContain('recorded_at')
  })

  it('keeps the tenant + property predicates alongside the event-time bounds', () => {
    const compiled = render(metricPeriodWhere(ORG, PROP, START, END))

    expect(compiled).toContain('"organization_id"')
    expect(compiled).toContain('"property_id"')
  })

  it('scopes one portal on event time', () => {
    const compiled = render(metricPortalWhere(ORG, PROP, PORTAL_A, START, END))

    expect(compiled).toContain('"event_at" >=')
    expect(compiled).toContain('"portal_id" =')
    expect(compiled).not.toContain('recorded_at')
  })

  it('scopes a portal set on event time', () => {
    const compiled = render(
      metricPortalsWhere(ORG, PROP, [PORTAL_A, PORTAL_B], START, END),
    )

    expect(compiled).toContain('"event_at" >=')
    expect(compiled).toContain('"portal_id" in')
    expect(compiled).not.toContain('recorded_at')
  })
})
