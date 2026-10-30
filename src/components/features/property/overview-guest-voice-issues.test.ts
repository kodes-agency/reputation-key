import { describe, expect, it } from 'vitest'
import { LARGE_READ } from './guest-voice/guest-voice-fixtures-large'
import { RAILING_ISSUE, URGENT_READ } from './guest-voice/guest-voice-fixtures-states'
import { overviewIssueCountText, overviewTopIssues } from './overview-guest-voice-issues'

describe('Overview Guest voice row', () => {
  it('names the first problem to fix, the first thing guests love and the page’s first line', () => {
    const top = overviewTopIssues(LARGE_READ)

    expect(top.complaint).toBe(LARGE_READ.fixFirst[0])
    expect(top.praise).toBe(LARGE_READ.guestsLove[0])
    expect(top.sentence).toBe(LARGE_READ.inShort[0]?.text)
    expect(top.complaint).not.toBeNull()
    expect(top.praise).not.toBeNull()
    expect(top.sentence).not.toBeNull()
  })

  it('names an Urgent issue before the first problem to fix', () => {
    expect(overviewTopIssues(URGENT_READ).complaint).toBe(RAILING_ISSUE)
  })

  it('names nothing where the page has nothing, and never throws', () => {
    expect(
      overviewTopIssues({
        ...LARGE_READ,
        urgent: [],
        fixFirst: [],
        guestsLove: [],
        inShort: [],
      }),
    ).toEqual({ complaint: null, praise: null, sentence: null })
  })

  it('counts reviews with text, in the singular for one', () => {
    const statistics = { shareText: '9 of 128', textReviewCount: 128 }
    expect(
      overviewIssueCountText({ issueId: 'a', title: 'Cleanliness', statistics }),
    ).toBe('Cleanliness, 9 of 128 reviews')
    expect(
      overviewIssueCountText({
        issueId: 'a',
        title: 'Staff',
        statistics: { shareText: '1 of 1', textReviewCount: 1 },
      }),
    ).toBe('Staff, 1 of 1 review')
  })
})
