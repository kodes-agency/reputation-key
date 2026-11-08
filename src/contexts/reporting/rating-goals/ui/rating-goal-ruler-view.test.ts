// The Google rating goal on the goal ruler (2026-11-01): from what Google showed when
// the goal was set to the goal, a stop at each tenth on the way, and the bar reaching
// a stop when the exact average can make Google show it. A manager reads Google's
// one-decimal numbers only, never 4.02 or 4.05.
import { describe, expect, it } from 'vitest'
import { ratingGoalRuler } from './rating-goal-ruler-view'
import {
  CARD_GETTING_STARTED,
  CARD_GOOGLE_SOURCE,
  CARD_HARBORLINE,
  CARD_HARBORLINE_JUST_SET,
  CARD_LAGS,
  CARD_LAGS_MIDDLE,
  CARD_TOO_LOW,
  CARD_WAITING,
} from './rating-goal-tracking.stories.fixtures'
import { CARD, CARD_KEEP, CARD_REACHED } from './rating-goal.stories.fixtures'

/** Harborline's card with its goal moved up to 4.4: the tenths 4.0 to 4.3 lie on the way. */
const LONG_CLIMB = {
  ...CARD_HARBORLINE,
  targetTenths: 44,
  target: 4.4,
  threshold: 4.35,
  stillNeeded: 97,
  next: { targetTenths: 41, target: 4.1, reviewsNeeded: 18 },
}

/** A goal of 4.2 from 3.9: two tenths lie on the way, 4.0 (reached) and 4.1 (the next). */
const TWO_STOPS = {
  ...CARD_HARBORLINE,
  targetTenths: 42,
  target: 4.2,
  threshold: 4.15,
  stillNeeded: 80,
  next: { targetTenths: 41, target: 4.1, reviewsNeeded: 18 },
}

/** A goal of 4.2 from 3.5, Google at 3.8: six tenths lie on the way, three of them reached. */
const SIX_STOPS = {
  ...CARD_HARBORLINE,
  baseline: { googleShows: 3.5, reviewCount: 261, exactAverage: 3.5 },
  google: { ...CARD_HARBORLINE.google!, shows: 3.8 },
  exactAverage: 3.83,
  targetTenths: 42,
  target: 4.2,
  threshold: 4.15,
  next: { targetTenths: 39, target: 3.9, reviewsNeeded: 25 },
}

const ruler = (card: Parameters<typeof ratingGoalRuler>[0]) => {
  const model = ratingGoalRuler(card)
  if (model === null) throw new Error('expected a ruler')
  return model
}

describe('when there is no ruler', () => {
  it('draws none for a goal to keep a number', () => {
    expect(ratingGoalRuler(CARD_KEEP)).toBeNull()
  })

  it('draws none before Google has sent a number', () => {
    expect(ratingGoalRuler({ ...CARD_HARBORLINE, google: null })).toBeNull()
  })

  it('draws none while Google has no average to show', () => {
    expect(
      ratingGoalRuler({
        ...CARD_HARBORLINE,
        google: { ...CARD_HARBORLINE.google!, shows: null },
      }),
    ).toBeNull()
  })
})

describe('how far along the goal is', () => {
  it('measures the exact average from where the goal started to where Google shows the goal', () => {
    // 3.912 at the set, 4.05 where Google shows 4.1, 4.02 now: 0.108 of 0.138.
    expect(ruler(CARD_HARBORLINE).at).toBeCloseTo(0.108 / 0.138, 6)
  })

  it('stands halfway when the exact average is halfway between them', () => {
    const halfway = { ...CARD_HARBORLINE, exactAverage: 3.981 }

    expect(ruler(halfway).at).toBeCloseTo(0.5, 6)
  })

  it('stands at the start when nothing has changed since the goal was set', () => {
    expect(ruler(CARD_HARBORLINE_JUST_SET).at).toBe(0)
  })

  it('stays at the start when the exact average is below where the goal started', () => {
    const slipped = { ...CARD_HARBORLINE, exactAverage: 3.8 }

    expect(ruler(slipped).at).toBe(0)
  })

  it('stands at the start when the card has no exact average yet', () => {
    const unknown = { ...CARD_HARBORLINE, exactAverage: null }

    expect(ruler(unknown).at).toBe(0)
  })

  it('stays at the goal when the exact average is past it', () => {
    const past = { ...CARD_HARBORLINE, exactAverage: 4.2 }

    expect(ruler(past).at).toBe(1)
  })

  it('is the whole way while the reviews already clear the goal and Google has yet to show it', () => {
    const model = ruler(CARD_LAGS)

    expect(model.at).toBe(1)
    expect(model.reached).toBe(false)
    expect(model.nowAlign).toBe('end')
    expect(model.to.note).toBe('your goal')
  })

  it('is the whole way for a goal that is reached, and says so at the goal', () => {
    const model = ruler(CARD_REACHED)

    expect(model.at).toBe(1)
    expect(model.reached).toBe(true)
    expect(model.to).toEqual({ value: '4.5', note: 'reached' })
  })

  it('is the whole way when the goal starts at or past the number that shows it', () => {
    const nothingLeft = {
      ...CARD_HARBORLINE,
      baseline: { ...CARD_HARBORLINE.baseline, exactAverage: 4.06 },
    }

    expect(ruler(nothingLeft).at).toBe(1)
  })

  it('labels where the goal stands “Today”', () => {
    expect(ruler(CARD_HARBORLINE).now).toBe('Today')
  })
})

describe('the ends', () => {
  it('starts at the tenth Google showed when the goal was set, and names it', () => {
    expect(ruler(CARD_HARBORLINE).from).toEqual({ value: '3.9', note: 'started' })
  })

  it('ends at the goal, and names it', () => {
    expect(ruler(CARD_HARBORLINE).to).toEqual({ value: '4.1', note: 'your goal' })
  })

  it('shows the start as a whole tenth, not as the exact 3.912', () => {
    const model = ruler(CARD_HARBORLINE)

    expect(model.from.value).toBe('3.9')
    expect(JSON.stringify(model)).not.toContain('3.912')
    expect(JSON.stringify(model)).not.toContain('4.02')
  })
})

describe('the stops on the way', () => {
  it('puts a stop at each tenth between the start and the goal, the start and the goal left out', () => {
    const model = ruler(LONG_CLIMB)

    expect(model.stops.map((stop) => stop.key)).toEqual(['40', '41', '42', '43'])
  })

  it('names a stop by its tenth where its words have room', () => {
    expect(ruler(TWO_STOPS).stops.map((stop) => stop.value)).toEqual(['4.0', '4.1'])
  })

  it('leaves the words off a tenth too near the start, and keeps its dot', () => {
    // 4.0 is 0.087 of the way from 3.9 to 4.4: under the start's own words.
    const [forty] = ruler(LONG_CLIMB).stops

    expect(forty).toMatchObject({ key: '40', value: null, note: null })
    expect(forty?.at).toBeCloseTo(0.038 / 0.438, 6)
  })

  it('has no stop when the goal is the very next tenth', () => {
    const next = { ...CARD_HARBORLINE, targetTenths: 40, target: 4, threshold: 3.95 }

    expect(ruler(next).stops).toEqual([])
  })

  it('places a tenth at the exact average at which Google shows it, as a share of the way', () => {
    const [forty] = ruler(CARD_HARBORLINE).stops

    // 4.0 is shown from 3.95: (3.95 - 3.912) of the 0.138 to 4.05.
    expect(forty?.at).toBeCloseTo(0.038 / 0.138, 6)
  })

  it('spaces the tenths evenly along the way, a tenth apart', () => {
    const shares = ruler(LONG_CLIMB).stops.map((stop) => stop.at)

    // A tenth is 0.1 of the 0.438 between 3.912 and 4.35.
    expect(shares[1]! - shares[0]!).toBeCloseTo(0.1 / 0.438, 6)
    expect(shares[2]! - shares[1]!).toBeCloseTo(0.1 / 0.438, 6)
    expect(shares[3]! - shares[2]!).toBeCloseTo(0.1 / 0.438, 6)
  })

  it('reaches a stop when the exact average gets Google to show it', () => {
    const [forty] = ruler(CARD_HARBORLINE).stops

    expect(forty?.reached).toBe(true)
    expect(ruler(CARD_HARBORLINE_JUST_SET).stops[0]?.reached).toBe(false)
  })

  it('puts every stop at the end when no climb is left to measure', () => {
    const nothingLeft = {
      ...LONG_CLIMB,
      baseline: { ...LONG_CLIMB.baseline, exactAverage: 4.36 },
    }

    expect(ruler(nothingLeft).stops.map((stop) => stop.at)).toEqual([1, 1, 1, 1])
  })
})

describe('the words under a stop', () => {
  it('says “reached” under a tenth Google already shows', () => {
    expect(ruler(CARD_HARBORLINE).stops[0]).toMatchObject({
      value: '4.0',
      note: 'reached',
    })
  })

  it('says the new reviews it takes under the next tenth', () => {
    const [forty] = ruler(CARD_GETTING_STARTED).stops

    expect(forty).toMatchObject({ value: '4.0', note: '12 new reviews' })
  })

  it('says about under the next tenth while the exact average is Google’s own figure', () => {
    const rounded = { ...CARD_GETTING_STARTED, exactAverageSource: 'google' as const }

    expect(ruler(rounded).stops[0]?.note).toBe('About 12 new reviews')
  })

  it('says one new review in the singular', () => {
    const one = {
      ...CARD_GETTING_STARTED,
      next: { ...CARD_GETTING_STARTED.next!, reviewsNeeded: 1 },
    }

    expect(ruler(one).stops[0]?.note).toBe('1 new review')
  })

  it('writes a thousand reviews with its separator', () => {
    const many = {
      ...CARD_GETTING_STARTED,
      next: { ...CARD_GETTING_STARTED.next!, reviewsNeeded: 1240 },
    }

    expect(ruler(many).stops[0]?.note).toBe('1,240 new reviews')
  })

  it('says nothing under a tenth Google does not show yet and the goal does not count to next', () => {
    expect(ruler(CARD_LAGS_MIDDLE).stops[0]).toMatchObject({ value: '4.4', note: null })
  })

  it('names only the next tenth once there are more than two stops, not those Google shows', () => {
    // Google shows 3.8, so 3.6, 3.7 and 3.8 are reached, yet only 3.9, the next, has words.
    const model = ruler(SIX_STOPS)

    expect(model.stops.map((stop) => stop.key)).toEqual([
      '36',
      '37',
      '38',
      '39',
      '40',
      '41',
    ])
    expect(model.stops.map((stop) => stop.note)).toEqual([
      null,
      null,
      null,
      '25 new reviews',
      null,
      null,
    ])
    expect(model.stops[2]?.reached).toBe(true)
  })

  it('names both of two stops: the one Google shows as reached and the next by its reviews', () => {
    expect(ruler(TWO_STOPS).stops.map((stop) => [stop.value, stop.note])).toEqual([
      ['4.0', 'reached'],
      ['4.1', '18 new reviews'],
    ])
  })

  it('says nothing about the reviews it takes when the card has no next number', () => {
    const noNext = { ...CARD_HARBORLINE, next: null }

    expect(ruler(noNext).stops[0]?.note).toBe('reached')
    expect(ruler({ ...LONG_CLIMB, next: null }).stops.map((stop) => stop.note)).toEqual([
      null,
      null,
      null,
      null,
    ])
  })
})

describe('the picture’s sentence', () => {
  it('says where it started, what Google shows now and the goal', () => {
    expect(ruler(CARD_HARBORLINE).label).toBe(
      'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.',
    )
  })

  it('says what Google showed last, not now, while its numbers are stale', () => {
    expect(ruler(CARD_WAITING).label).toBe(
      'Started at 3.9. Google showed 4.0 last. Your goal is 4.1.',
    )
  })

  it('leaves the start out while Google still shows it', () => {
    expect(ruler(CARD_GETTING_STARTED).label).toBe(
      'Google shows 3.9 now. Your goal is 4.1.',
    )
    expect(ruler(CARD).label).toBe('Google shows 4.3 now. Your goal is 4.5.')
  })

  it('leaves the start out when Google has gone below it', () => {
    const slipped = {
      ...CARD_HARBORLINE,
      google: { ...CARD_HARBORLINE.google!, shows: 3.8 },
    }

    expect(ruler(slipped).label).toBe('Google shows 3.8 now. Your goal is 4.1.')
  })

  it('says it reached the goal for a goal that is reached', () => {
    expect(ruler(CARD_REACHED).label).toBe('Started at 4.3. Reached 4.5.')
  })

  it('tells a goal Google should show soon like any other active goal', () => {
    expect(ruler(CARD_LAGS).label).toBe(
      'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.',
    )
  })

  it('tells a goal whose new reviews are too low like any other active goal', () => {
    expect(ruler(CARD_TOO_LOW).label).toBe(
      'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.',
    )
  })

  it('names Google’s one-decimal number while the exact average is Google’s own figure', () => {
    const model = ruler(CARD_GOOGLE_SOURCE)

    expect(model.label).toBe('Started at 3.9. Google shows 4.0 now. Your goal is 4.1.')
    expect(model.at).toBeCloseTo(0.088 / 0.138, 6)
  })
})
