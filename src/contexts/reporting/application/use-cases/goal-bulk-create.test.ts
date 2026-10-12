// createGoalsForSubjects saves the table that sets goals for several portals:
// one goal per row, each through createGoalCore (whose own cases are in
// goal-program-create.test.ts). These cases pin what the save adds: one
// authorisation, one start month for every row, a name per goal, and an
// outcome per row that never holds back the others.
import { describe, expect, it, vi } from 'vitest'
import {
  goalSubjectIdentity,
  type GoalMetric,
  type GoalSubject,
} from '../../domain/goal-program'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import { assignmentHoldsFrom } from '../goal-subject-holds'
import type {
  GoalAssignmentConflict,
  GoalProgramBundle,
} from '../ports/goal-program.repository'
import {
  createGoalsForSubjects,
  type GoalBulkCreateDependencies,
  type GoalBulkCreateInput,
} from './goal-bulk-create'
import { GoalProgramError, type GoalActor } from './goal-program-shared'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}
const PROPERTY_ID = 'property-1'
const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
const UTC_MARCH = {
  start: new Date('2026-03-01T00:00:00.000Z'),
  end: new Date('2026-04-01T00:00:00.000Z'),
}
const UTC_APRIL_START = new Date('2026-04-01T00:00:00.000Z')

const lobby: GoalSubject = { kind: 'portal', portalId: 'portal-lobby' }
const bar: GoalSubject = { kind: 'portal', portalId: 'portal-bar' }
const spa: GoalSubject = { kind: 'portal', portalId: 'portal-spa' }
const northWing: GoalSubject = { kind: 'portal_group', portalGroupId: 'group-north' }
const NAMES: Readonly<Record<string, string>> = {
  'portal:portal-lobby': 'Lobby',
  'portal:portal-bar': 'Rooftop bar',
  'portal:portal-spa': 'Spa',
  'portal_group:group-north': 'North wing',
}

const updating = {
  definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
  metricKey: 'portal.rating_count',
  state: 'updating',
  exactValue: 0,
  sampleCount: 0,
  minimumSample: 0,
  sourceCompleteThrough: null,
  reason: 'source_reconciling',
}

/**
 * The fakes keep what was saved and answer the conflict check from it, by the
 * rule the database enforces, so a second save meets the goals of the first.
 * `instants` is what the clock reads, one per call; the last one repeats.
 */
function setup(instants: readonly Date[] = [MID_MARCH]) {
  const saved: GoalProgramBundle[] = []
  const pending = [...instants]
  let id = 0
  const fakes = {
    repository: {
      create: vi.fn(async ({ bundle }: { bundle: GoalProgramBundle }) => {
        saved.push(bundle)
        return 'created' as const
      }),
      findAssignmentConflicts: vi.fn(
        async (query: {
          metric: GoalMetric
          effectiveFrom: Date
          subjects: readonly GoalSubject[]
        }): Promise<readonly GoalAssignmentConflict[]> => {
          const asked = new Set(query.subjects.map(goalSubjectIdentity))
          return saved
            .flatMap((bundle) => bundle.assignments)
            .filter(
              (assignment) =>
                assignment.metric === query.metric &&
                asked.has(goalSubjectIdentity(assignment.subject)) &&
                assignmentHoldsFrom(assignment, query.effectiveFrom),
            )
            .map((assignment) => ({
              subject: assignment.subject,
              programId: assignment.programId,
              effectiveTo: assignment.effectiveTo,
            }))
        },
      ),
    },
    policy: { authorize: vi.fn(async () => undefined) },
    subjects: {
      getTimezone: vi.fn(async (): Promise<string | null> => 'UTC'),
      subjectBelongsToProperty: vi.fn(async () => true),
    },
    subjectNames: {
      getSubjectName: vi.fn(
        async (
          _organizationId: string,
          _propertyId: string,
          subject: GoalSubject,
        ): Promise<string | null> => NAMES[goalSubjectIdentity(subject)] ?? null,
      ),
    },
    metrics: {
      queryGoalMetric: vi.fn(async () => updating),
      getApprovedGoalVersion: vi.fn(async (versionId: string) => ({
        definition: { id: `definition-${versionId}` },
        version: {
          id: versionId,
          minimumSample:
            versionId === METRIC_VERSION_IDS.portalRatingAverageGoal ? 10 : 0,
        },
      })),
    },
    logger: { error: vi.fn() },
    id: () => `id-${++id}`,
    now: vi.fn(() => {
      const next = pending.length > 1 ? pending.shift() : pending[0]
      if (!next) throw new Error('the clock has no instant to read')
      return next
    }),
  }
  return {
    fakes,
    saved,
    deps: fakes as unknown as GoalBulkCreateDependencies,
  }
}

const save = (
  items: GoalBulkCreateInput['items'],
  patch: Partial<GoalBulkCreateInput> = {},
): GoalBulkCreateInput => ({
  propertyId: PROPERTY_ID,
  metric: 'portal_rating_count',
  startMonth: '2026-03',
  items,
  ...patch,
})

const row = (subject: GoalSubject, targetValue = 25) => ({ subject, targetValue })

describe('createGoalsForSubjects', () => {
  it('creates one goal per filled row', async () => {
    const { fakes, saved, deps } = setup()

    const result = await createGoalsForSubjects(
      deps,
      save([row(lobby, 40), row(northWing, 120), row(bar, 15)]),
      actor,
    )

    expect(saved).toHaveLength(3)
    expect(result.outcomes).toEqual([
      { subject: lobby, code: 'created', programId: saved[0]?.program.id },
      { subject: northWing, code: 'created', programId: saved[1]?.program.id },
      { subject: bar, code: 'created', programId: saved[2]?.program.id },
    ])
    expect(new Set(saved.map((bundle) => bundle.program.id)).size).toBe(3)
    // Each goal is its own Program with the one subject of its row.
    expect(
      saved.map((bundle) => [
        bundle.assignments.map((assignment) => assignment.subject),
        bundle.version.targetValue,
        bundle.version.metric,
      ]),
    ).toEqual([
      [[lobby], 40, 'portal_rating_count'],
      [[northWing], 120, 'portal_rating_count'],
      [[bar], 15, 'portal_rating_count'],
    ])
    // Each is its own write: a refusal of one cannot undo another.
    expect(fakes.repository.create).toHaveBeenCalledTimes(3)
  })

  it('names each goal after its subject and the measure', async () => {
    const { saved, deps } = setup()

    await createGoalsForSubjects(deps, save([row(lobby), row(northWing)]), actor)
    await createGoalsForSubjects(
      deps,
      save([row(bar, 4.5)], { metric: 'portal_rating_average' }),
      actor,
    )

    expect(saved.map((bundle) => bundle.program.name)).toEqual([
      'Lobby · Private ratings',
      'North wing · Private ratings',
      'Rooftop bar · Private rating average',
    ])
  })

  it('keeps the measure in a name cut to 200 characters', async () => {
    const { fakes, saved, deps } = setup()
    fakes.subjectNames.getSubjectName.mockResolvedValueOnce(`${'L'.repeat(240)}  `)

    await createGoalsForSubjects(
      deps,
      save([row(lobby, 300)], { metric: 'qualified_scans' }),
      actor,
    )

    const name = saved[0]?.program.name ?? ''
    expect(name).toHaveLength(200)
    expect(name).toBe(`${'L'.repeat(182)} · Qualified scans`)
  })

  it('authorises goal.create once for the whole save', async () => {
    const { fakes, deps } = setup()

    await createGoalsForSubjects(deps, save([row(lobby), row(bar), row(spa)]), actor)

    expect(fakes.policy.authorize).toHaveBeenCalledExactlyOnceWith({
      actor,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
  })

  it('reads and saves nothing for someone who may not create goals', async () => {
    const { fakes, deps } = setup()
    fakes.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(
      createGoalsForSubjects(deps, save([row(lobby)]), actor),
    ).rejects.toMatchObject({ code: 'forbidden' })

    expect(fakes.subjects.getTimezone).not.toHaveBeenCalled()
    expect(fakes.subjectNames.getSubjectName).not.toHaveBeenCalled()
    expect(fakes.repository.create).not.toHaveBeenCalled()
  })

  it('a row whose subject already has a goal is reported and the others are saved', async () => {
    const { saved, deps } = setup()
    await createGoalsForSubjects(deps, save([row(bar, 10)]), actor)

    const result = await createGoalsForSubjects(
      deps,
      save([row(lobby), row(bar, 99), row(spa)]),
      actor,
    )

    expect(result.outcomes).toEqual([
      { subject: lobby, code: 'created', programId: saved[1]?.program.id },
      { subject: bar, code: 'subject_has_goal' },
      { subject: spa, code: 'created', programId: saved[2]?.program.id },
    ])
    // The goal the bar already had keeps its own target.
    expect(saved).toHaveLength(3)
    expect(saved[0]?.version.targetValue).toBe(10)
  })

  it('a subject with a goal for another measure still gets its goal', async () => {
    const { deps } = setup()
    await createGoalsForSubjects(deps, save([row(lobby)]), actor)

    const result = await createGoalsForSubjects(
      deps,
      save([row(lobby, 300)], { metric: 'qualified_scans' }),
      actor,
    )

    expect(result.outcomes).toEqual([expect.objectContaining({ code: 'created' })])
  })

  it('a repeated submit creates nothing new', async () => {
    const { fakes, saved, deps } = setup()
    const input = save([row(lobby), row(northWing), row(bar)])

    await createGoalsForSubjects(deps, input, actor)
    const again = await createGoalsForSubjects(deps, input, actor)

    expect(again.outcomes).toEqual([
      { subject: lobby, code: 'subject_has_goal' },
      { subject: northWing, code: 'subject_has_goal' },
      { subject: bar, code: 'subject_has_goal' },
    ])
    expect(saved).toHaveLength(3)
    expect(fakes.repository.create).toHaveBeenCalledTimes(3)
  })

  it('refuses more than 50 rows', async () => {
    const { fakes, deps } = setup()
    const rows = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        row({ kind: 'portal', portalId: `portal-${index}` }),
      )

    await expect(
      createGoalsForSubjects(deps, save(rows(51)), actor),
    ).rejects.toMatchObject({ code: 'assignment_limit_exceeded' })

    expect(fakes.subjects.getTimezone).not.toHaveBeenCalled()
    expect(fakes.repository.create).not.toHaveBeenCalled()
  })

  it('saves as many as 50 rows', async () => {
    const { fakes, saved, deps } = setup()
    fakes.subjectNames.getSubjectName.mockImplementation(
      async (_organizationId, _propertyId, subject) =>
        subject.kind === 'portal' ? `Portal ${subject.portalId}` : null,
    )
    const rows = Array.from({ length: 50 }, (_, index) =>
      row({ kind: 'portal', portalId: `portal-${index}` }),
    )

    const result = await createGoalsForSubjects(deps, save(rows), actor)

    expect(saved).toHaveLength(50)
    expect(result.outcomes.every((outcome) => outcome.code === 'created')).toBe(true)
  })

  it('refuses a Property subject', async () => {
    const { fakes, deps } = setup()

    await expect(
      createGoalsForSubjects(
        deps,
        save([row(lobby), row({ kind: 'property', propertyId: PROPERTY_ID })]),
        actor,
      ),
    ).rejects.toMatchObject({ code: 'invalid_subject' })

    // The whole save is refused: the valid row before it is not saved either.
    expect(fakes.repository.create).not.toHaveBeenCalled()
  })

  it('refuses a subject that fills two rows', async () => {
    const { fakes, deps } = setup()

    await expect(
      createGoalsForSubjects(
        deps,
        save([row(lobby, 10), row(bar), row(lobby, 20)]),
        actor,
      ),
    ).rejects.toMatchObject({ code: 'duplicate_subject' })

    expect(fakes.repository.create).not.toHaveBeenCalled()
  })

  it('refuses a save with no rows', async () => {
    const { fakes, deps } = setup()

    await expect(createGoalsForSubjects(deps, save([]), actor)).rejects.toMatchObject({
      code: 'invalid_subject',
    })

    expect(fakes.subjects.getTimezone).not.toHaveBeenCalled()
  })

  // The clock moves on between rows (each row reads the metric and writes),
  // and the month and the instant the goals were set must not move with it.
  it('every row gets the same start month', async () => {
    const later = (seconds: number) => new Date(MID_MARCH.getTime() + seconds * 1_000)
    const { fakes, saved, deps } = setup([MID_MARCH, later(2), later(5), later(9)])

    await createGoalsForSubjects(deps, save([row(lobby), row(bar), row(spa)]), actor)

    expect(saved).toHaveLength(3)
    for (const bundle of saved) {
      expect(bundle.version.effectiveFrom).toEqual(UTC_MARCH.start)
      expect(bundle.assignments[0]?.effectiveFrom).toEqual(UTC_MARCH.start)
      expect(bundle.program).toMatchObject({ status: 'active', createdAt: MID_MARCH })
      expect(bundle.results).toEqual([
        expect.objectContaining({
          periodStart: UTC_MARCH.start,
          periodEnd: UTC_MARCH.end,
        }),
      ])
    }
    // One reading resolves the month; one more per row checks it is still on.
    expect(fakes.now).toHaveBeenCalledTimes(4)
  })

  it('goals set for next month all wait for it', async () => {
    const { saved, deps } = setup()

    const result = await createGoalsForSubjects(
      deps,
      save([row(lobby), row(northWing)], { startMonth: '2026-04' }),
      actor,
    )

    expect(result.outcomes.map((outcome) => outcome.code)).toEqual(['created', 'created'])
    for (const bundle of saved) {
      expect(bundle.version.effectiveFrom).toEqual(UTC_APRIL_START)
      expect(bundle.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(bundle.results).toEqual([])
    }
  })

  it('refuses the whole save when its month is no longer offered', async () => {
    const { fakes, deps } = setup()

    await expect(
      createGoalsForSubjects(deps, save([row(lobby)], { startMonth: '2026-02' }), actor),
    ).rejects.toMatchObject({ code: 'start_month_changed' })
    await expect(
      createGoalsForSubjects(deps, save([row(lobby)], { startMonth: '2026-05' }), actor),
    ).rejects.toMatchObject({ code: 'start_month_changed' })

    expect(fakes.subjectNames.getSubjectName).not.toHaveBeenCalled()
    expect(fakes.repository.create).not.toHaveBeenCalled()
  })

  // 00:30 on 1 April in Sofia is still 31 March in UTC.
  it('reads the month on the Property’s calendar, not the UTC one', async () => {
    const sofiaFirstOfApril = new Date('2026-03-31T21:30:00.000Z')
    const { fakes, saved, deps } = setup([sofiaFirstOfApril])
    fakes.subjects.getTimezone.mockResolvedValue('Europe/Sofia')

    await expect(
      createGoalsForSubjects(deps, save([row(lobby)], { startMonth: '2026-03' }), actor),
    ).rejects.toMatchObject({ code: 'start_month_changed' })
    await createGoalsForSubjects(
      deps,
      save([row(lobby)], { startMonth: '2026-04' }),
      actor,
    )

    expect(saved[0]?.version).toMatchObject({
      effectiveFrom: new Date('2026-03-31T21:00:00.000Z'),
      propertyTimezone: 'Europe/Sofia',
    })
  })

  // A save for this month that is still running when the month ends: a goal
  // written now would open a month that is already over.
  it('rows after the month ends are reported, not created', async () => {
    const { fakes, saved, deps } = setup([
      new Date('2026-03-31T23:59:58.000Z'),
      new Date('2026-03-31T23:59:59.999Z'),
      UTC_MARCH.end,
    ])

    const result = await createGoalsForSubjects(
      deps,
      save([row(lobby), row(bar), row(spa)]),
      actor,
    )

    expect(result.outcomes).toEqual([
      { subject: lobby, code: 'created', programId: saved[0]?.program.id },
      { subject: bar, code: 'start_month_changed' },
      { subject: spa, code: 'start_month_changed' },
    ])
    expect(saved).toHaveLength(1)
    // Nothing is read for a row once the month is over, not even the clock.
    expect(fakes.now).toHaveBeenCalledTimes(3)
    expect(fakes.subjectNames.getSubjectName).toHaveBeenCalledTimes(1)
  })

  it('a save for next month goes on when that month begins', async () => {
    const { saved, deps } = setup([
      new Date('2026-03-31T23:59:59.000Z'),
      new Date('2026-03-31T23:59:59.500Z'),
      new Date('2026-04-01T00:00:01.000Z'),
    ])

    const result = await createGoalsForSubjects(
      deps,
      save([row(lobby), row(bar)], { startMonth: '2026-04' }),
      actor,
    )

    expect(result.outcomes.map((outcome) => outcome.code)).toEqual(['created', 'created'])
    // Both were set at the same instant, before the month began, so both wait
    // for the hourly run to open April; neither is ahead of the other.
    expect(saved.map((bundle) => bundle.program.status)).toEqual([
      'scheduled',
      'scheduled',
    ])
  })

  it('a row with a target the measure does not take is reported and the others are saved', async () => {
    const { saved, deps } = setup()

    const result = await createGoalsForSubjects(
      deps,
      save([row(lobby, 1.5), row(bar, 0), row(spa, 12)]),
      actor,
    )

    expect(result.outcomes).toEqual([
      { subject: lobby, code: 'invalid_target' },
      { subject: bar, code: 'invalid_target' },
      { subject: spa, code: 'created', programId: saved[0]?.program.id },
    ])
  })

  it('a row for something that is not a current portal or group of the Property is reported', async () => {
    const { fakes, saved, deps } = setup()
    const archived: GoalSubject = { kind: 'portal', portalId: 'portal-archived' }

    const result = await createGoalsForSubjects(
      deps,
      save([row(archived), row(lobby)]),
      actor,
    )

    expect(result.outcomes).toEqual([
      { subject: archived, code: 'invalid_subject' },
      { subject: lobby, code: 'created', programId: saved[0]?.program.id },
    ])
    expect(fakes.subjectNames.getSubjectName).toHaveBeenCalledWith(
      'org-1',
      PROPERTY_ID,
      archived,
    )
    // With no name there is no goal to check or write.
    expect(fakes.repository.findAssignmentConflicts).toHaveBeenCalledTimes(1)
  })

  it('a row whose subject left the Property after it was named is reported', async () => {
    const { fakes, deps } = setup()
    fakes.subjects.subjectBelongsToProperty.mockResolvedValueOnce(false)

    const result = await createGoalsForSubjects(deps, save([row(lobby), row(bar)]), actor)

    expect(result.outcomes.map((outcome) => outcome.code)).toEqual([
      'invalid_subject',
      'created',
    ])
  })

  it('a row whose measure cannot be read is reported and the others are saved', async () => {
    const { fakes, deps } = setup()
    fakes.metrics.queryGoalMetric.mockResolvedValueOnce({
      ...updating,
      state: 'quarantined',
      reason: 'source_quarantined',
    })

    const result = await createGoalsForSubjects(deps, save([row(lobby), row(bar)]), actor)

    expect(result.outcomes.map((outcome) => outcome.code)).toEqual([
      'metric_unavailable',
      'created',
    ])
    expect(fakes.logger.error).not.toHaveBeenCalled()
  })

  it('a row lost to a conflict the database found is reported as already having a goal', async () => {
    const { fakes, deps } = setup()
    fakes.repository.create.mockResolvedValueOnce('subject_has_goal' as never)

    const result = await createGoalsForSubjects(deps, save([row(lobby)]), actor)

    expect(result.outcomes).toEqual([{ subject: lobby, code: 'subject_has_goal' }])
  })

  it('a fault on one row fails that row, is logged, and the others are saved', async () => {
    const { fakes, saved, deps } = setup()
    const fault = new Error('connection terminated')
    fakes.repository.create.mockRejectedValueOnce(fault)

    const result = await createGoalsForSubjects(deps, save([row(lobby), row(bar)]), actor)

    expect(result.outcomes).toEqual([
      { subject: lobby, code: 'failed' },
      { subject: bar, code: 'created', programId: saved[0]?.program.id },
    ])
    // What failed and for what kind of row, and no identifier of either.
    expect(fakes.logger.error).toHaveBeenCalledExactlyOnceWith(
      { error: fault, metric: 'portal_rating_count', subjectKind: 'portal' },
      expect.any(String),
    )
  })

  // The Property was there when the save began and is gone for this row: a
  // refusal with no meaning for one row is a failed row, never a silent one.
  it('a refusal that is not about the row fails that row and is logged', async () => {
    const { fakes, deps } = setup()
    fakes.subjects.getTimezone.mockResolvedValueOnce('UTC').mockResolvedValueOnce(null)

    const result = await createGoalsForSubjects(deps, save([row(lobby), row(bar)]), actor)

    expect(result.outcomes.map((outcome) => outcome.code)).toEqual(['failed', 'created'])
    expect(fakes.logger.error).toHaveBeenCalledTimes(1)
  })

  it('a Property with no time zone is not found', async () => {
    const { fakes, deps } = setup()
    fakes.subjects.getTimezone.mockResolvedValue(null)

    await expect(
      createGoalsForSubjects(deps, save([row(lobby)]), actor),
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(fakes.repository.create).not.toHaveBeenCalled()
  })
})
