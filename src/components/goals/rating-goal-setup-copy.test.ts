import { describe, expect, it } from 'vitest'
import type { RatingGoalSetupInputs } from '#/contexts/reporting/application/dto/rating-goal-setup.types'
import { workOutRatingGoal } from '#/contexts/reporting/application/rating-goal-setup-plan'
import { choicesOf, type SetupDraft, type SetupPlan } from './rating-goal-setup-draft'
import {
  averageSourceText,
  averageWhyText,
  exampleText,
  paceNote,
  paceWhyText,
  rulerGeometry,
  workedOutParagraphs,
} from './rating-goal-setup-copy'
import {
  EDGE_46,
  EDGE_47,
  GOOGLE_LAGS,
  HARBORLINE,
  LOW_RATING,
  OLIVE_TREE,
  SEAVIEW,
  TAVOLA,
} from './rating-goal-setup.stories.fixtures'

function planOf(inputs: RatingGoalSetupInputs, draft: SetupDraft = {}): SetupPlan {
  const view = workOutRatingGoal(inputs, choicesOf(draft))
  if (view.kind !== 'plan') throw new Error(`expected a plan, got ${view.kind}`)
  return view
}

const paragraphs = (inputs: RatingGoalSetupInputs, draft: SetupDraft = {}) =>
  workedOutParagraphs(planOf(inputs, draft), inputs, 'day').map((runs) =>
    runs.map((run) => run.text).join(''),
  )

describe('where the planned average comes from', () => {
  it.each([
    [HARBORLINE, 'your best year, 2024'],
    [OLIVE_TREE, 'halfway between your 4.2 and 5'],
    [SEAVIEW, 'your best month, August'],
    [TAVOLA, 'your best month, May'],
  ])('names its source', (inputs, source) => {
    expect(averageSourceText(planOf(inputs).average, inputs.displayedTenths)).toBe(source)
  })

  it('names a typed one and the plan’s earlier one (D30)', () => {
    expect(
      averageSourceText(planOf(HARBORLINE, { ownAverageTenths: 47 }).average, 39),
    ).toBe('your own number')
    expect(
      averageSourceText(planOf(HARBORLINE, { keptAverageTenths: 47 }).average, 39),
    ).toBe('your plan’s average')
  })

  it('says why, for each source', () => {
    expect(averageWhyText(planOf(HARBORLINE).average)).toBe(
      'Guests who write on their own are often the unhappy ones, so guests you ask usually rate you higher. We switch to your real average as reviews arrive.',
    )
    expect(averageWhyText(planOf(HARBORLINE, { ownAverageTenths: 47 }).average)).toBe(
      'You set this. We switch to your real average as reviews arrive.',
    )
    expect(averageWhyText(planOf(HARBORLINE, { keptAverageTenths: 47 }).average)).toBe(
      'Kept from your plan. We switch to your real average as reviews arrive.',
    )
  })
})

describe('the note under the pace', () => {
  it.each([
    [HARBORLINE, 'day', 'About 30 a month, up from about 2 a month now.'],
    [SEAVIEW, 'day', 'About 60 a month, up from about 35 a month now.'],
    [TAVOLA, 'month', 'About 7 a day, up from about 150 a month now.'],
  ] as const)('reads the other unit, then today', (inputs, unit, note) => {
    expect(paceNote(planOf(inputs), unit)).toBe(note)
  })

  it('says fewer, or about the same, as what comes in now', () => {
    expect(
      paceNote(planOf(TAVOLA, { pace: { kind: 'own', tenthsPerWeek: 140 } }), 'day'),
    ).toBe('About 60 a month, fewer than the 150 a month you get now.')
    expect(
      paceNote(planOf(TAVOLA, { pace: { kind: 'own', tenthsPerWeek: 343 } }), 'day'),
    ).toBe('About 150 a month, about what you get now.')
  })

  it('says none came in the last 3 months', () => {
    expect(paceNote(planOf(EDGE_46), 'day')).toBe(
      'About 30 a month, up from none in the last 3 months.',
    )
  })

  it('says under 1 a month, not none, when one review came in 3 months', () => {
    const quiet = { ...OLIVE_TREE, reviewsLast90Days: 1 }
    expect(paceNote(planOf(quiet), 'day')).toBe(
      'About 30 a month, up from under 1 a month now.',
    )
    expect(paragraphs(quiet)[3]).toMatch(
      /At today’s pace of under 1 a month, the same 40 reviews would take more than 3 years\.$/u,
    )
  })

  it('says why the pace is recommended, quiet or busy', () => {
    expect(paceWhyText(planOf(HARBORLINE))).toBe(
      'Places that ask every guest manage at least 1 a day, so we suggest 1 a day.',
    )
    expect(paceWhyText(planOf(SEAVIEW))).toBe(
      'Your busiest month brought 46, about 1.5 a day; places that ask every guest usually do more, so we suggest 2 a day.',
    )
    expect(paceWhyText(planOf(TAVOLA))).toBe(
      'Your busiest month brought 152, about 5.1 a day; places that ask every guest usually do more, so we suggest 7 a day.',
    )
  })
})

describe('how we worked out the goal', () => {
  it('walks through Harborline’s 4.1', () => {
    expect(paragraphs(HARBORLINE)).toEqual([
      'Google shows 3.9 from 261 reviews today. 81 new reviews averaging 4.5 stars make the average 4.05, which Google shows as 4.1.',
      '4.1 is the highest number you can count on within 6 months at 1 a day, even if new reviews average 0.1 stars lower than planned. Places that ask every guest manage at least 1 a day, so we suggest 1 a day.',
      'We plan new reviews at 4.5 stars, never at today’s 3.9: your best year, 2024 averaged 4.5. After your first 10 new reviews, their real average takes over.',
      '“Likely 9 weeks to 4 months” allows for new reviews averaging 0.1 stars lower or higher, and for asking 10% less or more. At today’s 2 a month, the same 81 reviews would take more than 3 years.',
      '4.5 stars is, for example, 5 in 10 guests giving 5 stars and the other 5 giving 4. It is a forecast from your own history, not a target for guests or staff.',
    ])
  })

  it('sets the reviews needed in bold', () => {
    const runs = workedOutParagraphs(planOf(HARBORLINE), HARBORLINE, 'day')[0]
    expect(runs?.[1]).toEqual({ text: '81', strong: true })
  })

  it('says halfway, and why, without evidence (Olive Tree)', () => {
    expect(paragraphs(OLIVE_TREE)[2]).toBe(
      'We plan new reviews at 4.6 stars, never at today’s 4.2: halfway between 4.2 and 5, because asked guests rate higher than those who write on their own. After your first 10 new reviews, their real average takes over.',
    )
  })

  it('suggests the next step up when nothing is within six months (4.6)', () => {
    expect(paragraphs(EDGE_46)[1]).toBe(
      '4.7 is the next step up from today, so we suggest it. Places that ask every guest manage at least 1 a day, so we suggest 1 a day.',
    )
    expect(paragraphs(EDGE_46)[3]).toBe(
      '“Likely 3 months or more” allows for new reviews averaging 0.1 stars lower or higher, and for asking 10% less or more.',
    )
  })

  it('names the goal chosen and the one suggested', () => {
    expect(paragraphs(SEAVIEW, { pin: 45 })[1]).toBe(
      'You chose 4.5. We suggest 4.4: the highest you can count on within 6 months at 2 a day. Your busiest month brought 46, about 1.5 a day; places that ask every guest usually do more, so we suggest 2 a day.',
    )
  })

  it('names a typed average and the plan’s earlier one', () => {
    expect(paragraphs(EDGE_47)[2]).toBe('You set new reviews at 4.9 stars.')
    expect(paragraphs(HARBORLINE, { keptAverageTenths: 47 })[2]).toBe(
      'Your plan has new reviews at 4.7 stars.',
    )
  })

  it('says about when the average is Google’s own rounded figure', () => {
    const google = {
      ...HARBORLINE,
      exact: { num: 39, den: 10 },
      exactSource: 'google' as const,
    }
    expect(paragraphs(google)[0]).toBe(
      'Google shows 3.9 from 261 reviews today. 87 new reviews averaging 4.5 stars make the average about 4.05, which Google shows as 4.1.',
    )
  })

  it('starts above what Google shows while it lags (D28)', () => {
    expect(paragraphs(GOOGLE_LAGS)[0]).toBe(
      'Google shows 3.9 from 100 reviews today. 55 new reviews averaging 4.5 stars make the average 4.15, which Google shows as 4.2.',
    )
  })

  it('gives an example around a low planned average (2.5 plans 3.8★)', () => {
    expect(paragraphs(LOW_RATING)[4]).toBe(
      '3.8 stars is, for example, 8 in 10 guests giving 4 stars and the other 2 giving 3. It is a forecast from your own history, not a target for guests or staff.',
    )
  })
})

describe('an example of a planned average', () => {
  it.each([
    [47, '7 in 10 guests giving 5 stars and the other 3 giving 4'],
    [45, '5 in 10 guests giving 5 stars and the other 5 giving 4'],
    [38, '8 in 10 guests giving 4 stars and the other 2 giving 3'],
    [40, 'every guest giving 4 stars'],
    [50, 'every guest giving 5 stars'],
    [10, 'every guest giving 1 star'],
    [11, '1 in 10 guests giving 2 stars and the other 9 giving 1'],
  ])('words %i as %s', (tenths, words) => {
    expect(exampleText(tenths)).toBe(words)
  })
})

describe('the ruler', () => {
  it('runs from four tenths below today to 5.0, a tick a tenth', () => {
    const ruler = rulerGeometry(39, 41)
    expect(ruler.ticks).toHaveLength(16)
    expect(ruler.ticks[0]).toEqual({ at: 0, whole: false })
    expect(ruler.ticks.filter((tick) => tick.whole).map((tick) => tick.at)).toEqual([
      5 / 15,
      1,
    ])
    expect(ruler.today).toBeCloseTo(4 / 15)
    expect(ruler.goal).toBeCloseTo(6 / 15)
    expect(ruler.climb).toBeCloseTo(2 / 11)
  })
})
