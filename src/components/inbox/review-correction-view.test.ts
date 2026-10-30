import { describe, expect, it } from 'vitest'
import type { InboxMentionV3 } from '#/contexts/inbox/application/public-api'
import {
  causeFormLabels,
  correctionRows,
  mayBeNoProblem,
  outcomeOf,
  topicOfRow,
} from './review-correction-view'

const AT = 1_793_000_000_000

function mention(over: Partial<InboxMentionV3> = {}): InboxMentionV3 {
  return {
    mentionOrdinal: 0,
    topic: 'facilities_equipment',
    polarity: 'negative',
    strength: 'clear',
    thing: 'air conditioning',
    issue: 'not working',
    issueGroupId: 'a0000000-0000-4000-8000-000000000001',
    sentenceNumbers: [2],
    namesPerson: null,
    correction: null,
    ...over,
  }
}

const removed = { kind: 'remove_topic', correctedAtEpochMillis: AT } as const

describe('correctionRows', () => {
  it('lists every reading in the order the answer gave them', () => {
    const rows = correctionRows([
      mention({ mentionOrdinal: 0 }),
      mention({ mentionOrdinal: 1, topic: 'staff_service' }),
    ])

    expect(rows.map((row) => [row.kind, row.mention.mentionOrdinal])).toEqual([
      ['reading', 0],
      ['reading', 1],
    ])
  })

  it('lists a removed topic once, however many mentions it held', () => {
    const rows = correctionRows([
      mention({ mentionOrdinal: 0, correction: removed }),
      mention({ mentionOrdinal: 1, topic: 'staff_service' }),
      mention({ mentionOrdinal: 2, correction: removed }),
    ])

    expect(rows.map((row) => [row.kind, row.mention.mentionOrdinal])).toEqual([
      ['removed_topic', 0],
      ['reading', 1],
    ])
  })

  it('lists two removed topics as two lines', () => {
    const rows = correctionRows([
      mention({ mentionOrdinal: 0, correction: removed }),
      mention({ mentionOrdinal: 1, topic: 'staff_service', correction: removed }),
    ])

    expect(rows.map((row) => topicOfRow(row))).toEqual([
      'Facilities and equipment',
      'Staff and service',
    ])
  })

  it('lists nothing for a review with no mentions', () => {
    expect(correctionRows([])).toEqual([])
  })
})

describe('mayBeNoProblem', () => {
  it('is true for a complaint and for nothing else', () => {
    expect(mayBeNoProblem(mention())).toBe(true)
    expect(mayBeNoProblem(mention({ polarity: 'positive' }))).toBe(false)
    expect(mayBeNoProblem(mention({ polarity: 'neutral' }))).toBe(false)
  })

  it('is false once it has been called no problem', () => {
    expect(
      mayBeNoProblem(
        mention({ correction: { kind: 'not_a_problem', correctedAtEpochMillis: AT } }),
      ),
    ).toBe(false)
  })
})

describe('causeFormLabels', () => {
  it('asks what was wrong of a complaint and what was good of praise', () => {
    expect(causeFormLabels(mention()).said).toBe('What was wrong')
    expect(causeFormLabels(mention({ polarity: 'positive' })).said).toBe('What was good')
    expect(causeFormLabels(mention({ polarity: 'neutral' })).said).toBe('What was said')
  })

  it('asks about a complaint called no problem as a remark', () => {
    expect(
      causeFormLabels(
        mention({ correction: { kind: 'not_a_problem', correctedAtEpochMillis: AT } }),
      ).said,
    ).toBe('What was said')
  })
})

describe('outcomeOf', () => {
  it('is done for a correction made or given back', () => {
    expect(
      outcomeOf({ status: 'applied', mentionOrdinals: [1] }, { kind: 'remove_topic' }),
    ).toEqual({ kind: 'done' })
    expect(
      outcomeOf({ status: 'cleared', mentionOrdinals: [1] }, { kind: 'undo' }),
    ).toEqual({ kind: 'done' })
  })

  it('says a review read again since is another reading', () => {
    const outcome = outcomeOf({ status: 'not_found' }, { kind: 'remove_topic' })

    expect(outcome).toMatchObject({ kind: 'refused' })
    expect(outcome.kind === 'refused' && outcome.sentence).toContain('read again')
  })

  it('says there is nothing to undo, not that the review changed', () => {
    const outcome = outcomeOf({ status: 'not_found' }, { kind: 'undo' })

    expect(outcome.kind === 'refused' && outcome.sentence).toBe(
      'There is nothing to undo here any more.',
    )
  })

  it.each([
    ['not_applicable', 'Only a complaint'],
    ['invalid_cause', 'one to three English words'],
    ['disabled', 'switched off'],
  ] as const)('refuses %s in words', (status, words) => {
    const outcome = outcomeOf(
      { status },
      { kind: 'change_cause', thing: null, issue: null },
    )

    expect(outcome.kind === 'refused' && outcome.sentence).toContain(words)
  })
})
