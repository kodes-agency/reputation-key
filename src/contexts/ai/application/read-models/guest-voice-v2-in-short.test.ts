import { expect, it } from 'vitest'
import { assembleGuestVoiceV2 } from './guest-voice-v2-build'
import { groups, input, mention, review } from './guest-voice-v2.test-fixtures'

it('uses the thing-only name in the page and Overview summary without repeating the cause', () => {
  const current = [review(1), review(2), review(3)]
  const read = assembleGuestVoiceV2(input(current)).read
  expect(read.fixFirst[0]?.title).toBe('Room — musty smell')
  expect(read.inShort[0]?.text).toBe(
    'Room is the top problem: 3 of 3 reviews, most often “musty smell”. Those reviews average 2.0★.',
  )
})
it('uses thing-only praise names and preserves manager names in summaries', () => {
  const current = [1, 2, 3].map((n) =>
    review(n, { mentions: [mention({ polarity: 'positive', cause: 'comfortable' })] }),
  )
  expect(assembleGuestVoiceV2(input(current)).read.inShort[0]?.text).toBe(
    'Room is what guests praise most: 3 of 3 reviews.',
  )
  const renamed = new Map(
    [...groups].map(([id, g]) => [id, { ...g, displayName: 'Our ROOM' }]),
  )
  expect(
    assembleGuestVoiceV2(input(current, { groups: renamed })).read.inShort[0]?.text,
  ).toBe('Our ROOM is what guests praise most: 3 of 3 reviews.')
})

it('keeps change summaries thing-only while ranked titles include the cause', () => {
  const current = Array.from({ length: 60 }, (_, n) => review(n + 1))
  const baseline = Array.from({ length: 60 }, (_, n) =>
    review(n + 61, { localDate: '2025-12-01', mentions: [] }),
  )
  const read = assembleGuestVoiceV2(input(current, { baseline })).read
  expect(read.whatChanged[0]?.title).toBe('Room — musty smell')
  expect(read.inShort.find((line) => line.kind === 'change')?.text).toBe(
    'Room complaints are rising: 60 of 60 reviews now, more often than in the 12 months before.',
  )
})
