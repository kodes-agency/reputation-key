import { describe, expect, it } from 'vitest'
import type {
  GoalMonthTargetChange,
  GoalProgramBundle,
} from '../ports/goal-program.repository'
import type { RecommendationDayCount } from '../../domain/goal-recommendation-types'
import {
  gatherMonthlyPortalGoal,
  readMonthlyPortalGoalCard,
} from './monthly-portal-goal-card'
import { monthlyPortalGoalCheckInOf } from './monthly-portal-goal-check-in'
import {
  DEC_1,
  NOV_1,
  PROPERTY_ID,
  SEAVIEW_PORTALS,
  actor,
  days,
  fakeWorld,
  goalOf,
  governed,
  propertyGoal,
  readings,
  type MonthShape,
} from './monthly-portal-goal-test-fixtures'

const DEC_31 = new Date('2026-12-31T22:00:00.000Z')
/** Dec 1, noon in Sofia. */
const DEC_1_NOON = new Date('2026-12-01T10:00:00.000Z')

/**
 * G4: the 4 weeks to Nov 30 at Reception, Restaurant and Spa brought in 34
 * private ratings (15, 9 and 10), so a 31-day December gets about 38: 40 · 45
 * · 50, with 45 recommended.
 */
const NOVEMBER_RATINGS: RecommendationDayCount[] = [
  ...readings('portal-reception', 'portal_rating_count', days('2026-11-03', 15)),
  ...readings('portal-restaurant', 'portal_rating_count', days('2026-11-03', 9)),
  ...readings('portal-spa', 'portal_rating_count', days('2026-11-03', 10)),
]

const NOVEMBER: MonthShape = { start: NOV_1, end: DEC_1, status: 'reconciling' }

/** Running since November at 40; November is being read and December has opened. */
const runningSinceNovember = (december: Partial<MonthShape> = {}) =>
  propertyGoal('monthly', 'portal_rating_count', {
    status: 'active',
    months: [NOVEMBER, { start: DEC_1, end: DEC_31, ...december }],
  })

/** The card's check-in, read at `now` over Seaview's Portals. */
async function checkInAt(
  now: Date,
  programs: readonly GoalProgramBundle[] = [runningSinceNovember()],
  counts: readonly RecommendationDayCount[] = NOVEMBER_RATINGS,
) {
  const { deps } = fakeWorld({
    now,
    portals: SEAVIEW_PORTALS,
    counts: { days: counts },
    programs,
    figures: { [NOV_1.toISOString()]: governed(36) },
  })
  return goalOf(await readMonthlyPortalGoalCard(deps, { propertyId: PROPERTY_ID }, actor))
    .checkIn
}

const answered = (bundle: GoalProgramBundle, month: string): GoalProgramBundle => ({
  ...bundle,
  program: { ...bundle.program, checkInAnsweredMonth: month },
})

/** A change of one month's own number, made at `at`. */
const changeOf = (monthlyResultId: string, at: Date): GoalMonthTargetChange => ({
  id: `change-${monthlyResultId}`,
  organizationId: 'org-1',
  propertyId: PROPERTY_ID,
  programId: 'monthly',
  monthlyResultId,
  changeId: `change-${monthlyResultId}`,
  previousTargetValue: 40,
  newTargetValue: 42,
  followingOutcome: 'applied',
  followingReason: null,
  followingVersionId: null,
  note: null,
  createdBy: 'elena',
  createdAt: at,
})

describe("the card's month-start check-in", () => {
  it('Dec 1: Use 45 for a goal of 40, worked out for a whole 31-day December (G4)', async () => {
    await expect(checkInAt(DEC_1_NOON)).resolves.toMatchObject({
      kind: 'offer',
      month: '2026-12',
      measure: 'portal_rating_count',
      target: 40,
      offer: {
        month: '2026-12',
        // The whole month, not the rest of it on top of what already counts.
        current: false,
        days: 31,
        measure: 'portal_rating_count',
        choices: { usual: 40, aBitMore: 45, stretch: 50 },
        usualAbout: 38,
        // 34 in 28 live days, for 31 days.
        usualExact: { num: '527', den: '14' },
        basis: {
          weeks: 4,
          days: 28,
          lastDay: '2026-11-30',
          count: 34,
          portals: [
            { name: 'Reception', count: 15, liveDays: 28 },
            { name: 'Restaurant', count: 9, liveDays: 28 },
            { name: 'Spa', count: 10, liveDays: 28 },
          ],
        },
        newPortals: [],
        soFar: null,
        rest: null,
        timezone: 'Europe/Sofia',
      },
    })
  })

  it('Dec 1 with ratings in already: the rest of December, on top of them', async () => {
    // Two came in this morning: December is no longer all ahead.
    const today = readings('portal-reception', 'portal_rating_count', ['2026-12-01'], 2)

    const checkIn = await checkInAt(DEC_1_NOON, undefined, [
      ...NOVEMBER_RATINGS,
      ...today,
    ])

    expect(checkIn).toMatchObject({
      kind: 'offer',
      offer: {
        current: true,
        choices: { usual: 40, aBitMore: 45, stretch: 50 },
        usualAbout: 38,
        soFar: 2,
        rest: { daysLeft: 31, about: 38 },
      },
    })
  })

  it('Dec 3: Use is the number the change sheet offers for December now, not a whole month’s', async () => {
    // The 4 weeks to Dec 2 brought in 28 (13, 7 and 8), and nothing counts in
    // December yet: the 29 days left give 29 · 35 · 40, so Use 35. A whole
    // 31-day December would be 35 · 40 · 45, and 40 is the goal's already.
    const { deps } = fakeWorld({
      now: new Date('2026-12-03T10:00:00.000Z'),
      portals: SEAVIEW_PORTALS,
      counts: { days: NOVEMBER_RATINGS },
      programs: [runningSinceNovember()],
      figures: { [NOV_1.toISOString()]: governed(36) },
    })

    const card = await readMonthlyPortalGoalCard(deps, { propertyId: PROPERTY_ID }, actor)

    if (card.state !== 'goal') throw new Error('expected a goal')
    expect(card.goal.checkIn).toMatchObject({
      kind: 'offer',
      target: 40,
      offer: {
        current: true,
        choices: { usual: 29, aBitMore: 35, stretch: 40 },
        soFar: 0,
        rest: { daysLeft: 29, about: 29 },
      },
    })
    // One recommended number for the month: what "Other number" opens on.
    expect(card.goal.checkIn).toMatchObject({
      offer: card.sheet.offers.portal_rating_count.current,
    })
  })

  it('on days 1 to 7 only', async () => {
    // 23:59 on Dec 7 in Sofia, then midnight.
    await expect(checkInAt(new Date('2026-12-07T21:59:00.000Z'))).resolves.toMatchObject({
      kind: 'offer',
    })
    await expect(checkInAt(new Date('2026-12-07T22:00:00.000Z'))).resolves.toBeNull()
  })

  it("Keep answers it for the month it was kept, and last month's answer does not", async () => {
    await expect(
      checkInAt(DEC_1_NOON, [answered(runningSinceNovember(), '2026-12')]),
    ).resolves.toBeNull()
    await expect(
      checkInAt(DEC_1_NOON, [answered(runningSinceNovember(), '2026-11')]),
    ).resolves.toMatchObject({ kind: 'offer' })
  })

  it("a change of December's own number answers it; November's does not", async () => {
    const goal = runningSinceNovember()
    // The goal's months are `monthly-m1` (November) and `monthly-m2` (December).
    const changedDecember = {
      ...goal,
      targetChanges: [changeOf('monthly-m2', new Date('2026-12-01T08:00:00.000Z'))],
    }
    const changedNovember = {
      ...goal,
      targetChanges: [changeOf('monthly-m1', new Date('2026-11-20T08:00:00.000Z'))],
    }

    await expect(checkInAt(DEC_1_NOON, [changedDecember])).resolves.toBeNull()
    await expect(checkInAt(DEC_1_NOON, [changedNovember])).resolves.toMatchObject({
      kind: 'offer',
    })
  })

  it("not in the goal's first month", async () => {
    // Set on Nov 25 for December: December is its first month.
    const fromDecember = propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      from: DEC_1,
      months: [{ start: DEC_1, end: DEC_31 }],
    })

    await expect(checkInAt(DEC_1_NOON, [fromDecember])).resolves.toBeNull()
  })

  it('same number is a line, not a choice', async () => {
    await expect(
      checkInAt(DEC_1_NOON, [runningSinceNovember({ target: 45 })]),
    ).resolves.toEqual({
      kind: 'same',
      month: '2026-12',
      measure: 'portal_rating_count',
      target: 45,
    })
  })

  it('nothing counted over the basis keeps Keep and another number, with its weeks', async () => {
    await expect(checkInAt(DEC_1_NOON, undefined, [])).resolves.toEqual({
      kind: 'nothing',
      month: '2026-12',
      measure: 'portal_rating_count',
      target: 40,
      weeks: 4,
    })
  })

  it('a recommendation that cannot be read asks nothing', async () => {
    const { deps } = fakeWorld({
      now: DEC_1_NOON,
      portals: SEAVIEW_PORTALS,
      counts: {
        days: NOVEMBER_RATINGS,
        unreadable: [
          {
            portalId: 'portal-reception',
            measure: 'portal_rating_count',
            localDay: '2026-11-10',
          },
        ],
      },
      programs: [runningSinceNovember()],
    })

    const card = await readMonthlyPortalGoalCard(deps, { propertyId: PROPERTY_ID }, actor)

    expect(goalOf(card).checkIn).toBeNull()
  })

  it('never offers a number at or below what already counts', async () => {
    // Dec 3: Reception brought in 20 on each of Dec 1 and 2 (the 40 of the
    // basis) and 30 today, so 70 already count: more than the 50 a whole
    // December would be. The rest of it, on top of the 70: 120 · 130 · 140.
    const busy: RecommendationDayCount[] = [
      ...readings(
        'portal-reception',
        'portal_rating_count',
        ['2026-12-01', '2026-12-02'],
        20,
      ),
      ...readings('portal-reception', 'portal_rating_count', ['2026-12-03'], 30),
    ]

    const checkIn = await checkInAt(
      new Date('2026-12-03T10:00:00.000Z'),
      [runningSinceNovember()],
      busy,
    )

    expect(checkIn).toMatchObject({
      kind: 'offer',
      offer: {
        current: true,
        choices: { usual: 120, aBitMore: 130, stretch: 140 },
        soFar: 70,
        rest: { daysLeft: 29, about: 41 },
      },
    })
  })

  it('a stopped goal asks nothing', async () => {
    const stopped = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      until: DEC_31,
      endedAt: new Date('2026-11-30T23:00:00.000Z'),
      months: [NOVEMBER, { start: DEC_1, end: DEC_31 }],
    })

    await expect(checkInAt(DEC_1_NOON, [stopped])).resolves.toBeNull()
  })

  it('asks nothing before December is opened: Use could not change it', async () => {
    // 00:30 on Dec 1: December counts, but its month has not been opened yet.
    const opening = propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      months: [NOVEMBER],
    })

    await expect(
      checkInAt(new Date('2026-11-30T22:30:00.000Z'), [opening]),
    ).resolves.toBeNull()
  })

  it('asks only about the month the change facts name, the one shown', async () => {
    const { deps } = fakeWorld({
      now: DEC_1_NOON,
      portals: SEAVIEW_PORTALS,
      counts: { days: NOVEMBER_RATINGS },
      programs: [runningSinceNovember()],
    })
    const gathered = await gatherMonthlyPortalGoal(
      deps,
      { propertyId: PROPERTY_ID },
      actor,
    )
    const card = goalOf(
      await readMonthlyPortalGoalCard(deps, { propertyId: PROPERTY_ID }, actor),
    )
    if (gathered.goal === null || card.month === null) throw new Error('expected a goal')
    const context = {
      recommendation: gathered.recommendation,
      now: DEC_1_NOON,
      month: card.month,
      change: card.change,
    }

    expect(monthlyPortalGoalCheckInOf(gathered.goal, context)).toMatchObject({
      kind: 'offer',
      month: '2026-12',
    })
    // A card that shows another month than the one a change now is for asks nothing.
    expect(
      monthlyPortalGoalCheckInOf(gathered.goal, {
        ...context,
        month: { ...card.month, key: '2026-11' },
      }),
    ).toBeNull()
    expect(
      monthlyPortalGoalCheckInOf(gathered.goal, { ...context, change: null }),
    ).toBeNull()
  })
})
