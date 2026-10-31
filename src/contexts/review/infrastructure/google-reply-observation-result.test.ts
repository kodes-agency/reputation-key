import { describe, expect, it } from 'vitest'
import { resultFromRow } from './google-reply-observation-result'

describe('observation result projection', () => {
  it('returns the identifier-only replay result without observed text or digest', () => {
    const row = {
      observationRevision: 7,
      change: 'unchanged',
      resolution: 'unattributed',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      observedText: 'PRIVATE GOOGLE TEXT',
    }
    expect(resultFromRow(row, true)).toEqual({
      observationRevision: 7,
      change: 'unchanged',
      resolution: 'unattributed',
      matchedReplyId: null,
      matchedPublicationCycle: null,
      duplicate: true,
    })
  })
})
