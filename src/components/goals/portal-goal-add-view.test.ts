import { describe, expect, it } from 'vitest'
import {
  ADD_AVERAGE_DISABLED,
  ADD_EACH_OCT_23,
  ADD_IDS,
  ADD_NOTHING,
  ADD_RECEPTION_HELD,
  ADD_SEAVIEW,
} from './portal-goal-add.stories.fixtures'
import {
  chooseModel,
  numberOfferOf,
  openingOf,
  portalGoalAddOffered,
  whichModel,
} from './portal-goal-add-view'
import type {
  PortalGoalAddOffer,
  PortalGoalAddOptions,
} from '#/contexts/reporting/application/dto/monthly-portal-goal-add.types'
import {
  eachDraftOf,
  eachModel,
  eachToast,
  steppedEach,
} from './portal-goal-add-each-view'

const kinds = (options: typeof ADD_SEAVIEW) =>
  chooseModel(options, null).choices.map(({ kind, disabled }) => [kind, disabled])

const HELD = { programId: 'c0000000-0000-4000-8000-000000000009', name: 'A goal' }
const held = (offer: PortalGoalAddOffer): PortalGoalAddOffer => ({
  ...offer,
  heldBy: HELD,
})

/** Every Portal and group has a goal already, as after "A goal for each portal". */
const allHeld = (options: PortalGoalAddOptions): PortalGoalAddOptions => ({
  ...options,
  onePortal: options.onePortal.map(held),
  eachPortal: options.eachPortal.map((row) => ({
    ...row,
    offer: held(row.offer),
    ticked: false,
  })),
  groups: options.groups.map(held),
})

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
      held: null,
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

  it('every portal has a goal, nothing else open: no door', () => {
    const taken = allHeld(ADD_AVERAGE_DISABLED)

    expect(portalGoalAddOffered(taken)).toBe(false)
    // Nothing left to pick for one Portal or each: those choices are not drawn.
    expect(kinds(taken)).toEqual([['average', true]])
    expect(openingOf(taken, { add: 'choose' })).toBeNull()
    // A group that has a goal closes its choice the same way.
    expect(kinds(allHeld(ADD_SEAVIEW))).toEqual([['average', false]])
    expect(portalGoalAddOffered({ ...taken, groups: ADD_SEAVIEW.groups })).toBe(true)
  })

  it('one portal still open keeps both portal choices', () => {
    expect(kinds(ADD_RECEPTION_HELD).slice(0, 2)).toEqual([
      ['portal', false],
      ['each', false],
    ])
  })

  it('a held average links to its goal', () => {
    const average = chooseModel(
      { ...ADD_SEAVIEW, average: { available: true, last4Weeks: 40, heldBy: HELD } },
      null,
    ).choices.at(-1)

    expect(average).toMatchObject({ disabled: true, fact: 'Has a goal', held: HELD })
    expect(chooseModel(ADD_SEAVIEW, null).choices.at(-1)).toMatchObject({ held: null })
  })

  it('a subject taken a moment ago leaves the number step for its list', () => {
    const reception = `portal:${ADD_IDS.RECEPTION}`
    const restaurant = `portal:${ADD_IDS.RESTAURANT}`

    // The read again after a refusal: Reception has a goal now.
    expect(numberOfferOf(ADD_RECEPTION_HELD, reception)).toBeNull()
    expect(numberOfferOf(ADD_RECEPTION_HELD, restaurant)?.name).toBe('Restaurant')
    expect(numberOfferOf(ADD_RECEPTION_HELD, 'portal:elsewhere')).toBeNull()
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
    expect(
      openingOf({ ...ADD_SEAVIEW, onePortal: [], eachPortal: [] }, { add: 'each' }),
    ).toEqual({ step: 'choose', subject: null })
    expect(openingOf(ADD_SEAVIEW, {})).toBeNull()
  })

  it('an address opens nothing when nothing can be added, and never picks a held subject', () => {
    // One live Portal and 6 private ratings: /goals/new's ?add=choose opens no sheet.
    expect(openingOf(ADD_NOTHING, { add: 'choose' })).toBeNull()
    expect(
      openingOf(ADD_NOTHING, { add: 'portal', subject: `portal:${ADD_IDS.RECEPTION}` }),
    ).toBeNull()
    // Reception has a goal: the list opens with nothing picked, its row says so.
    expect(
      openingOf(ADD_RECEPTION_HELD, {
        add: 'portal',
        subject: `portal:${ADD_IDS.RECEPTION}`,
      }),
    ).toEqual({ step: 'portal', subject: null })
  })
})
