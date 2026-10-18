import { describe, expect, it } from 'vitest'
import {
  ADD_AVERAGE_DISABLED,
  ADD_EACH_OCT_23,
  ADD_IDS,
  ADD_NOTHING,
  ADD_RECEPTION_HELD,
  ADD_SEAVIEW,
  ADD_THIS_MONTH,
} from './portal-goal-add.stories.fixtures'
import {
  addedToast,
  averageModel,
  chooseModel,
  numberModel,
  openingOf,
  portalGoalAddOffered,
  whichModel,
} from './portal-goal-add-view'
import {
  eachDraftOf,
  eachModel,
  eachToast,
  steppedEach,
} from './portal-goal-add-each-view'

const kinds = (options: typeof ADD_SEAVIEW) =>
  chooseModel(options, null).choices.map(({ kind, disabled }) => [kind, disabled])

describe('Add a portal goal, worded', () => {
  it('one portal and each portal need 2+ live portals', () => {
    expect(kinds(ADD_SEAVIEW)).toEqual([
      ['portal', false],
      ['each', false],
      ['group', false],
      ['average', false],
    ])
    // The read lists no Portal under 2 live ones: neither choice is drawn.
    expect(kinds({ ...ADD_SEAVIEW, onePortal: [], eachPortal: [] })).toEqual([
      ['group', false],
      ['average', false],
    ])
  })

  it('a group only when groups exist', () => {
    expect(kinds({ ...ADD_SEAVIEW, groups: [] }).map(([kind]) => kind)).not.toContain(
      'group',
    )
    expect(chooseModel(ADD_SEAVIEW, null).choices[2]).toMatchObject({
      title: 'A goal for a portal group',
      description: 'One number for the portals in a group.',
    })
  })

  it('the average is disabled with the 4-week fact under 10', () => {
    const average = chooseModel(ADD_AVERAGE_DISABLED, null).choices.at(-1)

    expect(average).toEqual({
      kind: 'average',
      title: 'Average private rating',
      description:
        'A level to hold for the whole property. Needs 10 private ratings a month.',
      disabled: true,
      fact: 'Your portals had 6 in the last 4 weeks.',
    })
    expect(chooseModel(ADD_SEAVIEW, null).choices.at(-1)).toMatchObject({
      disabled: false,
      fact: null,
    })
  })

  it('Next waits for an open choice', () => {
    expect(chooseModel(ADD_SEAVIEW, null).next).toEqual({ disabled: true })
    expect(chooseModel(ADD_SEAVIEW, 'portal').next).toEqual({ disabled: false })
    expect(chooseModel(ADD_AVERAGE_DISABLED, 'average').next).toEqual({ disabled: true })
  })

  it('each portal unticks a new portal with ready Oct 29', () => {
    const model = eachModel(ADD_EACH_OCT_23, eachDraftOf(ADD_EACH_OCT_23), new Set())

    expect(
      model.rows.map(({ name, ticked, number, note }) => [name, ticked, number, note]),
    ).toEqual([
      ['Reception', true, 26, null],
      ['Restaurant', true, 12, null],
      ['Spa', false, null, 'New · ready Oct 29'],
    ])
    expect(model.primary).toEqual({ label: 'Set 2 goals', disabled: false })
    expect(model.submission).toEqual({
      metric: 'portal_rating_count',
      startMonth: '2026-11',
      items: [
        { portalId: ADD_IDS.RECEPTION, targetValue: 26, targetSource: 'recommended' },
        { portalId: ADD_IDS.RESTAURANT, targetValue: 12, targetSource: 'recommended' },
      ],
    })
  })

  it('each portal steps along the grid, and a stepped number is its own', () => {
    const draft = steppedEach(eachDraftOf(ADD_EACH_OCT_23), ADD_IDS.RECEPTION, 29)
    const model = eachModel(ADD_EACH_OCT_23, draft, new Set())

    expect(model.rows[0]).toMatchObject({
      number: 29,
      lower: { label: 'Lower Reception to 28', to: 28 },
      raise: { label: 'Raise Reception to 30', to: 30 },
    })
    expect(model.submission?.items[0]).toEqual({
      portalId: ADD_IDS.RECEPTION,
      targetValue: 29,
      targetSource: 'own',
    })
  })

  it('a portal with a goal is disabled with Has a goal', () => {
    const which = whichModel(ADD_RECEPTION_HELD, 'portal', null)
    const each = eachModel(ADD_RECEPTION_HELD, eachDraftOf(ADD_RECEPTION_HELD), new Set())

    expect(which.description).toBe('Which portal?')
    expect(which.rows[0]).toMatchObject({
      name: 'Reception',
      disabled: true,
      note: 'Has a goal',
      held: { programId: 'c0000000-0000-4000-8000-000000000001' },
    })
    expect(each.rows[0]).toMatchObject({
      ticked: false,
      disabled: true,
      note: 'Has a goal',
    })
    expect(each.primary.label).toBe('Set 1 goal')
  })

  it('a row that was not saved says so, and the rest go on', () => {
    const model = eachModel(
      ADD_EACH_OCT_23,
      eachDraftOf(ADD_EACH_OCT_23),
      new Set([ADD_IDS.RESTAURANT]),
    )

    expect(model.rows[1]?.note).toBe('Not saved, try again')
    expect(eachToast(2)).toBe('2 portal goals set')
    expect(eachToast(1)).toBe('1 portal goal set')
  })

  it('nothing ticked sets no goal', () => {
    const draft = eachDraftOf(ADD_EACH_OCT_23)
    const none = Object.fromEntries(
      Object.entries(draft).map(([id, row]) => [id, { ...row, ticked: false }]),
    )

    expect(eachModel(ADD_EACH_OCT_23, none, new Set())).toMatchObject({
      primary: { label: 'Set goals', disabled: true },
      submission: null,
    })
  })

  it('one live portal and under 10 ratings: no More portal goals', () => {
    expect(portalGoalAddOffered(ADD_NOTHING)).toBe(false)
    expect(portalGoalAddOffered(ADD_AVERAGE_DISABLED)).toBe(true)
    expect(portalGoalAddOffered({ ...ADD_NOTHING, groups: ADD_SEAVIEW.groups })).toBe(
      true,
    )
    expect(
      portalGoalAddOffered({
        ...ADD_NOTHING,
        average: { available: true, last4Weeks: 12, heldBy: null },
      }),
    ).toBe(true)
  })

  it('the number step: Reception · December, its own usual, and Set 22 for December', () => {
    const [reception] = ADD_SEAVIEW.onePortal
    if (!reception) throw new Error('expected Reception')
    const model = numberModel(ADD_SEAVIEW, reception, '22')

    expect(model).toMatchObject({
      band: 'Reception · December',
      description: 'Starts on Dec 1.',
      unit: 'private ratings',
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
    expect(model.choices?.map(({ label }) => label)).toEqual([
      '20 · your usual',
      '22 · a bit more',
      '24 · stretch',
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
      band: 'December',
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

  it('an old link opens the step it names, with its subject when it is offered', () => {
    expect(openingOf(ADD_SEAVIEW, { add: 'choose' })).toEqual({
      step: 'choose',
      subject: null,
    })
    expect(
      openingOf(ADD_SEAVIEW, { add: 'portal', subject: `portal:${ADD_IDS.SPA}` }),
    ).toEqual({ step: 'portal', subject: `portal:${ADD_IDS.SPA}` })
    expect(
      openingOf(ADD_SEAVIEW, { add: 'group', subject: `portal_group:${ADD_IDS.ROOMS}` }),
    ).toEqual({ step: 'group', subject: `portal_group:${ADD_IDS.ROOMS}` })
    // A Portal this Property does not have, or a step it does not offer.
    expect(
      openingOf(ADD_SEAVIEW, { add: 'portal', subject: 'portal:elsewhere' }),
    ).toEqual({
      step: 'portal',
      subject: null,
    })
    expect(openingOf(ADD_NOTHING, { add: 'each' })).toEqual({
      step: 'choose',
      subject: null,
    })
    expect(openingOf(ADD_SEAVIEW, {})).toBeNull()
  })
})
