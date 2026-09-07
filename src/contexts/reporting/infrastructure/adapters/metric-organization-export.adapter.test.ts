import { describe, expect, it } from 'vitest'
import type { SQL } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createMetricOrganizationExportAdapter } from './metric-organization-export.adapter'

const AS_OF = new Date('2026-08-28T09:00:00.000Z')
const SNAPSHOT_AT = '2026-08-28T09:00:30.000Z'

type Row = Record<string, unknown>

type FixtureRows = Readonly<{
  readings?: readonly Row[]
  portalLifetime?: readonly Row[]
  currentGoogleReputation?: readonly Row[]
  corrections?: readonly Row[]
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

describe('Metric Organization Export contributor', () => {
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
    const withoutSourcePolicy = Object.fromEntries(
      Object.entries(READING_ROW).filter(([column]) => column !== 'source_policy'),
    )
    const adapter = createMetricOrganizationExportAdapter(
      fakeDatabase({ readings: [withoutSourcePolicy] }),
    )

    await expect(
      adapter.contribute({
        organizationId: 'org-metric-export',
        requestId: 'a',
        asOf: AS_OF,
      }),
    ).rejects.toThrow(/Metric export column is missing: source_policy/)
  })
})
