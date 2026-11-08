import { describe, expect, it } from 'vitest'
import type { GoalProgramBundle } from '#/contexts/reporting/application/ports/goal-program.repository'
import {
  actor,
  DEC_1,
  fakeWorld,
  NOV_1,
  PROPERTY_ID,
  propertyGoal,
  SEAVIEW_PORTALS,
} from '#/contexts/reporting/application/use-cases/monthly-portal-goal-test-fixtures'
import { readMonthlyPortalGoalPage } from '#/contexts/reporting/application/use-cases/monthly-portal-goal-page'
import { readPortalGoalSinglePage } from '#/contexts/reporting/monthly-goals/get-portal-goal-page.server'
import { stopWords } from './portal-goal-stop-view'

const JAN_1 = new Date('2026-12-31T22:00:00.000Z')
const BEFORE_MAINTENANCE = new Date('2026-11-30T22:10:00.000Z')
const AFTER_MAINTENANCE = new Date('2026-11-30T23:10:00.000Z')

const shapes = (
  ['portal_rating_count', 'qualified_scans', 'portal_rating_average'] as const
).flatMap((metric) =>
  (['property', 'portal', 'portal_group', 'several'] as const).map((subject) => ({
    metric,
    subject,
  })),
)

function programOf(
  shape: (typeof shapes)[number],
  opened: boolean,
  status: GoalProgramBundle['program']['status'] = 'active',
): GoalProgramBundle {
  const goal = propertyGoal('goal', shape.metric, {
    status,
    subject:
      shape.subject === 'property'
        ? { kind: 'property', propertyId: PROPERTY_ID }
        : shape.subject === 'portal_group'
          ? { kind: 'portal_group', portalGroupId: 'group-rooms' }
          : { kind: 'portal', portalId: 'portal-reception' },
    months:
      status === 'scheduled'
        ? []
        : [
            { start: NOV_1, end: DEC_1 },
            ...(opened ? [{ start: DEC_1, end: JAN_1 }] : []),
          ],
  })
  const version =
    shape.metric === 'portal_rating_average'
      ? { ...goal.version, targetValue: 4.5, metricMinimumSample: 10 }
      : goal.version
  const base = { ...goal, version, versions: [version] }
  if (shape.subject !== 'several') return base
  const first = base.assignments[0]
  if (!first) throw new Error('expected an assignment')
  const second = {
    ...first,
    id: 'second-subject',
    subject: { kind: 'portal_group', portalGroupId: 'group-rooms' } as const,
  }
  return {
    ...base,
    assignments: [first, second],
    results: [
      ...base.results,
      ...base.results.map((result) => ({
        ...result,
        id: `${result.id}-second`,
        assignmentId: second.id,
      })),
    ],
  }
}

async function pageGoal(deps: ReturnType<typeof fakeWorld>['deps'], opened: boolean) {
  const view = await readPortalGoalSinglePage(
    deps,
    { propertyId: PROPERTY_ID, programId: 'goal' },
    actor,
  )
  if (view.kind === 'several') expect(view.goal.live?.month ?? null).toBeNull()
  const goal =
    view.kind === 'monthly'
      ? (await readMonthlyPortalGoalPage(deps, { propertyId: PROPERTY_ID }, actor)).card
      : view.kind === 'subject'
        ? view.page.card
        : null
  const facts = goal === null ? null : goal.state === 'goal' ? goal.goal : null
  const shown =
    facts ?? (view.kind === 'average' || view.kind === 'several' ? view.goal : null)
  if (shown === null) throw new Error('expected a goal on its page')
  expect(shown.change?.now?.monthKey ?? null).toBe(opened ? '2026-12' : null)
  return {
    goal: shown,
    kind: view.kind === 'monthly' ? ('monthly' as const) : ('single' as const),
  }
}

describe.each(shapes)('Stop on the $subject $metric page', (shape) => {
  it.each([
    { phase: 'before', opened: false, now: BEFORE_MAINTENANCE },
    { phase: 'after', opened: true, now: AFTER_MAINTENANCE },
  ])(
    '$phase maintenance opens December, retains December through Dec 31',
    async ({ opened, now }) => {
      const { deps } = fakeWorld({
        now,
        portals: SEAVIEW_PORTALS,
        programs: [programOf(shape, opened)],
      })

      const { goal, kind } = await pageGoal(deps, opened)

      expect(stopWords(goal, kind).description).toBe(
        'December keeps counting to Dec 31 and keeps its result. You can set a new goal from January.',
      )
    },
  )

  it('a scheduled goal still frees its month immediately when maintenance is late', async () => {
    const { deps } = fakeWorld({
      now: BEFORE_MAINTENANCE,
      portals: SEAVIEW_PORTALS,
      programs: [programOf(shape, false, 'scheduled')],
    })

    const { goal, kind } = await pageGoal(deps, false)

    expect(stopWords(goal, kind).description).toBe(
      'November has not started, so nothing has counted yet. You can set a new goal straight away.',
    )
  })

  it('a paused goal retains November without opening December', async () => {
    const { deps } = fakeWorld({
      now: BEFORE_MAINTENANCE,
      portals: SEAVIEW_PORTALS,
      programs: [programOf(shape, false, 'paused')],
    })

    const { goal, kind } = await pageGoal(deps, false)

    expect(stopWords(goal, kind).description).toBe(
      'November keeps counting to Nov 30 and keeps its result. You can set a new goal from January.',
    )
  })
})

it('several-subject Stop retains December even when the live progress read fails', async () => {
  const { deps } = fakeWorld({
    now: BEFORE_MAINTENANCE,
    portals: SEAVIEW_PORTALS,
    programs: [programOf({ metric: 'portal_rating_count', subject: 'several' }, false)],
  })
  deps.metrics.queryGoalMetric.mockRejectedValue(new Error('progress unavailable'))

  const { goal, kind } = await pageGoal(deps, false)

  expect(stopWords(goal, kind).description).toBe(
    'December keeps counting to Dec 31 and keeps its result. You can set a new goal from January.',
  )
})
