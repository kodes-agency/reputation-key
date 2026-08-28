import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { CLASSIFICATIONS_BY_CONTEXT } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import { createMetricOrganizationExportAdapter } from './metric-organization-export.adapter'

// Mirrors the rules `buildOrganizationExportBundle` enforces
// (identity/application/organization-export-contract.ts). They are restated
// here because a contributor test may only import the port; the end-to-end
// proof against the real builder lives in the full-composition task.
const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]{0,199}$/
const FORBIDDEN_PATH_COMPONENT =
  /(?:^|[/_.-])(?:oauth|secrets?|sessions?|cookies?|passwords?|hash(?:es)?|credentials?|tokens?|keys?|queues?|outbox(?:es)?|receipts?|rate.?limits?|fraud|security|prompts?|inferences?|operational.?actions?)(?=$|[/_.-])/iu

const AS_OF = new Date('2026-08-28T09:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T09:00:30.000Z'

type Row = Record<string, unknown>

type FixtureRows = Readonly<{
  readings?: readonly Row[]
  portalLifetime?: readonly Row[]
  currentGoogleReputation?: readonly Row[]
  corrections?: readonly Row[]
  watermarks?: readonly Row[]
}>

function queryText(query: SQL): string {
  const chunks = (query as unknown as { queryChunks: readonly unknown[] }).queryChunks
  return chunks
    .map((chunk) => {
      if (typeof chunk !== 'object' || chunk === null || !('value' in chunk)) return ' '
      const { value } = chunk as { value: unknown }
      return Array.isArray(value) ? value.join('') : ' '
    })
    .join('')
}

function fakeDatabase(rows: FixtureRows, snapshotAt: string = SNAPSHOT_AT): Database {
  const snapshot = {
    execute: async (query: SQL) => {
      const text = queryText(query)
      if (text.includes('transaction_timestamp()')) {
        return { rows: [{ snapshot_at: snapshotAt }] }
      }
      if (text.includes('FROM metric_readings AS reading')) {
        return { rows: rows.readings ?? [] }
      }
      if (text.includes('FROM portal_metric_lifetime_aggregates')) {
        return { rows: rows.portalLifetime ?? [] }
      }
      if (text.includes('FROM metric_current_google_reputation_snapshots')) {
        return { rows: rows.currentGoogleReputation ?? [] }
      }
      if (text.includes('FROM metric_corrections AS correction')) {
        return { rows: rows.corrections ?? [] }
      }
      if (text.includes('FROM metric_source_watermarks')) {
        return { rows: rows.watermarks ?? [] }
      }
      throw new Error(`unrouted metric export query: ${text}`)
    },
  }
  return {
    transaction: async (work: (tx: unknown) => Promise<unknown>) => work(snapshot),
  } as unknown as Database
}

const READING_ROW: Row = {
  id: '20000000-0000-4000-8000-000000000001',
  property_id: '10000000-0000-4000-8000-000000000001',
  portal_id: '10000000-0000-4000-8000-000000000002',
  group_id: null,
  metric_key: 'portal.rating_count',
  definition_version_id: '11111111-1111-4111-8111-111111111302',
  definition_version: 1,
  unit: 'rating',
  value_precision: 0,
  source_policy: 'first_party_guest_gateway_metric',
  recorded_exact_value: '1.0000000000',
  effective_exact_value: '4.0000000000',
  correction_state: 'replace',
  correction_head_id: '30000000-0000-4000-8000-000000000001',
  numerator: null,
  denominator: null,
  sample_count: 1,
  attribution_quality: 'exact',
  data_quality: 'exact',
  retention_class: 'guest_gateway_metric',
  property_local_date: '2026-08-27',
  event_at: '2026-08-27T10:00:00.000000Z',
  recorded_at: '2026-08-27T10:00:01.000000Z',
  attributed_staff_participant_id: null,
  attributed_staff_participation_id: null,
  attribution_responsibility_id: null,
  staff_attribution_effective_from: null,
  staff_attribution_effective_to: null,
}

const WATERMARK_ROW: Row = {
  consumer_name: 'metric.guest-gateway',
  source_name: 'guest.response.recorded',
  property_id: '10000000-0000-4000-8000-000000000001',
  definition_version_id: '11111111-1111-4111-8111-111111111302',
  last_event_at: '2026-08-27T10:00:00.000000Z',
  updated_at: '2026-08-27T10:00:02.000000Z',
}

function decode(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8')
}

describe('Metric Organization Export contributor', () => {
  it('is a metric contributor whose entries all carry a permitted classification', async () => {
    const adapter = createMetricOrganizationExportAdapter(
      fakeDatabase({ readings: [READING_ROW], watermarks: [WATERMARK_ROW] }),
    )
    expect(adapter.context).toBe('metric')

    const contribution = await adapter.contribute({
      organizationId: 'org-metric-export',
      requestId: 'request-1',
      asOf: AS_OF,
    })

    expect(contribution.context).toBe('metric')
    expect(contribution.coverage).toBe('complete')
    expect(contribution.omissionCodes).toEqual([])
    for (const entry of contribution.entries) {
      expect(entry.path.startsWith('metric/')).toBe(true)
      expect(SAFE_PATH.test(entry.path)).toBe(true)
      expect(FORBIDDEN_PATH_COMPONENT.test(entry.path)).toBe(false)
      expect(entry.path).not.toContain('..')
      expect(CLASSIFICATIONS_BY_CONTEXT.metric).toContain(entry.classification)
      expect(entry.bytes.byteLength).toBeGreaterThan(0)
    }
    expect(contribution.entries.map(({ mediaType }) => mediaType)).toContain('text/csv')
    expect(contribution.entries.map(({ mediaType }) => mediaType)).toContain(
      'application/json',
    )
  })

  it('emits only populated families, paired CSV and JSON, in ascending byte order', async () => {
    const adapter = createMetricOrganizationExportAdapter(
      fakeDatabase({ readings: [READING_ROW], watermarks: [WATERMARK_ROW] }),
    )

    const contribution = await adapter.contribute({
      organizationId: 'org-metric-export',
      requestId: 'request-1',
      asOf: AS_OF,
    })

    // corrections / portal-lifetime / current-google-reputation had no rows,
    // so no header-only file claims a family that does not exist.
    expect(contribution.entries.map(({ path }) => path)).toEqual([
      'metric/readings.csv',
      'metric/readings.json',
      'metric/watermarks.csv',
      'metric/watermarks.json',
    ])
    const paths = contribution.entries.map(({ path }) => path)
    const byUtf8 = [...paths].sort((left, right) =>
      Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')),
    )
    expect(paths).toEqual(byUtf8)
  })

  it('produces byte-identical output for a repeated request at the same asOf', async () => {
    const rows: FixtureRows = { readings: [READING_ROW], watermarks: [WATERMARK_ROW] }
    const first = await createMetricOrganizationExportAdapter(
      fakeDatabase(rows, '2026-08-28T09:00:05.000Z'),
    ).contribute({ organizationId: 'org-metric-export', requestId: 'a', asOf: AS_OF })
    const replay = await createMetricOrganizationExportAdapter(
      // A later snapshot clock inside the permitted window must not change a
      // single byte: the archive is a function of (organizationId, asOf).
      fakeDatabase(rows, '2026-08-28T09:10:00.000Z'),
    ).contribute({ organizationId: 'org-metric-export', requestId: 'b', asOf: AS_OF })

    expect(first.entries.map(({ bytes }) => decode(bytes))).toEqual(
      replay.entries.map(({ bytes }) => decode(bytes)),
    )
  })

  it('carries definition version, unit, period boundary and correction head on every reading', async () => {
    const contribution = await createMetricOrganizationExportAdapter(
      fakeDatabase({ readings: [READING_ROW] }),
    ).contribute({ organizationId: 'org-metric-export', requestId: 'a', asOf: AS_OF })

    const csv = decode(
      contribution.entries.find(({ path }) => path === 'metric/readings.csv')!.bytes,
    )
    const [header, row] = csv.trimEnd().split('\n')
    for (const column of [
      'definition_version_id',
      'definition_version',
      'unit',
      'property_local_date',
      'event_at',
      'correction_state',
      'correction_head_id',
      'effective_exact_value',
      'recorded_exact_value',
    ]) {
      expect(header!.split(',')).toContain(column)
    }
    // The corrected tip is exported, and the superseded original stays visible
    // beside it rather than being silently overwritten.
    const values = row!.split(',')
    const columnValue = (column: string) => values[header!.split(',').indexOf(column)]
    expect(columnValue('effective_exact_value')).toBe('4.0000000000')
    expect(columnValue('recorded_exact_value')).toBe('1.0000000000')
    expect(columnValue('correction_state')).toBe('replace')

    const json = JSON.parse(
      decode(
        contribution.entries.find(({ path }) => path === 'metric/readings.json')!.bytes,
      ),
    ) as Record<string, unknown>
    expect(json.version).toBe('metric-organization-export/v1')
    expect(json.requestedAsOf).toBe(AS_OF.toISOString())
    expect(json.excludedRecordClasses).toEqual(
      expect.arrayContaining([
        {
          recordClass: 'metric_quarantine',
          reasonCode: 'integrity_and_abuse_review_internal',
        },
        {
          recordClass: 'legacy_rollup_projections',
          reasonCode: 'dead_projection_without_beta_reader',
        },
      ]),
    )
  })

  it('answers no_data affirmatively rather than inventing an empty CSV', async () => {
    const contribution = await createMetricOrganizationExportAdapter(
      fakeDatabase({}),
    ).contribute({ organizationId: 'org-metric-export', requestId: 'a', asOf: AS_OF })

    expect(contribution).toEqual({
      context: 'metric',
      coverage: 'no_data',
      omissionCodes: [],
      entries: [],
    })
  })

  it('fails closed when the request is older than the bounded snapshot window', async () => {
    const adapter = createMetricOrganizationExportAdapter(
      fakeDatabase({ readings: [READING_ROW] }, '2026-08-28T09:16:01.000Z'),
    )

    await expect(
      adapter.contribute({
        organizationId: 'org-metric-export',
        requestId: 'a',
        asOf: AS_OF,
      }),
    ).rejects.toThrow(/snapshot window is unavailable/)
  })

  it('refuses a row that lost a declared column instead of shipping a silent gap', async () => {
    const withoutUnit = Object.fromEntries(
      Object.entries(READING_ROW).filter(([column]) => column !== 'unit'),
    )
    const adapter = createMetricOrganizationExportAdapter(
      fakeDatabase({ readings: [withoutUnit] }),
    )

    await expect(
      adapter.contribute({
        organizationId: 'org-metric-export',
        requestId: 'a',
        asOf: AS_OF,
      }),
    ).rejects.toThrow(/Metric export column is missing: unit/)
  })
})
