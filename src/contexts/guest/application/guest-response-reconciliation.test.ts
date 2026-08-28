import { describe, expect, it } from 'vitest'
import {
  GUEST_RESPONSE_RECONCILIATION_REASON_CODES,
  buildGuestResponseReconciliationReport,
  canonicalGuestResponseReconciliationReport,
  classifyGuestResponseFactEvidence,
  type GuestResponseReconciliationFactIdentity,
  type GuestResponseReconciliationRow,
} from './guest-response-reconciliation'

const OBSERVED_AT = new Date('2026-08-27T12:00:00.000Z')

const rows: readonly GuestResponseReconciliationRow[] = [
  {
    source: 'guest_response',
    sourceId: 'a0000000-0000-4000-8000-000000000003',
    dimension: 'rating_lineage',
    outcome: 'exact',
    organizationId: 'org-a',
    propertyId: 'a0000000-0000-4000-8000-000000000001',
    portalId: 'a0000000-0000-4000-8000-000000000002',
    reasonCode: 'canonical_rating_lineage_exact',
    relatedIds: ['a0000000-0000-4000-8000-000000000004'],
  },
  {
    source: 'legacy_feedback',
    sourceId: 'b0000000-0000-4000-8000-000000000003',
    dimension: 'legacy_relationship',
    outcome: 'orphan',
    organizationId: 'org-b',
    propertyId: 'b0000000-0000-4000-8000-000000000001',
    portalId: 'b0000000-0000-4000-8000-000000000002',
    reasonCode: 'legacy_feedback_without_rating',
    relatedIds: [],
  },
]

const facts: readonly GuestResponseReconciliationFactIdentity[] = [
  {
    kind: 'rating_submitted',
    eventId: 'a0000000-0000-4000-8000-000000000004',
    organizationId: 'org-a',
    propertyId: 'a0000000-0000-4000-8000-000000000001',
    portalId: 'a0000000-0000-4000-8000-000000000002',
    responseId: 'a0000000-0000-4000-8000-000000000003',
    supersedesSourceEventId: null,
    star: 4,
    responseRevision: null,
  },
  {
    kind: 'feedback_retracted',
    eventId: 'a0000000-0000-4000-8000-000000000006',
    organizationId: 'org-a',
    propertyId: 'a0000000-0000-4000-8000-000000000001',
    portalId: 'a0000000-0000-4000-8000-000000000002',
    responseId: 'a0000000-0000-4000-8000-000000000003',
    supersedesSourceEventId: 'a0000000-0000-4000-8000-000000000005',
    star: null,
    responseRevision: 1,
  },
]

const distributions = {
  legacyRatings: { one: 0, two: 0, three: 0, four: 1, five: 1, total: 2 },
  canonicalRetainedRatings: {
    one: 0,
    two: 0,
    three: 0,
    four: 1,
    five: 0,
    total: 1,
  },
  canonicalEffectiveRatings: {
    one: 0,
    two: 0,
    three: 0,
    four: 1,
    five: 0,
    total: 1,
  },
  durableRatingFactHeads: {
    one: 0,
    two: 0,
    three: 0,
    four: 1,
    five: 0,
    total: 1,
  },
} as const

describe('Guest Response reconciliation report', () => {
  it('is byte-stable for the same explicit observation time and scope', () => {
    const first = buildGuestResponseReconciliationReport({
      observedAt: OBSERVED_AT,
      organizationIds: ['org-b', 'org-a', 'org-a'],
      rows,
      facts,
      ratingDistributions: distributions,
    })
    const second = buildGuestResponseReconciliationReport({
      observedAt: OBSERVED_AT,
      organizationIds: ['org-a', 'org-b'],
      rows: [rows[1]!, rows[0]!],
      facts: [facts[1]!, facts[0]!],
      ratingDistributions: distributions,
    })

    expect(second).toEqual(first)
    expect(canonicalGuestResponseReconciliationReport(second)).toBe(
      canonicalGuestResponseReconciliationReport(first),
    )
    expect(first.ready).toBe(false)
    expect(first.counts).toMatchObject({ exact: 1, orphan: 1, total: 2 })
    expect(first.counts.byReason.legacy_feedback_without_rating).toBe(1)
    expect(Object.keys(first.counts.byReason)).toEqual([
      ...GUEST_RESPONSE_RECONCILIATION_REASON_CODES,
    ])
    expect(first.facts.map((fact) => fact.eventId)).toEqual([
      'a0000000-0000-4000-8000-000000000004',
      'a0000000-0000-4000-8000-000000000006',
    ])
    expect(first.fingerprintSha256).toMatch(/^[a-f0-9]{64}$/)
  })

  it('rejects duplicate observations instead of hiding ambiguous evidence', () => {
    expect(() =>
      buildGuestResponseReconciliationReport({
        observedAt: OBSERVED_AT,
        rows: [rows[0]!, rows[0]!],
        facts,
        ratingDistributions: distributions,
      }),
    ).toThrow(/duplicate Guest Response reconciliation row/i)

    expect(() =>
      buildGuestResponseReconciliationReport({
        observedAt: OBSERVED_AT,
        rows,
        facts: [facts[0]!, facts[0]!],
        ratingDistributions: distributions,
      }),
    ).toThrow(/duplicate Guest Response fact identity/i)
  })

  it('rejects content-shaped values and inconsistent fact metadata', () => {
    expect(() =>
      buildGuestResponseReconciliationReport({
        observedAt: OBSERVED_AT,
        rows: [{ ...rows[0]!, relatedIds: ['https://private.invalid/path'] }],
        facts,
        ratingDistributions: distributions,
      }),
    ).toThrow(/identifier-only/i)

    expect(() =>
      buildGuestResponseReconciliationReport({
        observedAt: OBSERVED_AT,
        rows,
        facts: [{ ...facts[0]!, star: null }],
        ratingDistributions: distributions,
      }),
    ).toThrow(/rating fact star/i)
  })

  it('rejects invalid observation times and inconsistent star totals', () => {
    expect(() =>
      buildGuestResponseReconciliationReport({
        observedAt: new Date('invalid'),
        rows: [],
        facts: [],
        ratingDistributions: distributions,
      }),
    ).toThrow(/observation time/i)

    expect(() =>
      buildGuestResponseReconciliationReport({
        observedAt: OBSERVED_AT,
        rows: [],
        facts: [],
        ratingDistributions: {
          ...distributions,
          legacyRatings: { ...distributions.legacyRatings, total: 3 },
        },
      }),
    ).toThrow(/star distribution total/i)
  })

  it('cannot declare readiness when canonical effective ratings and durable heads differ', () => {
    const report = buildGuestResponseReconciliationReport({
      observedAt: OBSERVED_AT,
      rows: [rows[0]!],
      facts,
      ratingDistributions: {
        ...distributions,
        durableRatingFactHeads: {
          one: 0,
          two: 0,
          three: 0,
          four: 0,
          five: 1,
          total: 1,
        },
      },
    })

    expect(report.ready).toBe(false)
  })

  it('classifies each durable-fact evidence gap without inferring missing provenance', () => {
    const source = {
      kind: 'feedback_submitted',
      eventId: 'a0000000-0000-4000-8000-000000000010',
      organizationId: 'org-a',
      propertyId: 'a0000000-0000-4000-8000-000000000001',
      portalId: 'a0000000-0000-4000-8000-000000000002',
      responseId: 'a0000000-0000-4000-8000-000000000003',
      payloadValid: true,
      schemaVersionKnown: true,
      responseExists: true,
      scopeExact: true,
      sourceAggregateExact: true,
      businessTimeExact: true,
      staffAttribution: 'unknown',
      feedbackRevision: 'unknown',
    } as const

    expect(classifyGuestResponseFactEvidence(source)).toEqual([
      expect.objectContaining({
        source: 'durable_fact',
        outcome: 'unsafe',
        reasonCode: 'canonical_fact_staff_attribution_unknown',
      }),
      expect.objectContaining({
        source: 'durable_fact',
        outcome: 'unsafe',
        reasonCode: 'canonical_feedback_revision_unknown',
      }),
    ])
    expect(
      classifyGuestResponseFactEvidence({
        ...source,
        staffAttribution: 'exact',
        feedbackRevision: 'exact',
      }),
    ).toEqual([
      expect.objectContaining({
        outcome: 'exact',
        reasonCode: 'canonical_fact_evidence_exact',
      }),
    ])
  })
})
