import { describe, expect, it } from 'vitest'
import { causeCounts } from './guest-voice-v2-causes'
import { tallyIssues } from './guest-voice-v2-tally'
import { issueAnswerName, issueDisplayTitle, issueTitles } from './guest-voice-v2-titles'
import {
  ISSUE,
  OTHER,
  group,
  groups,
  mention,
  review,
} from './guest-voice-v2.test-fixtures'

describe('issue titles', () => {
  it('counts causes once per review, respects manager names, keeps polarity titles separate', () => {
    const tallies = tallyIssues([
      review(1, {
        mentions: [
          mention(),
          mention(),
          mention({ polarity: 'positive', cause: 'comfortable' }),
        ],
      }),
      review(2, { mentions: [mention({ cause: 'worn furniture' })] }),
    ])
    const complaint = tallies.get(`${ISSUE}:complaint`)!
    expect(causeCounts(complaint)).toEqual([
      { cause: 'musty smell', reviewCount: 1 },
      { cause: 'worn furniture', reviewCount: 1 },
    ])
    expect(issueDisplayTitle(group, complaint)).toBe('Room — musty smell')
    expect(issueDisplayTitle({ ...group, displayName: 'Our ROOM' }, complaint)).toBe(
      'Our ROOM',
    )
    expect(issueDisplayTitle({ ...group, displayName: ' ' }, complaint)).toBe(
      'Room — musty smell',
    )
    expect(issueAnswerName(group, complaint)).toBe('Cleanliness')
    expect(issueDisplayTitle(group, tallies.get(`${ISSUE}:praise`)!)).toBe(
      'Room — comfortable',
    )
  })
  it('disambiguates automatic titles and never alters duplicate manager renames', () => {
    const tallies = [
      ...tallyIssues([
        review(1),
        review(2, { mentions: [mention({ issueGroupId: OTHER })] }),
      ]).values(),
    ]
    const titles = issueTitles(tallies, groups)
    expect([...titles]).toEqual([
      [ISSUE, 'Room — musty smell (Cleanliness) · 00000001'],
      [OTHER, 'Room — musty smell (Cleanliness) · 00000002'],
    ])
    expect([
      ...issueTitles(
        tallies,
        new Map([...groups].map(([id, g]) => [id, { ...g, displayName: 'Same' }])),
      ).values(),
    ]).toEqual(['Same', 'Same'])
  })
})

it('uses topic labels before id suffixes, independent of tally order', () => {
  const third = 'a0000000-0000-4000-8000-000000000003'
  const crossTopic = new Map([
    ...groups,
    [third, { ...group, id: third, topic: 'facilities_equipment' as const }],
  ])
  const tallies = [
    ...tallyIssues([
      review(1),
      review(2, { mentions: [mention({ issueGroupId: OTHER })] }),
      review(3, {
        mentions: [mention({ issueGroupId: third, topic: 'facilities_equipment' })],
      }),
    ]).values(),
  ]
  const expected = new Map([
    [ISSUE, 'Room — musty smell (Cleanliness) · 00000001'],
    [OTHER, 'Room — musty smell (Cleanliness) · 00000002'],
    [third, 'Room — musty smell (Facilities and equipment)'],
  ])
  expect(issueTitles(tallies, crossTopic)).toEqual(expected)
  expect(issueTitles([...tallies].reverse(), crossTopic)).toEqual(expected)
})
