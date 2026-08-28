import { describe, expect, it } from 'vitest'
import {
  buildOrganizationExportBundle,
  CLASSIFICATIONS_BY_CONTEXT,
} from '#/contexts/identity/application/organization-export-contract'
import type { OrganizationLifecycleContext } from '#/contexts/identity/application/ports/organization-export-contributor.port'
import {
  aiExportRecordCount,
  buildAiExportEntries,
  sortAiExportRows,
  type AiOrganizationExportPayload,
} from './ai-organization-export.adapter'

const ASOF = new Date('2026-08-28T09:00:00.000Z')

// Derived from the contract rather than restated, so a context added to the
// bundle cannot leave this file asserting against a stale set.
const ALL_CONTEXTS = Object.keys(
  CLASSIFICATIONS_BY_CONTEXT,
) as readonly OrganizationLifecycleContext[]

const analysis = (reviewId: string, sequence: number) => ({
  property_id: '84000000-0000-4000-8000-000000000001',
  review_id: reviewId,
  source_epoch: 0,
  source_revision: 1,
  analysis_sequence: sequence,
  review_analysis_epoch: 1,
  property_profile_version: 1,
  analysis_profile_version: 'review-analysis-v1',
  authorization_lineage_id: '84000000-0000-4000-8000-0000000000aa',
  status: 'ready',
  unavailable_reason: null,
  sentiment: 'positive',
  primary_category: 'service',
  attention: 'low',
  generated_at: '2026-08-27T09:30:00.000000Z',
  expires_at: '2026-08-28T09:30:00.000000Z',
})

const payload = (
  overrides: Partial<AiOrganizationExportPayload> = {},
): AiOrganizationExportPayload => ({
  version: 'ai-organization-export/v1',
  requestedAsOf: ASOF.toISOString(),
  snapshotBound: 'repeatable_read_within_15m_of_request',
  reviewAnalyses: [analysis('review-a', 1), analysis('review-b', 2)],
  propertyDailyAggregates: [
    {
      property_id: '84000000-0000-4000-8000-000000000001',
      local_date: '2026-08-27',
      source_epoch: 0,
      review_analysis_epoch: 1,
      property_profile_version: 1,
      calendar_profile_version: 'property-calendar-v1',
      aggregate_revision: 1,
      terminal_analysis_sequence: 2,
      review_count: 2,
      rating_sum: 9,
      positive_count: 2,
      neutral_count: 0,
      negative_count: 0,
      mixed_count: 0,
      service_count: 2,
      staff_count: 0,
      quality_count: 0,
      value_count: 0,
      cleanliness_count: 0,
      wait_time_count: 0,
      atmosphere_count: 0,
      location_count: 0,
      accessibility_count: 0,
      other_count: 0,
      urgent_count: 0,
      high_count: 0,
      medium_count: 0,
      low_count: 2,
      updated_at: '2026-08-27T09:30:00.000000Z',
    },
  ],
  propertyTrendOutcomes: [
    {
      schedule_id: '84000000-0000-4000-8000-0000000000bb',
      property_id: '84000000-0000-4000-8000-000000000001',
      due_local_date: '2026-08-27',
      disposition: 'ready',
      signal_key: 'category.service',
      direction: 'improving',
      confidence_basis_points: 1500,
      supporting_review_count: 2,
      headline: 'Review signals improved',
      summary: 'Service improved.',
      sentences: ['Service improved.'],
      selected_signal_ids: ['category.service'],
      definition_version: null,
      definition_digest: null,
      render_profile_version: 'trend-render-v1',
      render_profile_digest: '4'.repeat(64),
      evidence: null,
      source_epoch: 0,
      review_analysis_epoch: 1,
      property_trends_epoch: 1,
      property_profile_version: 1,
      recorded_at: '2026-08-27T09:30:00.000000Z',
      expires_at: '2026-08-28T09:30:00.000000Z',
    },
  ],
  excludedRecordClasses: [
    {
      recordClass: 'ai_operations_and_attempts',
      reasonCode: 'prompt_and_inference_internals',
    },
  ],
  ...overrides,
})

const text = (entries: readonly { path: string; bytes: Uint8Array }[], path: string) =>
  Buffer.from(entries.find((entry) => entry.path === path)!.bytes).toString('utf8')

describe('AI Organization Export entries', () => {
  it('renders byte-identical files for the same payload', () => {
    expect(buildAiExportEntries(payload())).toEqual(buildAiExportEntries(payload()))
  })

  it('orders rows by UTF-8 bytes, not by the order PostgreSQL returned them', () => {
    // 'Z' (0x5A) sorts before 'a' (0x61) in byte order but after it under a
    // case-insensitive host collation, and the padded sequence keeps 10 after 9
    // instead of the lexicographic order a raw number string would give.
    const rows = [
      { review_id: 'a1', analysis_sequence: 10 },
      { review_id: 'Z9', analysis_sequence: 10 },
      { review_id: 'a1', analysis_sequence: 9 },
    ]
    const sortKey = (record: Readonly<Record<string, unknown>>) => [
      record.analysis_sequence as number,
      record.review_id as string,
    ]

    expect(
      sortAiExportRows(rows, sortKey).map(
        ({ review_id: id, analysis_sequence: seq }) => `${String(seq)}:${String(id)}`,
      ),
    ).toEqual(['9:a1', '10:Z9', '10:a1'])
    expect(sortAiExportRows([...rows].reverse(), sortKey)).toEqual(
      sortAiExportRows(rows, sortKey),
    )
  })

  it('emits one CSV and one JSON per retained derivative class', () => {
    expect(
      buildAiExportEntries(payload()).map(({ path, mediaType, classification }) => ({
        path,
        mediaType,
        classification,
      })),
    ).toEqual([
      {
        path: 'ai/review-analyses.csv',
        mediaType: 'text/csv',
        classification: 'retained_ai_derivative',
      },
      {
        path: 'ai/review-analyses.json',
        mediaType: 'application/json',
        classification: 'retained_ai_derivative',
      },
      {
        path: 'ai/property-daily-aggregates.csv',
        mediaType: 'text/csv',
        classification: 'retained_ai_derivative',
      },
      {
        path: 'ai/property-daily-aggregates.json',
        mediaType: 'application/json',
        classification: 'retained_ai_derivative',
      },
      {
        path: 'ai/property-trend-outcomes.csv',
        mediaType: 'text/csv',
        classification: 'retained_ai_derivative',
      },
      {
        path: 'ai/property-trend-outcomes.json',
        mediaType: 'application/json',
        classification: 'retained_ai_derivative',
      },
    ])
  })

  it('stamps only a classification the contract permits AI to use', () => {
    for (const entry of buildAiExportEntries(payload())) {
      expect(CLASSIFICATIONS_BY_CONTEXT.ai).toContain(entry.classification)
    }
  })

  it('never carries the operation identifier that points at the inference plane', () => {
    const archive = buildAiExportEntries(payload())
      .map(({ bytes }) => Buffer.from(bytes).toString('utf8'))
      .join('\n')

    expect(archive).not.toContain('operation_id')
    expect(archive).not.toContain('subject_hmac')
    expect(archive).not.toContain('request_fingerprint')
  })

  it('writes each collection under its own header', () => {
    expect(
      text(buildAiExportEntries(payload()), 'ai/review-analyses.csv').split('\n')[0],
    ).toBe(
      'property_id,review_id,source_epoch,source_revision,analysis_sequence,' +
        'review_analysis_epoch,property_profile_version,analysis_profile_version,' +
        'authorization_lineage_id,status,unavailable_reason,sentiment,' +
        'primary_category,attention,generated_at,expires_at',
    )
    expect(
      text(buildAiExportEntries(payload()), 'ai/property-trend-outcomes.csv')
        .trimEnd()
        .split('\n'),
    ).toHaveLength(2)
  })

  it('counts every collection when deciding complete versus no_data', () => {
    expect(aiExportRecordCount(payload())).toBe(4)
    expect(
      aiExportRecordCount(
        payload({
          reviewAnalyses: [],
          propertyDailyAggregates: [],
          propertyTrendOutcomes: [],
        }),
      ),
    ).toBe(0)
  })

  it('is accepted by the Organization Export bundle builder', async () => {
    const entries = buildAiExportEntries(payload())
    const bundle = await buildOrganizationExportBundle({
      organizationId: 'org-1',
      requestId: 'req-1',
      asOf: ASOF,
      contributors: ALL_CONTEXTS.map((context) =>
        context === 'ai'
          ? {
              context,
              contribute: async () => ({
                context,
                coverage: 'complete' as const,
                omissionCodes: [],
                entries,
              }),
            }
          : {
              context,
              contribute: async () => ({
                context,
                coverage: 'no_data' as const,
                omissionCodes: [],
                entries: [],
              }),
            },
      ),
    })

    expect(bundle.entries.map(({ path }) => path)).toEqual(
      expect.arrayContaining([
        'ai/review-analyses.csv',
        'ai/review-analyses.json',
        'ai/property-daily-aggregates.csv',
        'ai/property-daily-aggregates.json',
        'ai/property-trend-outcomes.csv',
        'ai/property-trend-outcomes.json',
      ]),
    )
  })

  it('is rejected if it ever tries to widen its own disclosure', async () => {
    const entries = buildAiExportEntries(payload())
    await expect(
      buildOrganizationExportBundle({
        organizationId: 'org-1',
        requestId: 'req-1',
        asOf: ASOF,
        contributors: ALL_CONTEXTS.map((context) =>
          context === 'ai'
            ? {
                context,
                contribute: async () => ({
                  context,
                  coverage: 'complete' as const,
                  omissionCodes: [],
                  entries: entries.map((entry, index) =>
                    index === 0
                      ? { ...entry, classification: 'tenant_visible' as const }
                      : entry,
                  ),
                }),
              }
            : {
                context,
                contribute: async () => ({
                  context,
                  coverage: 'no_data' as const,
                  omissionCodes: [],
                  entries: [],
                }),
              },
        ),
      }),
    ).rejects.toThrow(/classification is not permitted for ai/)
  })
})
