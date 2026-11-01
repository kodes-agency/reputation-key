import { describe, expect, it } from 'vitest'
import type { PortalGoalPageTiles } from '#/contexts/reporting/application/dto/monthly-portal-goal-page.types'
import type {
  PortalGoalCardView,
  PortalGoalRunningMonth,
} from '#/contexts/reporting/application/dto/monthly-portal-goal.types'
import {
  changeNumberNote,
  compareBand,
  quietRow,
  todoBand,
} from './portal-goal-bands-view'
import { PORTAL_ASK_EVERY_GUEST_LINE } from './portal-goal-copy'
import { PAGE_RUNNING } from './portal-goal-page.stories.fixtures'
import {
  CARD_FIRST_DAYS,
  CARD_ON_PACE,
  CARD_RUNNING,
} from './portal-goal-running.stories.fixtures'

const monthOf = (card: PortalGoalCardView): PortalGoalRunningMonth => {
  if (card.state !== 'goal' || card.goal.month === null) {
    throw new Error('expected a card with a running month')
  }
  return card.goal.month
}

/** Nov 22: 23 of 40 with 22 of 30 days gone, behind. */
const RUNNING = monthOf(CARD_RUNNING)

const tiles = (about: number | null): PortalGoalPageTiles => ({
  lastMonth: { key: '2026-10', outcome: 'no_goal' },
  usual: about === null ? null : { about, weeks: 4 },
})

describe('compareBand: how does this month compare?', () => {
  const usualHint = (about: number) => `You usually get about ${about} a month.`
  const monthAt = (value: number | null, elapsedDays: number, quietDays = false) => ({
    ...RUNNING,
    value,
    elapsedDays,
    quietDays,
  })

  it('has no month to compare when none is counting, and still says the usual', () => {
    expect(compareBand(null, tiles(34))).toEqual({
      title: 'How does this month compare?',
      icon: 'months',
      answer: 'No month is counting now',
      hint: usualHint(34),
      tone: 'neutral',
    })
    expect(compareBand(null, null).hint).toBeNull()
  })

  it('does not guess at a month whose figure cannot be read', () => {
    expect(compareBand(monthAt(null, 22), tiles(34))).toMatchObject({
      answer: 'Can’t tell right now',
      hint: usualHint(34),
      tone: 'neutral',
    })
  })

  it('is too early in the first quiet days, and until a week of the month has gone', () => {
    const first = monthOf(CARD_FIRST_DAYS)

    expect(compareBand(first, tiles(34))).toMatchObject({
      answer: 'Too early to say',
      hint: usualHint(34),
    })
    expect(compareBand(monthAt(5, 6), tiles(null))).toMatchObject({
      answer: 'Too early to say',
      hint: null,
    })
    // A week in, a pace is said: 8 in 7 days is about 34 in 30.
    expect(compareBand(monthAt(8, 7), tiles(34))).toMatchObject({
      answer: 'About your usual',
      hint: `${usualHint(34)} At this pace you’d end around 34.`,
    })
  })

  it('with no usual yet, is on course when the pace reaches the number, else short', () => {
    // 20 in 15 of 30 days ends at 40, the number; 19 ends at 38.
    expect(compareBand(monthAt(20, 15), null)).toEqual({
      title: 'How does this month compare?',
      icon: 'months',
      answer: 'On course for your number',
      hint: 'At this pace you’d end around 40.',
      tone: 'positive',
    })
    expect(compareBand(monthAt(19, 15), tiles(null))).toMatchObject({
      answer: 'Short of your number so far',
      hint: 'At this pace you’d end around 38.',
      tone: 'neutral',
    })
  })

  it('says a slower month, in neutral words, when the pace ends under the usual', () => {
    // 17 in 15 days ends at 34 against a usual of 40.
    expect(compareBand(monthAt(17, 15), tiles(40))).toEqual({
      title: 'How does this month compare?',
      icon: 'months',
      answer: 'A slower month so far',
      hint: `${usualHint(40)} At this pace you’d end around 34.`,
      tone: 'neutral',
    })
  })

  it('says better than usual, in the positive tone, when the pace ends over the usual', () => {
    // 23 in 15 days ends at 46.
    expect(compareBand(monthAt(23, 15), tiles(40))).toMatchObject({
      answer: 'Better than usual',
      hint: `${usualHint(40)} At this pace you’d end around 46.`,
      tone: 'positive',
    })
  })

  it('says about the usual within 10% of it, edges included', () => {
    // A usual of 40: 36 and 44 are exactly 10% under and over; 35 and 45 are past it.
    const answer = (value: number, elapsedDays: number) =>
      compareBand(monthAt(value, elapsedDays), tiles(40)).answer

    expect(answer(18, 15)).toBe('About your usual')
    expect(answer(22, 15)).toBe('About your usual')
    expect(answer(14, 12)).toBe('A slower month so far')
    expect(answer(18, 12)).toBe('Better than usual')
    expect(compareBand(RUNNING, PAGE_RUNNING.tiles).answer).toBe('About your usual')
  })

  it('is titled for the question in every state', () => {
    const states = [
      compareBand(null, null),
      compareBand(monthAt(null, 22), null),
      compareBand(monthOf(CARD_FIRST_DAYS), null),
      compareBand(monthOf(CARD_ON_PACE), tiles(34)),
    ]

    for (const band of states) {
      expect(band).toMatchObject({
        title: 'How does this month compare?',
        icon: 'months',
      })
    }
  })
})

describe('todoBand: what can you do this week?', () => {
  const asking = {
    title: 'What can you do this week?',
    icon: 'flag',
    answer: 'Ask every guest',
    tone: 'neutral',
  } as const

  it('asks every guest while the month is behind, with the line for private ratings', () => {
    expect(todoBand('portal_rating_count', RUNNING)).toEqual({
      ...asking,
      hint: PORTAL_ASK_EVERY_GUEST_LINE,
    })
  })

  it('says where to put the codes for scans', () => {
    expect(todoBand('qualified_scans', RUNNING)).toEqual({
      ...asking,
      hint: 'Put your codes where guests can see them.',
    })
  })

  it('says keep going when the month is on pace, or the number is passed', () => {
    const onPace = monthOf(CARD_ON_PACE)

    expect(todoBand('portal_rating_count', onPace).answer).toBe('Keep going')
    // Passed, whatever the pace was judged.
    expect(todoBand('portal_rating_count', { ...RUNNING, value: 40 }).answer).toBe(
      'Keep going',
    )
  })

  it('asks every guest when the pace was not judged, or no figure or month is there', () => {
    expect(todoBand('portal_rating_count', { ...RUNNING, belowPace: null }).answer).toBe(
      'Ask every guest',
    )
    expect(
      todoBand('portal_rating_count', { ...RUNNING, value: null, belowPace: null })
        .answer,
    ).toBe('Ask every guest')
    expect(todoBand('portal_rating_count', null).answer).toBe('Ask every guest')
  })
})

describe('the rows under the questions', () => {
  it('names the Portal gone quiet in the row that sends them to its code', () => {
    expect(quietRow('Restaurant')).toEqual({
      title: 'Check Restaurant’s code',
      note: 'See it, print it again, or move it.',
    })
  })

  it('says the usual under the way to change the number', () => {
    expect(changeNumberNote(tiles(34))).toBe('Your usual is about 34 a month.')
    expect(changeNumberNote(PAGE_RUNNING.tiles)).toBe('Your usual is about 34 a month.')
  })

  it('says nothing of a usual there is none of', () => {
    expect(changeNumberNote(tiles(null))).toBeNull()
    expect(changeNumberNote(null)).toBeNull()
  })
})
