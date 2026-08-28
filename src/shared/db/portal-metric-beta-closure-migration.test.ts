import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0139_portal_metric_beta_closure.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; tag: string }> }

describe('0139 Portal + Metric beta closure migration', () => {
  it('creates durable Portal pending-content provenance and exact resolution fencing', () => {
    expect(migration).toContain('CREATE TABLE "portal_pending_content_changes"')
    expect(migration).toContain('portal_pending_content_changes_source_unique')
    expect(migration).toContain('portal_pending_content_changes_open_idx')
    expect(migration).toContain('portal_pending_content_changes_snapshot_tenant_fk')
    expect(migration).toContain('portal_pending_content_changes_resolution_pair')
  })

  it('fails closed for every still-unclassified legacy raw destination', () => {
    expect(migration).toMatch(
      /UPDATE "portal_links"[\s\S]+"legacy_destination_state" = 'quarantined'[\s\S]+"destination_id" IS NULL[\s\S]+"legacy_destination_state" = 'unclassified'/u,
    )
  })

  it('captures the concurrent Portal lifetime Metric schema exactly once', () => {
    expect(migration).toContain('CREATE TABLE "portal_metric_lifetime_aggregates"')
    expect(migration).toContain('portal_metric_lifetime_scope_unique')
    expect(migration).toContain(
      'ALTER TABLE "metric_readings" ADD COLUMN "portal_destination_kind"',
    )
    expect(migration).toContain('metric_readings_portal_destination_kind_check')
  })

  it('owns journal slot 0139 under the combined closure name', () => {
    expect(
      journal.entries
        .filter(({ idx }) => idx === 139)
        .map(({ idx, tag }) => ({ idx, tag })),
    ).toEqual([{ idx: 139, tag: '0139_portal_metric_beta_closure' }])
  })
})
