import { describe, expect, it } from 'vitest'
import { guestVoiceTeamSummary } from './guest-voice-team-summary'
import { HAMPTON_READ } from './guest-voice-fixtures-check-in'

describe('manual team note', () => {
  it('copies fixed labels and unique topic counts, never issue sums or words', () => {
    const first = HAMPTON_READ.fixFirst[0]
    if (!first) throw new Error('Fixture needs a concern')
    const read = {
      ...HAMPTON_READ,
      fixFirst: [
        {
          ...first,
          title: 'PRIVATE RENAME',
          answerName: 'PERSON',
          causes: ['PRIVATE CAUSE'],
          quote: {
            inboxItemId: 'secret',
            reviewedAt: '2026-01-01',
            rating: 1 as const,
            text: 'PRIVATE GUEST TEXT',
            sentenceRanges: [],
          },
        },
        first,
      ],
      provisional: true,
    }
    const note = guestVoiceTeamSummary(read)
    const topic = read.everyTopic.find((row) => row.topic === first.topic)
    expect(note).toContain(`— ${topic?.complaintReviews} reviews`)
    expect(note.match(/What to work on:/gu)).toHaveLength(1)
    expect(note).toContain('Serious concerns reported: 2 groups in 5 reviews.')
    expect(note).toContain('Figures reflect the reviews analysed so far.')
    for (const forbidden of ['PRIVATE', 'PERSON', 'secret', 'http', '★'])
      expect(note).not.toContain(forbidden)
  })
  it('omits empty sections and uses singular totals', () => {
    const note = guestVoiceTeamSummary({
      ...HAMPTON_READ,
      guestsLove: [],
      fixFirst: [],
      seriousConcerns: { ...HAMPTON_READ.seriousConcerns, groupCount: 1, reviewCount: 1 },
    })
    expect(note).not.toContain('What guests praised:')
    expect(note).not.toContain('What to work on:')
    expect(note).toContain('1 group in 1 review.')
  })
})
