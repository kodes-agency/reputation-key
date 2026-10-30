import { describe, expect, it } from 'vitest'
import type { FixFirstItem } from '#/contexts/ai/application/public-api'
import type { RatingGoalStatus } from '#/contexts/reporting/application/dto/rating-goal.types'
import {
  goalHeadline,
  topProblemLine,
  type GuestVoiceGoalFacts,
} from './guest-voice-rating-goal-words'

const goal = (over: Partial<GuestVoiceGoalFacts> = {}): GuestVoiceGoalFacts => ({
  mode: 'climb',
  target: 4.6,
  shows: 4.4,
  status: 'below_pace',
  ...over,
})

const problem = (over: Partial<FixFirstItem['statistics']> = {}): FixFirstItem => ({
  issueId: 'a0000000-0000-4000-8000-000000000001',
  title: 'Air conditioning',
  answerName: 'Air conditioning',
  lastMentionedLocalDate: '2026-10-29',
  topic: 'facilities_equipment',
  causes: ['not working'],
  urgentReason: null,
  statistics: {
    reviewCount: 19,
    textReviewCount: 128,
    allReviewCount: 224,
    shareText: '19 of 128',
    sharePercent: null,
    mentionedAverage: 2.1,
    othersAverage: 4.3,
    gap: 2.2,
    upTo: 0.2,
    change: 'rising',
    evidenceLevel: 'likely',
    ...over,
  },
})

describe('the goal beside the top problem', () => {
  it('says where a climb goal stands in Google’s own number and its pace', () => {
    expect(goalHeadline(goal())).toBe(
      'Your Google rating goal is 4.6. Google shows 4.4 and it is below pace.',
    )
  })

  it('says a keep goal is kept', () => {
    expect(
      goalHeadline(goal({ mode: 'keep', target: 4.8, shows: 4.8, status: 'holding' })),
    ).toBe('You are keeping 4.8 on Google. Google shows 4.8 and it is holding.')
  })

  it('does not invent a number while Google shows none', () => {
    expect(goalHeadline(goal({ shows: null, status: 'waiting_for_google' }))).toBe(
      "Your Google rating goal is 4.6. It is waiting for Google's numbers.",
    )
  })

  it.each<[RatingGoalStatus, string]>([
    ['reached', 'it is reached'],
    ['reviews_too_low', 'new reviews are averaging too low for it'],
    ['getting_started', 'it has only just started'],
    ['on_pace', 'it is on pace'],
    ['below_pace', 'it is below pace'],
    ['holding', 'it is holding'],
    ['dropped_below', 'it has dropped below'],
  ])('puts the %s status in words', (status, words) => {
    expect(goalHeadline(goal({ status }))).toContain(`Google shows 4.4 and ${words}.`)
  })

  it('names the top problem with what it could be worth, as the Fix first card says it', () => {
    expect(topProblemLine(problem(), '90d')).toBe(
      'Air conditioning is the top problem on this page, worth up to about 0.2★ on your 90-day average.',
    )
  })

  it('names the top problem alone where the engine has no figure for it', () => {
    expect(topProblemLine(problem({ upTo: null }), '90d')).toBe(
      'Air conditioning is the top problem on this page.',
    )
    expect(topProblemLine(problem({ upTo: 0 }), '90d')).toBe(
      'Air conditioning is the top problem on this page.',
    )
  })

  it('names no problem when the page has none', () => {
    expect(topProblemLine(undefined, '90d')).toBeNull()
  })

  it('says it as an association, never as a promise or advice', () => {
    const words = `${goalHeadline(goal())} ${topProblemLine(problem(), '30d')}`
    expect(words).not.toMatch(/will|guarantee|should|must|fix it to/i)
  })
})
