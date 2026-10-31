import { describe, expect, it } from 'vitest'
import { groupSeriousConcerns, seriousConcerns } from './guest-voice-v2-concerns'
import {
  ISSUE,
  OTHER,
  group,
  groups,
  mention,
  review,
} from './guest-voice-v2.test-fixtures'

describe('serious concern membership', () => {
  it('uses urgent members only, splits reasons, retains hidden issues and reason-only reports', () => {
    const current = [
      review(1, { urgentReason: 'health' }),
      review(2, { urgentReason: 'health', localDate: '2026-10-20' }),
      review(3, { urgentReason: 'safety' }),
      review(4, { urgentReason: 'health', mentions: [] }),
      review(5, { localDate: '2026-10-30' }),
    ]
    const concerns = seriousConcerns(
      groupSeriousConcerns(current, new Map([[ISSUE, { ...group, hidden: true }]])),
      false,
    )
    expect(concerns).toMatchObject({
      groupCount: 3,
      reviewCount: 4,
      remainingGroupCount: 0,
      coverage: 'complete',
    })
    expect(concerns.items[0]).toMatchObject({
      key: `issue:${ISSUE}:health`,
      reviewCount: 2,
      lastReportedLocalDate: '2026-10-20',
    })
    expect(concerns.items.find((c) => c.issueId === null)?.title).toBe(
      'Reported health concerns',
    )
  })
  it('chooses safety then strength then ordinal, ignores removed/non-surviving issues and keeps urgent flags', () => {
    const current = [
      review(1, {
        urgentReason: 'safety',
        mentions: [
          mention({ strength: 'strong' }),
          mention({
            topic: 'safety',
            issueGroupId: OTHER,
            strength: 'mild',
            mentionOrdinal: 1,
          }),
        ],
      }),
    ]
    expect(groupSeriousConcerns(current, groups)[0]?.item.issueId).toBe(OTHER)
    expect(groupSeriousConcerns(current, new Map())[0]?.item.key).toBe('other:safety')
    expect(
      groupSeriousConcerns(
        [
          review(2, {
            urgentReason: 'safety',
            mentions: [mention({ polarity: 'neutral' })],
          }),
        ],
        groups,
      )[0]?.item.issueId,
    ).toBeNull()
  })
  it('reports exact group/report overflow and provisional empty coverage', () => {
    const manyGroups = new Map(
      Array.from({ length: 12 }, (_, n) => [String(n), { ...group, id: String(n) }]),
    )
    const reviews = [...manyGroups.keys()].flatMap((id, n) => [
      review(n, { urgentReason: 'health', mentions: [mention({ issueGroupId: id })] }),
      review(100 + n, {
        urgentReason: 'health',
        mentions: [mention({ issueGroupId: id })],
      }),
    ])
    expect(
      seriousConcerns(groupSeriousConcerns(reviews, manyGroups), false),
    ).toMatchObject({
      groupCount: 12,
      reviewCount: 24,
      remainingGroupCount: 2,
      remainingReviewCount: 4,
    })
    expect(seriousConcerns([], true).coverage).toBe('provisional')
  })
})
