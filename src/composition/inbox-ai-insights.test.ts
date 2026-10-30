import { describe, expect, it } from 'vitest'
import { inboxReadyV3Of } from './inbox-ai-insights'

const AT = 1_793_000_000_000

describe('inboxReadyV3Of', () => {
  it('keeps what the Inbox draws and names the cited sentences as its own numbers', () => {
    const read = inboxReadyV3Of({
      analysisSequence: 7,
      sentiment: 'mixed',
      attention: 'high',
      urgentReason: 'safety',
      generatedAtEpochMillis: AT,
      mentions: [
        {
          mentionOrdinal: 0,
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'strong',
          thing: 'air conditioning',
          issue: 'not working',
          issueGroupId: 'a0000000-0000-4000-8000-000000000001',
          sentences: [2, 3],
          namesPerson: null,
          correction: null,
        },
        {
          mentionOrdinal: 1,
          topic: 'staff_service',
          polarity: 'positive',
          strength: 'mild',
          thing: null,
          issue: null,
          issueGroupId: null,
          sentences: [1],
          namesPerson: 'team_member',
          correction: { kind: 'remove_topic', correctedAtEpochMillis: AT },
        },
      ],
    })

    expect(read).toEqual({
      status: 'ready_v3',
      analysisSequence: 7,
      sentiment: 'mixed',
      attention: 'high',
      urgentReason: 'safety',
      generatedAtEpochMillis: AT,
      mentions: [
        {
          mentionOrdinal: 0,
          topic: 'facilities_equipment',
          polarity: 'negative',
          strength: 'strong',
          thing: 'air conditioning',
          issue: 'not working',
          issueGroupId: 'a0000000-0000-4000-8000-000000000001',
          sentenceNumbers: [2, 3],
          namesPerson: null,
          correction: null,
        },
        {
          mentionOrdinal: 1,
          topic: 'staff_service',
          polarity: 'positive',
          strength: 'mild',
          thing: null,
          issue: null,
          issueGroupId: null,
          sentenceNumbers: [1],
          namesPerson: 'team_member',
          correction: { kind: 'remove_topic', correctedAtEpochMillis: AT },
        },
      ],
    })
  })

  it('passes a reading that names nothing on as one', () => {
    expect(
      inboxReadyV3Of({
        analysisSequence: 1,
        sentiment: 'neutral',
        attention: 'low',
        urgentReason: null,
        generatedAtEpochMillis: AT,
        mentions: [],
      }).mentions,
    ).toEqual([])
  })
})
