// The goal ruler, laid out (2026-11-01): where a goal stands is kept on the ruler, the
// "now" label stays inside it at both ends, and a stop's words are drawn only where
// they cannot run into the two ends or into the end's own note.
import { describe, expect, it } from 'vitest'
import { clampShare, rulerModel } from './goal-ruler-view'

type Input = Parameters<typeof rulerModel>[0]

/** A ruler from 3.9 to 4.1 with nothing on the way; a test changes only what it is about. */
const ruler = (input: Partial<Input> = {}) =>
  rulerModel({
    label: 'Started at 3.9. Google shows 4.0 now. Your goal is 4.1.',
    from: { value: '3.9', note: 'started' },
    to: { value: '4.1', note: 'your goal' },
    at: 0.5,
    now: 'Today',
    stops: [],
    ...input,
  })

/** One stop with its words, at a share of the ruler. */
const stop = (key: string, at: number) => ({
  key,
  at,
  value: `Stop ${key}`,
  note: `note ${key}`,
})

describe('keeping a share on the ruler', () => {
  it('leaves a share between the two ends as it is', () => {
    expect(clampShare(0)).toBe(0)
    expect(clampShare(0.42)).toBe(0.42)
    expect(clampShare(1)).toBe(1)
  })

  it('keeps a share below the start at the start and one past the goal at the goal', () => {
    expect(clampShare(-0.3)).toBe(0)
    expect(clampShare(1.7)).toBe(1)
  })

  it('reads a share that is not a number as the start', () => {
    expect(clampShare(Number.NaN)).toBe(0)
  })
})

describe('where the goal stands', () => {
  it('keeps the goal on the ruler when its figure is below the start or past the goal', () => {
    expect(ruler({ at: -0.4 }).at).toBe(0)
    expect(ruler({ at: 2.5 }).at).toBe(1)
  })

  it('hands the picture’s sentence, both ends and the label on', () => {
    const model = ruler({ now: '23 so far' })

    expect(model.label).toBe('Started at 3.9. Google shows 4.0 now. Your goal is 4.1.')
    expect(model.from).toEqual({ value: '3.9', note: 'started' })
    expect(model.to).toEqual({ value: '4.1', note: 'your goal' })
    expect(model.now).toBe('23 so far')
  })

  it('is not reached unless the goal says so', () => {
    expect(ruler().reached).toBe(false)
    expect(ruler({ reached: false }).reached).toBe(false)
    expect(ruler({ reached: true }).reached).toBe(true)
  })

  it('marks a stop as reached once the goal has stood at it, and not before', () => {
    const model = ruler({
      at: 0.5,
      stops: [stop('behind', 0.3), stop('here', 0.5), stop('ahead', 0.7)],
    })

    expect(model.stops.map((one) => [one.key, one.reached])).toEqual([
      ['behind', true],
      ['here', true],
      ['ahead', false],
    ])
  })
})

describe('the "now" label at both ends', () => {
  it('stands over the goal in the middle of the ruler', () => {
    const model = ruler({ at: 0.5 })

    expect(model.nowAlign).toBe('center')
    expect(model.startDot).toBe(true)
  })

  it('starts at the left edge when the goal is at, or right next to, the start', () => {
    expect(ruler({ at: 0 }).nowAlign).toBe('start')
    expect(ruler({ at: 0.04 }).nowAlign).toBe('start')
  })

  it('ends at the right edge when the goal is at, or right next to, the end', () => {
    expect(ruler({ at: 1 }).nowAlign).toBe('end')
    expect(ruler({ at: 0.96 }).nowAlign).toBe('end')
  })

  it('centres the label again a little in from either end', () => {
    expect(ruler({ at: 0.1 }).nowAlign).toBe('center')
    expect(ruler({ at: 0.9 }).nowAlign).toBe('center')
  })

  it('draws no dot of its own at the start while the goal stands on it', () => {
    expect(ruler({ at: 0 }).startDot).toBe(false)
    expect(ruler({ at: 0.04 }).startDot).toBe(false)
    expect(ruler({ at: 0.1 }).startDot).toBe(true)
  })

  it('keeps the label at the right edge for a goal that is past the end', () => {
    expect(ruler({ at: 1.8 }).nowAlign).toBe('end')
  })
})

describe('a stop’s words', () => {
  it('draws them for a stop in the middle of the ruler', () => {
    const [middle] = ruler({ stops: [stop('mid', 0.5)] }).stops

    expect(middle).toMatchObject({ value: 'Stop mid', note: 'note mid', at: 0.5 })
  })

  it('hides them for a stop too near the start, where the start’s own words are', () => {
    const [near] = ruler({ stops: [stop('near', 0.1)] }).stops

    expect(near).toMatchObject({ value: null, note: null, at: 0.1 })
  })

  it('draws them from 0.14 of the way', () => {
    const [first] = ruler({ stops: [stop('first', 0.14)] }).stops

    expect(first?.value).toBe('Stop first')
  })

  it('draws them up to 0.93 of the way and hides them past it', () => {
    const model = ruler({ stops: [stop('last', 0.93), stop('past', 0.94)] })

    expect(model.stops.map((one) => one.value)).toEqual(['Stop last', null])
    expect(model.stops.map((one) => one.note)).toEqual(['note last', null])
  })

  it('still draws the dot of a stop whose words are hidden', () => {
    const model = ruler({ stops: [stop('near', 0.05), stop('past', 0.97)] })

    expect(model.stops.map((one) => one.at)).toEqual([0.05, 0.97])
  })

  it('keeps a stop outside the ruler on it, and hides its words', () => {
    const model = ruler({ stops: [stop('before', -0.2), stop('beyond', 1.4)] })

    expect(model.stops.map((one) => one.at)).toEqual([0, 1])
    expect(model.stops.map((one) => one.value)).toEqual([null, null])
  })

  it('keeps the order and the keys the goal gave', () => {
    const model = ruler({ stops: [stop('b', 0.6), stop('a', 0.3), stop('c', 0.45)] })

    expect(model.stops.map((one) => one.key)).toEqual(['b', 'a', 'c'])
  })

  it('is centred under its stop up to 0.8 of the way and ends at it past that', () => {
    const model = ruler({
      stops: [stop('mid', 0.5), stop('edge', 0.8), stop('late', 0.85)],
    })

    expect(model.stops.map((one) => one.align)).toEqual(['center', 'center', 'end'])
  })
})

describe('the end’s note beside a stop near the end', () => {
  it('goes where the stop’s words would reach it', () => {
    expect(ruler({ stops: [stop('near', 0.85)] }).to.note).toBeNull()
  })

  it('stays where the stop is too near the end to say anything', () => {
    expect(ruler({ stops: [stop('last', 0.97)] }).to.note).toBe('your goal')
  })
})

describe('the end’s note on a narrow ruler', () => {
  it('stays at every width while no stop’s words reach it', () => {
    expect(ruler({ stops: [stop('mid', 0.5)] }).toNoteWideOnly).toBe(false)
    expect(ruler().toNoteWideOnly).toBe(false)
  })

  it('leaves a narrow ruler from 0.55, where a stop’s words reach it', () => {
    expect(ruler({ stops: [stop('mid', 0.54)] }).toNoteWideOnly).toBe(false)
    expect(ruler({ stops: [stop('late', 0.55)] }).toNoteWideOnly).toBe(true)
    expect(ruler({ stops: [stop('later', 0.7)] }).toNoteWideOnly).toBe(true)
  })

  it('does not leave for a stop whose words are hidden', () => {
    expect(ruler({ stops: [stop('past', 0.97)] }).toNoteWideOnly).toBe(false)
  })

  it('does not leave for words that are early on the ruler', () => {
    expect(
      ruler({ stops: [stop('early', 0.2), stop('hidden', 0.05)] }).toNoteWideOnly,
    ).toBe(false)
  })
})

describe('the end’s note beside a crowded end', () => {
  it('keeps the note while every stop stands at 0.8 or before', () => {
    const model = ruler({ stops: [stop('mid', 0.5), stop('edge', 0.8)] })

    expect(model.to).toEqual({ value: '4.1', note: 'your goal' })
  })

  it('drops the note, and keeps the figure, when a stop’s words end at the goal', () => {
    const model = ruler({ stops: [stop('mid', 0.5), stop('late', 0.85)] })

    expect(model.to).toEqual({ value: '4.1', note: null })
  })

  it('has no note to drop when the goal gave none', () => {
    const model = ruler({ to: { value: '4.1', note: null }, stops: [stop('late', 0.85)] })

    expect(model.to).toEqual({ value: '4.1', note: null })
  })
})
