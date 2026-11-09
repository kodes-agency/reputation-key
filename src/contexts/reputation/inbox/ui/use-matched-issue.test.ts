import { describe, expect, it } from 'vitest'
import { matchedIssueOf } from './use-matched-issue'

const ISSUE = 'a0000000-0000-4000-8000-000000000001'

describe('matchedIssueOf', () => {
  it('reads the issue and the polarity a Guest voice link names', () => {
    expect(matchedIssueOf({ issue: ISSUE, polarity: 'negative' })).toEqual({
      issueId: ISSUE,
      polarity: 'negative',
    })
  })

  it('reads an issue with no polarity', () => {
    expect(matchedIssueOf({ issue: ISSUE })).toEqual({
      issueId: ISSUE,
      polarity: undefined,
    })
  })

  it('is no issue for an address without one, whatever else it holds', () => {
    expect(matchedIssueOf({ polarity: 'negative' })).toBeNull()
    expect(matchedIssueOf({ aspect: 'room', queue: 'reply' })).toBeNull()
    expect(matchedIssueOf({})).toBeNull()
  })

  it('is no issue for a value that is not an id, and keeps a polarity it does read', () => {
    expect(matchedIssueOf({ issue: 'air-conditioning', polarity: 'negative' })).toBeNull()
    expect(matchedIssueOf({ issue: ISSUE, polarity: 'angry' })).toEqual({
      issueId: ISSUE,
      polarity: undefined,
    })
  })

  it('is no issue for no address at all', () => {
    expect(matchedIssueOf(undefined)).toBeNull()
    expect(matchedIssueOf(null)).toBeNull()
  })
})
