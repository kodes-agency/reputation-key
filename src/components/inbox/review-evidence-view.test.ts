import { describe, expect, it } from 'vitest'
import type { InboxMentionV3 } from '#/contexts/inbox/application/public-api'
import type { ReadyAnalysisV3 } from './review-cause-view'
import { evidenceSegments, reviewEvidenceOf } from './review-evidence-view'

const AC = 'a0000000-0000-4000-8000-000000000001'
const SHOWER = 'a0000000-0000-4000-8000-000000000002'
const AT = 1_793_000_000_000

function mention(over: Partial<InboxMentionV3> = {}): InboxMentionV3 {
  return {
    mentionOrdinal: 0,
    topic: 'facilities_equipment',
    polarity: 'negative',
    strength: 'clear',
    thing: 'air conditioning',
    issue: 'not working',
    issueGroupId: AC,
    sentenceNumbers: [2],
    namesPerson: null,
    correction: null,
    ...over,
  }
}

describe('reviewEvidenceOf', () => {
  const ready: ReadyAnalysisV3 = {
    status: 'ready_v3',
    analysisSequence: 4,
    sentiment: 'negative',
    attention: 'high',
    urgentReason: null,
    mentions: [
      mention({ mentionOrdinal: 0 }),
      mention({ mentionOrdinal: 1, issueGroupId: SHOWER }),
    ],
    generatedAtEpochMillis: AT,
  }

  it('carries the words, the mentions and the ones an address was about', () => {
    const evidence = reviewEvidenceOf(ready, 'The air conditioning broke.', {
      issueId: AC,
    })

    expect(evidence?.original).toBe('The air conditioning broke.')
    expect(evidence?.mentions).toHaveLength(2)
    expect([...(evidence?.matched ?? [])]).toEqual([0])
  })

  it('is none without a v3 reading', () => {
    expect(reviewEvidenceOf(null, 'Words.', null)).toBeNull()
    expect(reviewEvidenceOf({ status: 'none' }, 'Words.', null)).toBeNull()
    expect(reviewEvidenceOf({ status: 'disabled' }, 'Words.', null)).toBeNull()
  })

  it('is none without words to underline', () => {
    expect(reviewEvidenceOf(ready, null, null)).toBeNull()
    expect(reviewEvidenceOf(ready, undefined, null)).toBeNull()
    expect(reviewEvidenceOf(ready, '  \n ', null)).toBeNull()
  })
})

describe('evidenceSegments', () => {
  const TEXT =
    'Lovely room. The air conditioning broke!\nNobody came to fix it. Breakfast was fine.'

  it('cuts the words at the sentences a mention cites, and leaves the rest plain', () => {
    const segments = evidenceSegments(
      TEXT,
      [mention({ sentenceNumbers: [2, 3] })],
      new Set([0]),
    )

    expect(segments.map((segment) => [segment.text, segment.cited])).toEqual([
      ['Lovely room. ', null],
      ['The air conditioning broke!', { sense: 'complaint', matched: true }],
      ['\n', null],
      ['Nobody came to fix it.', { sense: 'complaint', matched: true }],
      [' Breakfast was fine.', null],
    ])
    expect(segments.map((segment) => segment.text).join('')).toBe(TEXT)
  })

  it('gives a sentence two mentions cite the stronger sense', () => {
    const segments = evidenceSegments(
      TEXT,
      [
        mention({ mentionOrdinal: 0, polarity: 'positive', sentenceNumbers: [1] }),
        mention({ mentionOrdinal: 1, sentenceNumbers: [1, 2] }),
      ],
      new Set(),
    )

    expect(
      segments.filter((segment) => segment.cited !== null).map((s) => s.cited?.sense),
    ).toEqual(['complaint', 'complaint'])
  })

  it('marks as matched only the sentences of the mention a link was about', () => {
    const segments = evidenceSegments(
      TEXT,
      [
        mention({ mentionOrdinal: 0, sentenceNumbers: [2] }),
        mention({ mentionOrdinal: 1, polarity: 'positive', sentenceNumbers: [4] }),
      ],
      new Set([1]),
    )

    expect(
      segments
        .filter((segment) => segment.cited !== null)
        .map((s) => [s.text, s.cited?.matched]),
    ).toEqual([
      ['The air conditioning broke!', false],
      ['Breakfast was fine.', true],
    ])
  })

  it('underlines nothing a manager set aside', () => {
    const segments = evidenceSegments(
      TEXT,
      [
        mention({
          sentenceNumbers: [2],
          correction: { kind: 'remove_topic', correctedAtEpochMillis: AT },
        }),
      ],
      new Set(),
    )

    expect(segments).toEqual([{ text: TEXT, cited: null }])
  })

  it('underlines nothing a changed review no longer has', () => {
    const segments = evidenceSegments(
      'Short now.',
      [mention({ sentenceNumbers: [3] })],
      new Set(),
    )

    expect(segments).toEqual([{ text: 'Short now.', cited: null }])
  })

  it('cites a remark in the plain-remark sense after “not a problem”', () => {
    const segments = evidenceSegments(
      TEXT,
      [
        mention({
          sentenceNumbers: [2],
          correction: { kind: 'not_a_problem', correctedAtEpochMillis: AT },
        }),
      ],
      new Set(),
    )

    expect(segments.find((segment) => segment.cited !== null)?.cited?.sense).toBe(
      'neutral',
    )
  })
})
