import { expect, it } from 'vitest'
import type { GuestVoiceBuildInput } from './guest-voice-v2-build'
import type { GuestVoiceMention, GuestVoiceReview } from './guest-voice-v2-facts'
import { buildGuestVoiceDetail } from './guest-voice-v2-details'
const mention = (cause: string): GuestVoiceMention => ({
  mentionOrdinal: 0,
  topic: 'cleanliness',
  polarity: 'negative',
  strength: 'clear',
  thing: 'room',
  cause,
  issueGroupId: 'room',
  namesPerson: null,
})
const review: GuestVoiceReview = {
  reviewId: 'review',
  sourceEpoch: 1,
  sourceRevision: 1,
  analysisSequence: 1,
  localDate: '2026-10-01',
  rating: 2,
  urgentReason: null,
  namesAPerson: false,
  mentions: [mention('musty smell'), mention('worn linen'), mention('musty smell')],
}
it('keeps the manager issue title on each row while preserving distinct, unique-per-review causes', () => {
  const build: GuestVoiceBuildInput = {
    propertyId: 'property',
    window: '30d',
    startLocalDate: '2026-09-02',
    endLocalDate: '2026-10-01',
    provisional: false,
    groups: new Map([
      [
        'room',
        {
          id: 'room',
          topic: 'cleanliness',
          canonicalThing: 'room',
          displayName: 'Our ROOM',
          hidden: false,
        },
      ],
    ]),
    current: [review],
    baseline: [],
    currentPopulation: [],
    population: { textReviews: 1, stars: [0, 1, 0, 0, 0] },
  }
  const draft = buildGuestVoiceDetail({
    build,
    history: [review],
    historyStartLocalDate: build.startLocalDate,
    target: { kind: 'topic', topic: 'cleanliness' },
  })
  if (draft?.read.drawer.kind !== 'topic') throw new Error('Expected a topic drawer')
  expect(draft.read.drawer.dislikedCauses).toEqual([
    { issueId: 'room', title: 'Our ROOM', cause: 'musty smell', reviewCount: 1 },
    { issueId: 'room', title: 'Our ROOM', cause: 'worn linen', reviewCount: 1 },
  ])
})
