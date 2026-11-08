import { describe, expect, it } from 'vitest'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import { GoalProgramError } from './goal-program-shared'
import {
  actor,
  DEC_1,
  fakeWorld,
  NOV_1,
  NOV_22,
  OCT_23,
  PROPERTY_ID,
  propertyGoal,
  SEAVIEW_PORTALS,
} from './monthly-portal-goal-test-fixtures'
import { readPortalGoalSinglePage } from '../../monthly-goals/get-portal-goal-page.server'

const OCT_1 = new Date('2026-09-30T21:00:00.000Z')

function severalGoal(shape: Parameters<typeof propertyGoal>[2] = {}): GoalProgramBundle {
  const base = propertyGoal('several-goal', 'portal_rating_count', {
    status: 'active',
    open: { start: NOV_1, end: DEC_1 },
    subject: { kind: 'portal', portalId: 'portal-reception' },
    ...shape,
  })
  const assignment = base.assignments[0]
  if (!assignment) throw new Error('expected a subject assignment')
  return {
    ...base,
    assignments: [
      assignment,
      {
        ...assignment,
        id: 'rooms-assignment',
        subject: { kind: 'portal_group', portalGroupId: 'group-rooms' },
      },
    ],
  }
}

const read = (deps: ReturnType<typeof fakeWorld>['deps']) =>
  readPortalGoalSinglePage(
    deps,
    { propertyId: PROPERTY_ID, programId: 'several-goal' },
    actor,
  )

describe('several-subject goal page acceptance', () => {
  it('names current subjects including unlisted portals, preserving closed assignment history', async () => {
    const previous = propertyGoal('several-goal', 'portal_rating_count', {
      from: OCT_1,
      until: NOV_1,
      subject: { kind: 'portal', portalId: 'portal-former' },
      months: [
        {
          start: OCT_1,
          end: NOV_1,
          status: 'closed',
          evaluation: {
            state: 'eligible',
            value: 45,
            sampleCount: 45,
            achieved: true,
          },
        },
      ],
    })
    const current = severalGoal()
    const version = { ...current.version, id: 'several-goal-v2', version: 2 }
    const bundle: GoalProgramBundle = {
      ...current,
      program: { ...current.program, currentVersion: 2 },
      version,
      versions: [previous.version, version],
      assignments: [
        ...previous.assignments,
        ...current.assignments.map((assignment) => ({
          ...assignment,
          id: `${assignment.id}-v2`,
          programVersionId: version.id,
        })),
        {
          ...current.assignments[0]!,
          id: 'archived-assignment',
          programVersionId: version.id,
          subject: { kind: 'portal', portalId: 'portal-archived' },
        },
      ],
      results: previous.results,
    }
    const before = structuredClone(bundle)
    const { deps } = fakeWorld({
      now: NOV_22,
      portals: SEAVIEW_PORTALS,
      programs: [bundle],
      subjectNames: {
        'portal:portal-former': 'Former reception',
        'portal:portal-archived': 'Old lobby',
        'portal_group:group-rooms': 'Rooms',
      },
    })

    const view = await read(deps)

    expect(view).toMatchObject({
      kind: 'several',
      subjects: [
        { kind: 'portal', key: 'portal:portal-reception', name: 'Reception' },
        { kind: 'portal_group', key: 'portal_group:group-rooms', name: 'Rooms' },
        { kind: 'portal', key: 'portal:portal-archived', name: 'Old lobby' },
      ],
    })
    expect(bundle).toEqual(before)
  })

  it('a hidden goal is refused before its subjects or progress are read', async () => {
    const { deps } = fakeWorld({ programs: [severalGoal()] })
    deps.reads.get.mockRejectedValueOnce(new GoalProgramError('not_found'))

    await expect(read(deps)).rejects.toMatchObject({ code: 'not_found' })

    expect(deps.recommendation.facts.listPortalReadiness).not.toHaveBeenCalled()
    expect(deps.subjectNames.getSubjectName).not.toHaveBeenCalled()
    expect(deps.metrics.queryGoalMetric).not.toHaveBeenCalled()
  })

  it('a scheduled goal names its first day without retaining an unstarted month', async () => {
    const { deps } = fakeWorld({
      now: OCT_23,
      programs: [severalGoal({ status: 'scheduled', open: undefined })],
    })

    await expect(read(deps)).resolves.toMatchObject({
      kind: 'several',
      goal: {
        status: 'scheduled',
        startsOn: '2026-11-01',
        countingMonth: null,
        live: null,
      },
    })
    expect(deps.metrics.queryGoalMetric).not.toHaveBeenCalled()
  })

  it('a stopped goal retains its open month and recorded stop day', async () => {
    const { deps } = fakeWorld({
      now: NOV_22,
      programs: [
        severalGoal({
          status: 'ended',
          until: DEC_1,
          endedAt: new Date('2026-11-12T10:00:00.000Z'),
          endedBy: 'elena',
        }),
      ],
    })

    await expect(read(deps)).resolves.toMatchObject({
      kind: 'several',
      goal: {
        status: 'ended',
        endedOn: '2026-11-12',
        countingMonth: { key: '2026-11' },
        change: null,
        live: null,
      },
    })
  })

  it('failed progress preserves names and the month Stop must retain', async () => {
    const { deps } = fakeWorld({
      now: new Date('2026-11-30T22:10:00.000Z'),
      portals: SEAVIEW_PORTALS,
      programs: [severalGoal()],
      subjectNames: { 'portal_group:group-rooms': 'Rooms' },
    })
    deps.metrics.queryGoalMetric.mockRejectedValue(new Error('progress unavailable'))

    await expect(read(deps)).resolves.toMatchObject({
      kind: 'several',
      subjects: [{ name: 'Reception' }, { name: 'Rooms' }],
      goal: { live: null, countingMonth: { key: '2026-12' } },
    })
    expect(deps.logger.warn).toHaveBeenCalledOnce()
  })
})
