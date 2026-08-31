import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { getTableConfig } from 'drizzle-orm/pg-core'
import { describe, expect, it } from 'vitest'
import {
  metricCurrentGoogleReputationSnapshots,
  reviewGoogleReputationSnapshotFacts,
  reviewProviderSnapshotRuns,
} from './schema'

const migration = readFileSync(
  resolve(process.cwd(), 'drizzle/0154_review_google_reputation_snapshot.sql'),
  'utf8',
)
const journal = JSON.parse(
  readFileSync(resolve(process.cwd(), 'drizzle/meta/_journal.json'), 'utf8'),
) as { entries: Array<{ idx: number; when: number; tag: string }> }

describe('0154 verified Google reputation snapshot', () => {
  it('stores Review proof and Metric current state outside bounded readings', () => {
    const runColumns = getTableConfig(reviewProviderSnapshotRuns).columns.map(
      (column) => column.name,
    )
    const reviewColumns = getTableConfig(reviewGoogleReputationSnapshotFacts).columns.map(
      (column) => column.name,
    )
    const metricColumns = getTableConfig(
      metricCurrentGoogleReputationSnapshots,
    ).columns.map((column) => column.name)

    expect(runColumns).toContain('expected_average_rating')
    expect(reviewColumns).toEqual(
      expect.arrayContaining([
        'organization_id',
        'property_id',
        'source_epoch',
        'run_id',
        'review_count',
        'average_rating',
        'evaluated_at',
      ]),
    )
    expect(metricColumns).toEqual(
      expect.arrayContaining([
        'source_epoch',
        'source_run_id',
        'source_event_id',
        'review_count',
        'average_rating',
        'evaluated_at',
      ]),
    )
    expect(migration).not.toMatch(/INSERT INTO\s+"metric_readings"/u)
  })

  it('fences invalid count/average pairs in every durable table', () => {
    expect(migration).toContain('review_google_reputation_snapshot_value_valid')
    expect(migration).toContain('metric_current_google_reputation_value_valid')
    expect(migration).toContain('expected_average_rating')
    expect(migration).toContain('"expected_total" = NULL')
    expect(migration).not.toContain('NOT VALID')
  })

  it('follows the reserved AI migration in the monotonic journal', () => {
    const previous = journal.entries.find(({ idx }) => idx === 153)
    const current = journal.entries.find(({ idx }) => idx === 154)
    expect(current).toMatchObject({
      idx: 154,
      when: 1790352000025,
      tag: '0154_review_google_reputation_snapshot',
    })
    expect(current!.when).toBeGreaterThan(previous!.when)
  })
})
