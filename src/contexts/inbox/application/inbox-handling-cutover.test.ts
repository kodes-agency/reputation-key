import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  canonicalInboxHandlingCutoverReport,
  classifyInboxLegacyRelationship,
  type InboxLegacyRelationship,
  type InboxLegacyRelationshipInput,
} from './inbox-handling-cutover'

const ITEM_ID = '5b000000-0000-0000-0000-000000000001'
const ORG_ID = 'org-inbox-cutover'
const PROPERTY_ID = '5b000000-0000-0000-0000-000000000002'
const FEEDBACK_ID = '5b000000-0000-0000-0000-000000000003'
const REVIEW_ID = '5b000000-0000-0000-0000-000000000004'
const GENERATED_AT = new Date('2026-08-28T10:00:00.000Z')

/** An open, fully aligned private-feedback row: the `exact` baseline. */
function alignedFeedbackInput(
  overrides: Partial<InboxLegacyRelationshipInput> = {},
): InboxLegacyRelationshipInput {
  return {
    item: {
      id: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      sourceType: 'feedback',
      sourceId: FEEDBACK_ID,
      status: 'open',
      closedAt: null,
      snippet: null,
      reviewerName: null,
    },
    head: {
      inboxItemId: ITEM_ID,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      sourceType: 'feedback',
      sourceId: FEEDBACK_ID,
      currentCycleNumber: 1,
      currentSourceRevision: 1,
      stateRevision: 1,
      status: 'open',
    },
    cycles: [
      {
        inboxItemId: ITEM_ID,
        cycleNumber: 1,
        sourceType: 'feedback',
        sourceId: FEEDBACK_ID,
        sourceRevision: 1,
      },
    ],
    transitions: [
      {
        inboxItemId: ITEM_ID,
        cycleNumber: 1,
        stateRevision: 1,
        kind: 'opened',
        transitionReason: 'legacy_backfill',
      },
    ],
    outcomes: [],
    notes: [],
    sourceAnchors: [
      { sourceType: 'feedback', sourceId: FEEDBACK_ID, revision: 1, comment: null },
    ],
    responseTargetEligibility: 'measured',
    ...overrides,
  }
}

describe('classifyInboxLegacyRelationship', () => {
  it('classifies an aligned cycle-one row with a matching head as exact', () => {
    const result = classifyInboxLegacyRelationship(alignedFeedbackInput())

    expect(result.classification).toBe('exact')
    expect(result.reasonCode).toBe('head_matches_cycle_log')
    expect(result.cycleNumber).toBe(1)
    expect(result.sourceRevision).toBe(1)
    expect(result.stateRevision).toBe(1)
    expect(result.targetEligibility).toBe('measured')
    expect(result.performanceExcluded).toBe(false)
  })

  it('is not exact when the head source scope tuple differs from the item scope', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      head: { ...base.head!, organizationId: 'org-inbox-cutover-other' },
    })

    expect(result.classification).toBe('orphan')
    expect(result.reasonCode).toBe('head_source_scope_mismatch')
  })

  it('is not exact when the head revisions disagree with the append-only cycle log', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      head: { ...base.head!, currentSourceRevision: 7 },
    })

    expect(result.classification).toBe('ambiguous')
    expect(result.reasonCode).toBe('head_disagrees_with_cycle_log')
  })

  it('maps a single candidate anchor without a head, carrying no inferred outcome', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      head: null,
      cycles: [],
      transitions: [],
    })

    expect(result.classification).toBe('mappable')
    expect(result.reasonCode).toBe('single_source_anchor_without_head')
    expect(result.sourceRevision).toBe(1)
    expect(result.cycleNumber).toBeNull()
    expect(result.stateRevision).toBeNull()
    expect(Object.keys(result).sort()).toEqual([
      'classification',
      'cycleNumber',
      'inboxItemId',
      'organizationId',
      'performanceExcluded',
      'propertyId',
      'reasonCode',
      'sourceRevision',
      'stateRevision',
      'targetEligibility',
    ])
    expect(JSON.stringify(result)).not.toMatch(/outcome|deadline|on_time|handled/iu)
    expect(result.targetEligibility).toBe('legacy_unknown')
    expect(result.performanceExcluded).toBe(true)
  })

  it('reports a review candidate anchor by its source revision', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      item: { ...base.item, sourceType: 'review', sourceId: REVIEW_ID },
      head: null,
      cycles: [],
      transitions: [],
      sourceAnchors: [
        { sourceType: 'review', sourceId: REVIEW_ID, revision: 6, comment: null },
      ],
    })

    expect(result.classification).toBe('mappable')
    expect(result.sourceRevision).toBe(6)
  })

  it('treats several candidate anchors without a head as ambiguous', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      head: null,
      cycles: [],
      transitions: [],
      sourceAnchors: [
        { sourceType: 'feedback', sourceId: FEEDBACK_ID, revision: 1, comment: null },
        { sourceType: 'feedback', sourceId: FEEDBACK_ID, revision: 2, comment: null },
      ],
    })

    expect(result.classification).toBe('ambiguous')
    expect(result.reasonCode).toBe('multiple_source_anchors_without_head')
    expect(result.sourceRevision).toBeNull()
  })

  it('never reads an outcome or an on-time result out of a generic closedAt', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      item: {
        ...base.item,
        status: 'closed',
        closedAt: new Date('2026-03-04T12:00:00.000Z'),
      },
      head: { ...base.head!, stateRevision: 2, status: 'closed' },
      transitions: [
        ...base.transitions,
        {
          inboxItemId: ITEM_ID,
          cycleNumber: 1,
          stateRevision: 2,
          kind: 'closed',
          transitionReason: 'source_ineligible',
        },
      ],
      outcomes: [],
    })

    expect(result.classification).toBe('ambiguous')
    expect(result.reasonCode).toBe('closed_without_handling_evidence')
    expect(result.targetEligibility).toBe('legacy_unknown')
    expect(result.performanceExcluded).toBe(true)
  })

  it('keeps a closed row ambiguous when it carries no transition evidence at all', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      item: {
        ...base.item,
        status: 'closed',
        closedAt: new Date('2026-03-04T12:00:00.000Z'),
      },
      head: { ...base.head!, status: 'closed' },
      outcomes: [],
    })

    expect(result.classification).toBe('ambiguous')
    expect(result.reasonCode).toBe('closed_without_handling_evidence')
    expect(result.performanceExcluded).toBe(true)
  })

  it('accepts a confirmed-on-google closure as real evidence', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      item: {
        ...base.item,
        sourceType: 'review',
        sourceId: REVIEW_ID,
        status: 'closed',
        closedAt: new Date('2026-03-04T12:00:00.000Z'),
      },
      head: {
        ...base.head!,
        sourceType: 'review',
        sourceId: REVIEW_ID,
        stateRevision: 2,
        status: 'closed',
      },
      cycles: [
        {
          inboxItemId: ITEM_ID,
          cycleNumber: 1,
          sourceType: 'review',
          sourceId: REVIEW_ID,
          sourceRevision: 1,
        },
      ],
      transitions: [
        ...base.transitions,
        {
          inboxItemId: ITEM_ID,
          cycleNumber: 1,
          stateRevision: 2,
          kind: 'closed',
          transitionReason: 'confirmed_on_google',
        },
      ],
      sourceAnchors: [
        { sourceType: 'review', sourceId: REVIEW_ID, revision: 1, comment: null },
      ],
    })

    expect(result.classification).toBe('exact')
  })

  it('is ambiguous when the compatibility status mirror disagrees, and never repairs it', () => {
    const base = alignedFeedbackInput()
    const drifted: InboxLegacyRelationshipInput = {
      ...base,
      item: {
        ...base.item,
        status: 'closed',
        closedAt: new Date('2026-03-04T12:00:00.000Z'),
      },
      head: { ...base.head!, status: 'open' },
    }
    const before = structuredClone(drifted)

    const result = classifyInboxLegacyRelationship(drifted)

    expect(result.classification).toBe('ambiguous')
    expect(result.reasonCode).toBe('status_mirror_disagrees_with_head')
    expect(drifted).toEqual(before)
    expect(drifted.item.status).toBe('closed')
    expect(drifted.head?.status).toBe('open')
    expect(JSON.stringify(result)).not.toMatch(/"status"/u)
  })

  it('is an orphan when the source row is missing', () => {
    const result = classifyInboxLegacyRelationship(
      alignedFeedbackInput({ sourceAnchors: [] }),
    )

    expect(result.classification).toBe('orphan')
    expect(result.reasonCode).toBe('source_row_missing')
    expect(result.performanceExcluded).toBe(true)
  })

  it('is an orphan when the anchor points at a different source row', () => {
    const result = classifyInboxLegacyRelationship(
      alignedFeedbackInput({
        sourceAnchors: [
          {
            sourceType: 'feedback',
            sourceId: '5b000000-0000-0000-0000-0000000000ff',
            revision: 1,
            comment: null,
          },
        ],
      }),
    )

    expect(result.classification).toBe('orphan')
    expect(result.reasonCode).toBe('source_row_missing')
  })

  it('is an orphan when property_id is a non-UUID legacy text key', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      item: { ...base.item, propertyId: 'legacy-property-key-7' },
    })

    expect(result.classification).toBe('orphan')
    expect(result.reasonCode).toBe('legacy_property_key_not_uuid')
    expect(result.propertyId).toBe('legacy-property-key-7')
  })

  it('is an orphan when the head property scope does not equal the item property', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      head: { ...base.head!, propertyId: '5b000000-0000-0000-0000-0000000000aa' },
    })

    expect(result.classification).toBe('orphan')
    expect(result.reasonCode).toBe('head_property_scope_mismatch')
    expect(result.targetEligibility).toBe('legacy_unknown')
    expect(result.performanceExcluded).toBe(true)
  })

  it('refuses a measured target eligibility for anything but an exact row', () => {
    const base = alignedFeedbackInput()
    const result = classifyInboxLegacyRelationship({
      ...base,
      head: null,
      cycles: [],
      transitions: [],
      responseTargetEligibility: 'measured',
    })

    expect(result.targetEligibility).toBe('legacy_unknown')
    expect(result.performanceExcluded).toBe(true)
  })

  it('treats a missing target snapshot on an exact row as legacy-unknown', () => {
    const result = classifyInboxLegacyRelationship(
      alignedFeedbackInput({ responseTargetEligibility: null }),
    )

    expect(result.classification).toBe('exact')
    expect(result.targetEligibility).toBe('legacy_unknown')
    expect(result.performanceExcluded).toBe(true)
  })
})

function relationshipAt(
  inboxItemId: string,
  overrides: Partial<InboxLegacyRelationship> = {},
): InboxLegacyRelationship {
  return {
    inboxItemId,
    organizationId: ORG_ID,
    propertyId: PROPERTY_ID,
    classification: 'exact',
    reasonCode: 'head_matches_cycle_log',
    cycleNumber: 1,
    sourceRevision: 1,
    stateRevision: 1,
    targetEligibility: 'measured',
    performanceExcluded: false,
    ...overrides,
  }
}

const digestSha256 = (canonicalJson: string): string =>
  createHash('sha256').update(Buffer.from(canonicalJson, 'utf8')).digest('hex')

describe('canonicalInboxHandlingCutoverReport', () => {
  const relationships = [
    relationshipAt('5b000000-0000-0000-0000-0000000000c3'),
    relationshipAt('5b000000-0000-0000-0000-0000000000a1', {
      classification: 'ambiguous',
      reasonCode: 'closed_without_handling_evidence',
      targetEligibility: 'legacy_unknown',
      performanceExcluded: true,
    }),
    relationshipAt('5b000000-0000-0000-0000-0000000000b2', {
      classification: 'orphan',
      reasonCode: 'source_row_missing',
      cycleNumber: null,
      sourceRevision: null,
      stateRevision: null,
      targetEligibility: 'legacy_unknown',
      performanceExcluded: true,
    }),
  ]

  it('is byte-stable and sorts every collection deterministically', () => {
    const first = canonicalInboxHandlingCutoverReport({
      digestSha256,
      organizationId: ORG_ID,
      generatedAt: GENERATED_AT,
      relationships,
    })
    const shuffled = canonicalInboxHandlingCutoverReport({
      digestSha256,
      organizationId: ORG_ID,
      generatedAt: GENERATED_AT,
      relationships: [relationships[1]!, relationships[2]!, relationships[0]!],
    })

    expect(first.canonicalJson).toBe(shuffled.canonicalJson)
    expect(first.sha256).toBe(shuffled.sha256)
    expect(first.payload.items.map((item) => item.inboxItemId)).toEqual([
      '5b000000-0000-0000-0000-0000000000a1',
      '5b000000-0000-0000-0000-0000000000b2',
      '5b000000-0000-0000-0000-0000000000c3',
    ])
    expect(first.payload.reasonCounts.map((row) => row.reasonCode)).toEqual([
      'closed_without_handling_evidence',
      'head_matches_cycle_log',
      'source_row_missing',
    ])
    expect(first.payload.eligibilityCounts.map((row) => row.targetEligibility)).toEqual([
      'legacy_unknown',
      'measured',
    ])
    expect(first.payload.totals).toEqual({
      total: 3,
      exact: 1,
      mappable: 0,
      ambiguous: 1,
      orphan: 1,
    })
    expect(first.payload.performanceExcludedCount).toBe(2)
  })

  it('changes its SHA-256 fingerprint when any count changes', () => {
    const baseline = canonicalInboxHandlingCutoverReport({
      digestSha256,
      organizationId: ORG_ID,
      generatedAt: GENERATED_AT,
      relationships,
    })
    const withOneMore = canonicalInboxHandlingCutoverReport({
      digestSha256,
      organizationId: ORG_ID,
      generatedAt: GENERATED_AT,
      relationships: [
        ...relationships,
        relationshipAt('5b000000-0000-0000-0000-0000000000d4', {
          classification: 'mappable',
          reasonCode: 'single_source_anchor_without_head',
          cycleNumber: null,
          stateRevision: null,
          targetEligibility: 'legacy_unknown',
          performanceExcluded: true,
        }),
      ],
    })

    expect(withOneMore.payload.totals.mappable).toBe(1)
    expect(withOneMore.sha256).not.toBe(baseline.sha256)
  })

  it('rejects a duplicate Inbox Item so counts can never double', () => {
    expect(() =>
      canonicalInboxHandlingCutoverReport({
        digestSha256,
        organizationId: ORG_ID,
        generatedAt: GENERATED_AT,
        relationships: [relationships[0]!, relationshipAt(relationships[0]!.inboxItemId)],
      }),
    ).toThrow(/duplicate/iu)
  })

  it('carries no note text, feedback comment, reviewer name, snippet or handling note', () => {
    const markers = [
      'MARKER_NOTE_TEXT',
      'MARKER_FEEDBACK_COMMENT',
      'MARKER_REVIEWER_NAME',
      'MARKER_SNIPPET',
      'MARKER_INTERNAL_HANDLING_NOTE',
    ]
    const base = alignedFeedbackInput()
    const seeded = classifyInboxLegacyRelationship({
      ...base,
      item: {
        ...base.item,
        status: 'closed',
        closedAt: new Date('2026-03-04T12:00:00.000Z'),
        snippet: 'MARKER_SNIPPET',
        reviewerName: 'MARKER_REVIEWER_NAME',
      },
      head: { ...base.head!, status: 'closed' },
      outcomes: [
        {
          inboxItemId: ITEM_ID,
          cycleNumber: 1,
          outcomeRevision: 1,
          outcome: 'follow_up_completed',
          deadlineResult: 'on_time',
          internalNote: 'MARKER_INTERNAL_HANDLING_NOTE',
        },
      ],
      notes: [{ inboxItemId: ITEM_ID, text: 'MARKER_NOTE_TEXT' }],
      sourceAnchors: [
        {
          sourceType: 'feedback',
          sourceId: FEEDBACK_ID,
          revision: 1,
          comment: 'MARKER_FEEDBACK_COMMENT',
        },
      ],
    })

    const report = canonicalInboxHandlingCutoverReport({
      digestSha256,
      organizationId: ORG_ID,
      generatedAt: GENERATED_AT,
      relationships: [seeded],
    })

    const serialized = JSON.stringify(report.payload)
    for (const marker of markers) {
      expect(serialized).not.toContain(marker)
      expect(report.canonicalJson).not.toContain(marker)
    }
  })
})
