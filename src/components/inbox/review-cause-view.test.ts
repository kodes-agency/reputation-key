import { describe, expect, it } from 'vitest'
import type { InboxMentionV3 } from '#/contexts/inbox/application/public-api'
import {
  causeLine,
  causeWords,
  chipSentence,
  correctionWord,
  effectiveCause,
  isRemoved,
  matchedLine,
  matchedMentionOrdinals,
  senseOfMention,
} from './review-cause-view'

const AC = 'a0000000-0000-4000-8000-000000000001'
const SHOWER = 'a0000000-0000-4000-8000-000000000002'

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

const AT = 1_793_000_000_000

describe('senseOfMention', () => {
  it('reads the way the AI pointed', () => {
    expect(senseOfMention(mention())).toBe('complaint')
    expect(senseOfMention(mention({ polarity: 'positive' }))).toBe('praise')
    expect(senseOfMention(mention({ polarity: 'neutral' }))).toBe('neutral')
  })

  it('counts a complaint a manager called no problem as a remark', () => {
    expect(
      senseOfMention(
        mention({ correction: { kind: 'not_a_problem', correctedAtEpochMillis: AT } }),
      ),
    ).toBe('neutral')
  })
})

describe('causeWords', () => {
  it('names the thing and what was wrong with it', () => {
    expect(causeWords(mention())).toEqual({
      title: 'Air conditioning',
      detail: 'not working',
    })
  })

  it('names the topic when the guest named no thing', () => {
    expect(
      causeWords(mention({ thing: null, issue: null, topic: 'staff_service' })),
    ).toEqual({
      title: 'Staff and service',
      detail: null,
    })
  })

  it('says the manager’s cause once they changed it', () => {
    const changed = mention({
      correction: {
        kind: 'change_cause',
        thing: 'heating',
        issue: 'too hot',
        correctedAtEpochMillis: AT,
      },
    })

    expect(effectiveCause(changed)).toEqual({ thing: 'heating', issue: 'too hot' })
    expect(causeWords(changed)).toEqual({ title: 'Heating', detail: 'too hot' })
  })
})

describe('chipSentence', () => {
  it('reads as one line with the way the review feels', () => {
    expect(chipSentence(mention())).toBe('Air conditioning, not working · Complaint')
    expect(
      chipSentence(mention({ thing: null, issue: null, polarity: 'positive' })),
    ).toBe('Facilities and equipment · Praise')
  })
})

describe('causeLine', () => {
  it('is the cause without the way the review feels', () => {
    expect(causeLine(mention())).toBe('Air conditioning, not working')
    expect(causeLine(mention({ thing: 'lift', issue: null }))).toBe('Lift')
  })
})

describe('correctionWord', () => {
  it('says what a manager did, and nothing for a mention left as read', () => {
    expect(correctionWord(mention())).toBeNull()
    expect(
      correctionWord(
        mention({ correction: { kind: 'remove_topic', correctedAtEpochMillis: AT } }),
      ),
    ).toBe('Removed')
    expect(
      correctionWord(
        mention({ correction: { kind: 'not_a_problem', correctedAtEpochMillis: AT } }),
      ),
    ).toBe('Not a problem')
    expect(
      correctionWord(
        mention({
          correction: {
            kind: 'change_cause',
            thing: 'heating',
            issue: 'too hot',
            correctedAtEpochMillis: AT,
          },
        }),
      ),
    ).toBe('Cause changed')
  })
})

describe('isRemoved', () => {
  it('is true only for a topic set aside', () => {
    expect(isRemoved(mention())).toBe(false)
    expect(
      isRemoved(
        mention({ correction: { kind: 'remove_topic', correctedAtEpochMillis: AT } }),
      ),
    ).toBe(true)
    expect(
      isRemoved(
        mention({ correction: { kind: 'not_a_problem', correctedAtEpochMillis: AT } }),
      ),
    ).toBe(false)
  })
})

describe('matchedMentionOrdinals', () => {
  const mentions = [
    mention({ mentionOrdinal: 0 }),
    mention({ mentionOrdinal: 1, polarity: 'positive' }),
    mention({ mentionOrdinal: 2, issueGroupId: SHOWER }),
    mention({
      mentionOrdinal: 3,
      correction: { kind: 'remove_topic', correctedAtEpochMillis: AT },
    }),
    mention({
      mentionOrdinal: 4,
      correction: { kind: 'not_a_problem', correctedAtEpochMillis: AT },
    }),
  ]

  it('is none for a link that named no issue', () => {
    expect([...matchedMentionOrdinals(mentions, null)]).toEqual([])
  })

  it('takes the mentions of the issue, in the way the link counted them', () => {
    expect([...matchedMentionOrdinals(mentions, { issueId: AC })]).toEqual([0, 1, 4])
    expect([
      ...matchedMentionOrdinals(mentions, { issueId: AC, polarity: 'negative' }),
    ]).toEqual([0])
    expect([
      ...matchedMentionOrdinals(mentions, { issueId: AC, polarity: 'positive' }),
    ]).toEqual([1])
    expect([
      ...matchedMentionOrdinals(mentions, { issueId: AC, polarity: 'neutral' }),
    ]).toEqual([4])
  })

  it('never matches a topic a manager set aside', () => {
    expect([...matchedMentionOrdinals(mentions, { issueId: AC })]).not.toContain(3)
  })
})

describe('matchedLine', () => {
  const mentions = [
    mention({ mentionOrdinal: 0 }),
    mention({ mentionOrdinal: 1, thing: 'shower', issue: 'cold' }),
    mention({ mentionOrdinal: 2 }),
  ]

  it('names the causes the address was about, each once', () => {
    expect(matchedLine(mentions, new Set([0, 2]))).toBe(
      'Matched: Air conditioning, not working',
    )
    expect(matchedLine(mentions, new Set([0, 1]))).toBe(
      'Matched: Air conditioning, not working; Shower, cold',
    )
  })

  it('says nothing when this review holds none of it', () => {
    expect(matchedLine(mentions, new Set())).toBeNull()
  })
})
