import { describe, expect, it } from 'vitest'
import {
  ADD_EACH_OCT_23,
  ADD_IDS,
  ADD_SEAVIEW,
  ADD_THIS_MONTH,
} from './portal-goal-add.stories.fixtures'
import { averageModel, committedText, numberModel } from './portal-goal-add-number-view'
import { addedToast } from './portal-goal-add-view'

describe("Add a portal goal's number steps, worded", () => {
  it('the number step: Reception · private ratings in December, its own usual, and Set 22 for December', () => {
    const [reception] = ADD_SEAVIEW.onePortal
    if (!reception) throw new Error('expected Reception')
    const model = numberModel(ADD_SEAVIEW, reception, '22')

    expect(model).toMatchObject({
      description: 'Starts on Dec 1.',
      unit: 'Reception · private ratings in December',
      chosen: 22,
      primary: { label: 'Set 22 for December', disabled: false },
      submission: {
        subject: { kind: 'portal', portalId: ADD_IDS.RECEPTION },
        metric: 'portal_rating_count',
        targetValue: 22,
        startMonth: '2026-12',
        targetSource: 'recommended',
      },
    })
    expect(model.choices?.map(({ figure, words }) => `${figure} ${words}`)).toEqual([
      '20 your usual',
      '22 a bit more',
      '24 stretch',
    ])
    expect(model.submission && addedToast(ADD_SEAVIEW, model.submission)).toBe(
      'Reception goal set: 22 private ratings for December',
    )
  })

  it('this month counts from its first day, with what already counts', () => {
    const [reception] = ADD_THIS_MONTH.onePortal
    if (!reception) throw new Error('expected Reception')

    expect(numberModel(ADD_THIS_MONTH, reception, '10').description).toBe(
      'Counts from Nov 1 · 3 already count.',
    )
  })

  it('no number yet: the box starts empty and Set waits for one', () => {
    const [, , spa] = ADD_EACH_OCT_23.onePortal
    if (!spa) throw new Error('expected Spa')
    const empty = numberModel(ADD_EACH_OCT_23, spa, '')
    const typed = numberModel(ADD_EACH_OCT_23, spa, '7')

    expect(empty).toMatchObject({
      choices: null,
      primary: { label: 'Set goal', disabled: true },
      submission: null,
    })
    expect(typed.submission).toMatchObject({ targetValue: 7, targetSource: 'own' })
    expect(numberModel(ADD_EACH_OCT_23, spa, '0').number.invalid).toBe(true)
  })

  it('the average starts empty, takes one decimal from 1 to 5, and is its own', () => {
    expect(averageModel(ADD_SEAVIEW, '')).toMatchObject({
      description: 'Average private rating',
      unit: 'average private rating in December',
      status: 'Needs 10 private ratings a month.',
      primary: { label: 'Set goal', disabled: true },
      submission: null,
    })
    const typed = averageModel(ADD_SEAVIEW, '4,5')
    expect(typed).toMatchObject({
      number: {
        value: 4.5,
        valueText: '4.5 average private rating',
        lower: { label: 'Lower to 4.4', to: 4.4 },
        raise: { label: 'Raise to 4.6', to: 4.6 },
      },
      primary: { label: 'Set 4.5 for December', disabled: false },
      submission: {
        subject: { kind: 'property' },
        metric: 'portal_rating_average',
        targetValue: 4.5,
        startMonth: '2026-12',
        targetSource: 'own',
      },
    })
    for (const text of ['0.9', '5.1', '4.55', 'four']) {
      expect(averageModel(ADD_SEAVIEW, text).number.invalid).toBe(true)
    }
    expect(averageModel(ADD_SEAVIEW, '5').number.raise.to).toBeNull()
    expect(typed.submission && addedToast(ADD_SEAVIEW, typed.submission)).toBe(
      'Average private rating goal set: 4.5 for December',
    )
  })

  it('the box writes a whole count plainly and an average to tenths', () => {
    expect(committedText(' 22 ', false)).toBe('22')
    expect(committedText('4,5', true)).toBe('4.5')
    expect(committedText('4', true)).toBe('4.0')
    // What it cannot read stays as typed, for the box to say so.
    expect(committedText('four', true)).toBe('four')
    expect(committedText('2.5', false)).toBe('2.5')
  })
})
