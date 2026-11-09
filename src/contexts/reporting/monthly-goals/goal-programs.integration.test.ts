// The Goal Program service on the real repository, against PostgreSQL.
//
// Monthly results cannot be deleted, so every test runs in a savepoint of one
// held transaction that is rolled back. Only the ports that are not
// persistence (policy, metric reads, Property facts) are stand-ins.
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest'
import type { Database } from '#/shared/db'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { findMetricVersionById, METRIC_VERSION_IDS } from '../readings/contracts'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import { createGoalProgramRepository } from '../infrastructure/repositories/goal-program.repository'
import { readGoalMetricSourceHead } from '../infrastructure/repositories/goal-metric-source-head'
import { seedLockedMonthTarget } from '../infrastructure/testing/goal-month-target-seed'
import {
  createGoalProgramService,
  GoalProgramError,
  type GoalActor,
  type GoalExecutionPolicy,
  type GoalMetricReadPort,
  type GoalProgramSubjectReader,
} from './goal-programs.server'

const ORGANIZATION_ID = 'org-1'
const PROPERTY_ID = '00000000-0000-4000-8000-00000000a001'
const GROUP_ID = '00000000-0000-4000-8000-00000000c001'
/** Portals 1 to 3 of the Property. */
const portalUuid = (n: number) =>
  `00000000-0000-4000-8000-${String(0xb000 + n).padStart(12, '0')}`
const PORTAL_IDS = [1, 2, 3].map(portalUuid)

const actor: GoalActor = {
  organizationId: ORGANIZATION_ID,
  userId: 'manager-1',
  role: 'PropertyManager',
}

let held: HeldTransaction | undefined
let db: Database

beforeAll(async () => {
  registerAllEventSchemas()
  held = await holdTransaction()
  db = held.db
})

afterAll(async () => {
  await held?.rollBack()
})

beforeEach(async () => {
  const client = held!.client
  await client.query('SAVEPOINT scenario')
  await client.query(
    `INSERT INTO properties (id, organization_id, name, slug, timezone)
     VALUES ($1, $2, 'Goal Property', 'goal-programs-property', 'UTC')`,
    [PROPERTY_ID, ORGANIZATION_ID],
  )
  for (const [index, portalId] of PORTAL_IDS.entries()) {
    await client.query(
      `INSERT INTO portals
         (id, organization_id, property_id, entity_type, entity_id, name, slug)
       VALUES ($1, $2, $3, 'property', $4, $5, $5)`,
      [
        portalId,
        ORGANIZATION_ID,
        PROPERTY_ID,
        PROPERTY_ID,
        `goal-programs-portal-${index + 1}`,
      ],
    )
  }
  await client.query(
    `INSERT INTO portal_groups (id, organization_id, property_id, name)
     VALUES ($1, $2, $3, 'Goal group')`,
    [GROUP_ID, ORGANIZATION_ID, PROPERTY_ID],
  )
})

afterEach(async () => {
  await held!.client.query('ROLLBACK TO SAVEPOINT scenario')
})

/** Every version of a Program as stored, including the ones a change replaced. */
async function versionWindows(programId: string) {
  const found = await held!.client.query<{
    version: number
    effectiveFrom: Date
    effectiveTo: Date | null
  }>(
    `SELECT version, effective_from AS "effectiveFrom", effective_to AS "effectiveTo"
       FROM goal_program_versions WHERE program_id = $1 ORDER BY version`,
    [programId],
  )
  return found.rows.map((row) => [row.version, row.effectiveFrom, row.effectiveTo])
}

function setup(initialNow = new Date('2026-03-01T00:00:00.000Z')) {
  let id = 0
  let now = initialNow
  let programId: string | null = null
  const real = createGoalProgramRepository(db)
  const repository = {
    ...real,
    create: vi.fn<typeof real.create>(async (input) => {
      const outcome = await real.create(input)
      if (outcome === 'created') programId = input.bundle.program.id
      return outcome
    }),
    get: vi.fn(real.get),
    list: vi.fn(real.list),
    listOperational: vi.fn(real.listOperational),
    isOrganizationHeld: vi.fn(real.isOrganizationHeld),
    changeStatus: vi.fn(real.changeStatus),
    revise: vi.fn(real.revise),
    rename: vi.fn(real.rename),
    answerCheckIn: vi.fn(real.answerCheckIn),
    findAssignmentConflicts: vi.fn(real.findAssignmentConflicts),
    changeMonthTarget: vi.fn(real.changeMonthTarget),
    activate: vi.fn(real.activate),
    appendResults: vi.fn(real.appendResults),
    listDueResults: vi.fn(real.listDueResults),
    getDueResult: vi.fn(real.getDueResult),
    getAssignment: vi.fn(real.getAssignment),
    getVersion: vi.fn(real.getVersion),
    updateResult: vi.fn<typeof real.updateResult>(async (input) =>
      real.updateResult({
        ...input,
        // The metric stand-in reads no source head; closure needs the stored one.
        sourceHead:
          input.sourceHead ??
          (await readGoalMetricSourceHead(
            db,
            {
              ...input.result,
              definitionVersionId: (await real.getVersion(
                input.result.organizationId,
                input.result.propertyId,
                input.result.programVersionId,
              ))!.metricDefinitionVersionId,
            },
            ['guest.rating.submitted', 'guest.rating.retracted'],
          )),
      }),
    ),
    getClosedResult: vi.fn(real.getClosedResult),
    appendResultRevision: vi.fn(real.appendResultRevision),
    findClosedResultIdsForMetricImpact: vi.fn(real.findClosedResultIdsForMetricImpact),
  } satisfies Record<keyof typeof real, unknown>
  const metrics: GoalMetricReadPort = {
    queryGoalMetric: vi.fn<GoalMetricReadPort['queryGoalMetric']>(async (query) => ({
      definitionVersionId: query.definitionVersionId,
      metricKey:
        query.definitionVersionId === METRIC_VERSION_IDS.qualifiedScanGoal
          ? 'portal.qualified_scan'
          : 'portal.rating_count',
      state: 'updating' as const,
      exactValue: 0,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'source_reconciling',
    })),
    getApprovedGoalVersion: vi.fn(async (versionId) => findMetricVersionById(versionId)),
  }
  const policy: GoalExecutionPolicy = { authorize: vi.fn(async () => undefined) }
  const subjects: GoalProgramSubjectReader = {
    ratingSubjectsSkipPrivateRating: vi.fn(async () => false),
    getTimezone: vi.fn(async () => 'UTC'),
    subjectBelongsToProperty: vi.fn<GoalProgramSubjectReader['subjectBelongsToProperty']>(
      async () => true,
    ),
  }
  const service = createGoalProgramService({
    repository,
    policy,
    subjects,
    metrics,
    id: () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`,
    now: () => now,
  })
  return {
    service,
    policy,
    repository,
    metrics,
    subjects,
    /** The Program the service created last, as stored. */
    getCreated: async (): Promise<GoalProgramBundle | null> =>
      programId ? real.get(ORGANIZATION_ID, PROPERTY_ID, programId) : null,
    setNow: (next: Date) => {
      now = next
    },
    /** The Organization's lifecycle holds it (a closure requested or in progress). */
    holdOrganization: () => {
      repository.isOrganizationHeld.mockResolvedValue(true)
    },
  }
}

describe('canonical Goal Program service', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('atomically creates one pinned program with many subjects and monthly results', async () => {
    const { service, repository } = setup()
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: '  March ratings  ',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [
          { kind: 'property', propertyId: PROPERTY_ID },
          { kind: 'portal_group', portalGroupId: GROUP_ID },
          { kind: 'portal', portalId: portalUuid(1) },
        ],
      },
      actor,
    )

    expect(bundle.program).toMatchObject({ name: 'March ratings', status: 'active' })
    expect(bundle.version).toMatchObject({
      metric: 'portal_rating_count',
      metricDefinitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricMinimumSample: 0,
      targetValue: 25,
      effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
    })
    expect(bundle.assignments).toHaveLength(3)
    expect(bundle.results).toHaveLength(3)
    expect(bundle.results[0]).toMatchObject({
      periodStart: new Date('2026-03-01T00:00:00.000Z'),
      periodEnd: new Date('2026-04-01T00:00:00.000Z'),
      status: 'open',
    })
    expect(repository.create).toHaveBeenCalledOnce()
  })

  it('keeps a configurable metric scheduled when its source producer is inactive', async () => {
    const { service, metrics } = setup()
    vi.mocked(metrics.queryGoalMetric).mockResolvedValueOnce({
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      metricKey: 'portal.qualified_scan',
      state: 'unavailable',
      exactValue: null,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'metric_source_not_active',
    })
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'Qualified scans',
        metric: 'qualified_scans',
        targetValue: 100,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    expect(bundle.program).toMatchObject({
      status: 'scheduled',
      statusReason: 'metric_source_not_active',
    })
    expect(bundle.assignments).toHaveLength(1)
    expect(bundle.results).toEqual([])
  })

  describe('start month', () => {
    const MARCH = {
      start: new Date('2026-03-01T00:00:00.000Z'),
      end: new Date('2026-04-01T00:00:00.000Z'),
    }
    const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
    const portalGoal = (startMonth?: string) =>
      ({
        propertyId: PROPERTY_ID,
        name: 'Ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
        ...(startMonth === undefined ? {} : { startMonth }),
      }) as const
    const readinessOf = (
      patch: Partial<Awaited<ReturnType<GoalMetricReadPort['queryGoalMetric']>>>,
    ) => ({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count' as const,
      state: 'unavailable' as const,
      exactValue: null,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: null,
      ...patch,
    })

    it('create for the current month on 15 Mar is active with an open March row', async () => {
      const { service, repository, metrics } = setup(MID_MARCH)

      const bundle = await service.create(portalGoal('2026-03'), actor)

      expect(bundle.program).toMatchObject({ status: 'active', statusReason: null })
      expect(bundle.version).toMatchObject({
        effectiveFrom: MARCH.start,
        effectiveTo: null,
        createdAt: MID_MARCH,
      })
      expect(bundle.assignments).toEqual([
        expect.objectContaining({ effectiveFrom: MARCH.start, effectiveTo: null }),
      ])
      expect(bundle.results).toEqual([
        expect.objectContaining({
          periodStart: MARCH.start,
          periodEnd: MARCH.end,
          status: 'open',
          createdAt: MID_MARCH,
        }),
      ])
      // Readiness is asked about the month the goal counts, from its first day.
      expect(metrics.queryGoalMetric).toHaveBeenCalledWith(
        expect.objectContaining({ periodStart: MARCH.start, periodEnd: MARCH.end }),
      )
      expect(repository.create).toHaveBeenCalledWith({
        bundle,
        auditAction: 'goal.program.created',
      })
      // The hourly run finds March already open and adds nothing to it.
      await expect(service.maintain()).resolves.toMatchObject({
        activated: 0,
        scheduledResults: 0,
        failed: 0,
      })
      expect(repository.activate).not.toHaveBeenCalled()
      expect(repository.appendResults).not.toHaveBeenCalled()
    })

    it('create without a start month keeps the next-month schedule', async () => {
      const { service } = setup(MID_MARCH)

      const omitted = await service.create(portalGoal(), actor)

      expect(omitted.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(omitted.version.effectiveFrom).toEqual(MARCH.end)
      expect(omitted.results).toEqual([])
    })

    it('create for the next month is scheduled and waits for its first full month', async () => {
      const { service, metrics } = setup(MID_MARCH)

      const next = await service.create(portalGoal('2026-04'), actor)

      expect(next.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(next.version.effectiveFrom).toEqual(MARCH.end)
      expect(next.assignments[0]?.effectiveFrom).toEqual(MARCH.end)
      expect(next.results).toEqual([])
      expect(metrics.queryGoalMetric).toHaveBeenCalledWith(
        expect.objectContaining({
          periodStart: MARCH.end,
          periodEnd: new Date('2026-05-01T00:00:00.000Z'),
        }),
      )
    })

    it('the current month with an inactive source is scheduled and opens March on activation', async () => {
      const { service, metrics, repository, getCreated } = setup(MID_MARCH)
      vi.mocked(metrics.queryGoalMetric).mockResolvedValueOnce(
        readinessOf({ reason: 'metric_source_not_active' }),
      )

      const bundle = await service.create(portalGoal('2026-03'), actor)

      expect(bundle.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'metric_source_not_active',
      })
      expect(bundle.version.effectiveFrom).toEqual(MARCH.start)
      expect(bundle.results).toEqual([])

      // The source is active on the next hourly run: the goal activates and
      // March opens from its first day, not from the day of activation.
      await expect(service.maintain()).resolves.toMatchObject({
        activated: 1,
        scheduledResults: 1,
        failed: 0,
      })
      expect(repository.activate).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            expect.objectContaining({
              periodStart: MARCH.start,
              periodEnd: MARCH.end,
              status: 'open',
            }),
          ],
        }),
      )
      expect((await getCreated())?.program.status).toBe('active')
    })

    it('create refuses a subject that already has a live goal for the metric', async () => {
      const { service, repository } = setup(MID_MARCH)
      vi.mocked(repository.findAssignmentConflicts).mockResolvedValueOnce([
        {
          subject: { kind: 'portal', portalId: portalUuid(1) },
          programId: 'program-live',
          effectiveTo: null,
        },
      ])

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'subject_has_goal',
      } satisfies Partial<GoalProgramError>)

      // Asked from the month the new goal would start, about every Program.
      expect(repository.findAssignmentConflicts).toHaveBeenCalledWith({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        metric: 'portal_rating_count',
        effectiveFrom: MARCH.start,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      })
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('reports a conflict found only by the database as the same refusal', async () => {
      const { service, repository } = setup(MID_MARCH)
      vi.mocked(repository.create).mockResolvedValueOnce('subject_has_goal')

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'subject_has_goal',
      } satisfies Partial<GoalProgramError>)
    })

    it('a form opened on the last day and submitted after midnight is refused, not moved', async () => {
      // Opened on 31 March with "this month" (March) chosen; saved 30 seconds
      // into April. March is no longer a month a new goal can start in.
      const { service, repository, metrics } = setup(new Date('2026-04-01T00:00:30.000Z'))

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'start_month_changed',
      } satisfies Partial<GoalProgramError>)

      expect(metrics.queryGoalMetric).not.toHaveBeenCalled()
      expect(repository.findAssignmentConflicts).not.toHaveBeenCalled()
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('reads the start month on the Property calendar, not the UTC one', async () => {
      // 22:30 UTC on 31 March is 01:30 on 1 April in Sofia.
      const { service, subjects } = setup(new Date('2026-03-31T22:30:00.000Z'))
      vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'start_month_changed',
      })
      await expect(service.create(portalGoal('2026-04'), actor)).resolves.toMatchObject({
        program: { status: 'active' },
        version: {
          propertyTimezone: 'Europe/Sofia',
          effectiveFrom: new Date('2026-03-31T21:00:00.000Z'),
        },
      })
    })

    it('a quarantined source refuses creation with metric_unavailable', async () => {
      const { service, metrics, repository } = setup(MID_MARCH)
      vi.mocked(metrics.queryGoalMetric).mockResolvedValueOnce(
        readinessOf({ state: 'quarantined', reason: 'source_quarantined' }),
      )

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'metric_unavailable',
      } satisfies Partial<GoalProgramError>)
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('a metric version that starts after the month began refuses the current month and allows the next', async () => {
      const { service, metrics, repository } = setup(MID_MARCH)
      const versionStart = new Date('2026-03-10T00:00:00.000Z')
      const ready = vi.mocked(metrics.queryGoalMetric).getMockImplementation()!
      vi.mocked(metrics.queryGoalMetric).mockImplementation(async (query) =>
        query.periodStart < versionStart
          ? readinessOf({ reason: 'metric_version_unavailable' })
          : ready(query),
      )

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'metric_unavailable',
      } satisfies Partial<GoalProgramError>)
      expect(repository.create).not.toHaveBeenCalled()

      await expect(service.create(portalGoal('2026-04'), actor)).resolves.toMatchObject({
        program: { status: 'scheduled' },
      })
    })

    // 04:30Z on 1 November 2026 is 00:30 in Havana, in the first pass of the
    // repeated midnight hour: local November, which begins at 05:00Z.
    it('keeps this month scheduled until its first instant in a repeated midnight hour', async () => {
      const { service, subjects, repository, setNow } = setup(
        new Date('2026-11-01T04:30:00.000Z'),
      )
      vi.mocked(subjects.getTimezone).mockResolvedValue('America/Havana')

      const bundle = await service.create(portalGoal('2026-11'), actor)

      expect(bundle.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(bundle.version.effectiveFrom).toEqual(new Date('2026-11-01T05:00:00.000Z'))
      expect(bundle.results).toEqual([])

      setNow(new Date('2026-11-01T05:00:00.000Z'))
      await expect(service.maintain()).resolves.toMatchObject({
        activated: 1,
        scheduledResults: 1,
      })
      expect(repository.activate).toHaveBeenCalledOnce()
    })

    it('refuses a Property with no time zone before reading anything else', async () => {
      const { service, subjects, metrics } = setup(MID_MARCH)
      vi.mocked(subjects.getTimezone).mockResolvedValue(null)

      await expect(service.create(portalGoal('2026-03'), actor)).rejects.toMatchObject({
        code: 'not_found',
      })
      expect(metrics.queryGoalMetric).not.toHaveBeenCalled()
    })
  })

  it('rejects duplicate subjects and policy-denied Member mutation', async () => {
    const { service, policy } = setup()
    await expect(
      service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'Duplicates',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [
            { kind: 'portal', portalId: portalUuid(1) },
            { kind: 'portal', portalId: portalUuid(1) },
          ],
        },
        actor,
      ),
    ).rejects.toMatchObject({
      code: 'duplicate_subject',
    } satisfies Partial<GoalProgramError>)

    vi.mocked(policy.authorize).mockRejectedValueOnce(new GoalProgramError('forbidden'))
    await expect(
      service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'Member cannot create',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
        },
        { ...actor, role: 'Member' },
      ),
    ).rejects.toMatchObject({ code: 'forbidden' } satisfies Partial<GoalProgramError>)
    expect(policy.authorize).toHaveBeenLastCalledWith({
      actor: { ...actor, role: 'Member' },
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
  })

  it('does not treat a raw role label as stronger than the execution policy', async () => {
    const { service } = setup()

    await expect(
      service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'Policy-authorized program',
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
        },
        { ...actor, role: 'Member' },
      ),
    ).resolves.toMatchObject({ program: { name: 'Policy-authorized program' } })
  })

  it('applies revisions only from the next complete property-local month', async () => {
    const { service, repository } = setup()
    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    const revised = await service.revise(
      {
        propertyId: PROPERTY_ID,
        programId: created.program.id,
        metric: 'portal_rating_average',
        targetValue: 4.5,
        subjects: [
          { kind: 'portal', portalId: portalUuid(1) },
          { kind: 'portal', portalId: portalUuid(2) },
        ],
        reason: 'Use the agreed average target',
      },
      actor,
    )
    expect(revised.version).toMatchObject({
      version: 2,
      metric: 'portal_rating_average',
      metricMinimumSample: 10,
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    })
    expect(revised.assignments).toHaveLength(3)
    expect(
      revised.assignments.filter(
        (assignment) => assignment.programVersionId === revised.version.id,
      ),
    ).toHaveLength(2)
    expect(revised.results).toHaveLength(1)
    expect(repository.revise).toHaveBeenCalledOnce()
  })

  // The open month belongs to the version's own timezone. A Property that
  // moved east starts its next local month BEFORE that month ends (Sofia's
  // April begins 2026-03-31T21:00Z, inside UTC March), and closing the old
  // version there would leave March outside its version window for good.
  it('starts a revision after the open month when the Property timezone moved east', async () => {
    const { service, repository, subjects, setNow } = setup()
    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    setNow(new Date('2026-03-20T12:00:00.000Z'))
    vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')

    const revised = await service.revise(
      {
        propertyId: PROPERTY_ID,
        programId: created.program.id,
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
        reason: 'The property moved to Sofia time',
      },
      actor,
    )

    // March (UTC) ends 2026-04-01T00:00Z; the first Sofia month that starts
    // at or after it is May.
    expect(revised.version).toMatchObject({
      propertyTimezone: 'Europe/Sofia',
      effectiveFrom: new Date('2026-04-30T21:00:00.000Z'),
    })
    expect(repository.revise).toHaveBeenCalledWith(
      expect.objectContaining({
        version: expect.objectContaining({
          effectiveFrom: new Date('2026-04-30T21:00:00.000Z'),
        }),
      }),
    )
  })

  it('keeps the next local month when the Property timezone moved west', async () => {
    const { service, subjects, setNow } = setup(new Date('2026-02-28T22:00:00.000Z'))
    vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')
    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    expect(created.results[0]?.periodEnd).toEqual(new Date('2026-03-31T21:00:00.000Z'))
    setNow(new Date('2026-03-20T12:00:00.000Z'))
    vi.mocked(subjects.getTimezone).mockResolvedValue('UTC')

    const revised = await service.revise(
      {
        propertyId: PROPERTY_ID,
        programId: created.program.id,
        metric: 'portal_rating_count',
        targetValue: 40,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
        reason: 'The property moved to UTC',
      },
      actor,
    )

    expect(revised.version).toMatchObject({
      propertyTimezone: 'UTC',
      effectiveFrom: new Date('2026-04-01T00:00:00.000Z'),
    })
  })

  describe('changing a goal', () => {
    const MARCH = new Date('2026-03-01T00:00:00.000Z')
    const APRIL = new Date('2026-04-01T00:00:00.000Z')
    const MAY = new Date('2026-05-01T00:00:00.000Z')
    const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
    const portal = (id: number) => ({ kind: 'portal' as const, portalId: portalUuid(id) })

    /** The next read of a measure finds its source not active yet. */
    const sourceNotActiveOnce = (metrics: GoalMetricReadPort) =>
      vi.mocked(metrics.queryGoalMetric).mockResolvedValueOnce({
        definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
        metricKey: 'portal.qualified_scan',
        state: 'unavailable',
        exactValue: null,
        sampleCount: 0,
        minimumSample: 0,
        sourceCompleteThrough: null,
        reason: 'metric_source_not_active',
      })

    /**
     * A scans goal for portal-1. Created on 1 March it is active with March
     * open; mid-March it waits for April. Planned on a `not_active` source it
     * is scheduled whenever it is created, and waits for that source.
     */
    async function scansGoal(at?: Date, source: 'active' | 'not_active' = 'active') {
      const context = setup(at)
      if (source === 'not_active') sourceNotActiveOnce(context.metrics)
      const created = await context.service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'Portal scans',
          metric: 'qualified_scans',
          targetValue: 100,
          subjects: [portal(1)],
        },
        actor,
      )
      const revise = (
        patch: Partial<Parameters<typeof context.service.revise>[0]> = {},
      ) =>
        context.service.revise(
          {
            propertyId: PROPERTY_ID,
            programId: created.program.id,
            metric: 'qualified_scans',
            targetValue: 120,
            subjects: [portal(1)],
            ...patch,
          },
          actor,
        )
      const revisions = () => vi.mocked(context.repository.revise).mock.calls
      return { ...context, created, revise, revisions }
    }

    it('revising a goal that has not started replaces the pending version and keeps its start month', async () => {
      const { created, revise, repository } = await scansGoal(MID_MARCH)
      expect(created).toMatchObject({
        program: { status: 'scheduled' },
        version: { effectiveFrom: APRIL },
        results: [],
      })

      const revised = await revise()

      expect(revised.program).toMatchObject({ status: 'scheduled', currentVersion: 2 })
      expect(revised.version).toMatchObject({
        version: 2,
        targetValue: 120,
        effectiveFrom: APRIL,
        effectiveTo: null,
      })
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({
          expectedVersion: expect.objectContaining({ id: created.version.id }),
          supersedeRowlessHead: true,
        }),
      )
      // The replaced plan keeps an empty window: it never held the subject.
      expect(revised.versions[0]).toMatchObject({
        id: created.version.id,
        effectiveFrom: APRIL,
        effectiveTo: APRIL,
      })
      expect(revised.assignments).toMatchObject([
        { programVersionId: created.version.id, effectiveTo: APRIL },
        { programVersionId: revised.version.id, effectiveFrom: APRIL, effectiveTo: null },
      ])
    })

    it('a second pending change supersedes the first', async () => {
      const { created, revise, revisions, setNow } = await scansGoal()
      setNow(MID_MARCH)

      await expect(revise({ targetValue: 130 })).resolves.toMatchObject({
        version: { version: 2, effectiveFrom: APRIL },
      })
      await expect(revise({ targetValue: 140 })).resolves.toMatchObject({
        version: { version: 3, effectiveFrom: APRIL },
      })
      const revised = await revise({ targetValue: 150 })

      // The version in force is closed where the change starts. Each change
      // after it replaces a plan that has no month yet.
      expect(
        revisions().map(([input]) => [
          input.expectedVersion.version,
          input.supersedeRowlessHead,
        ]),
      ).toEqual([
        [1, false],
        [2, true],
        [3, true],
      ])
      expect(revisions().map(([input]) => input.version.targetValue)).toEqual([
        130, 140, 150,
      ])
      expect(await versionWindows(created.program.id)).toEqual([
        [1, MARCH, APRIL],
        [2, APRIL, APRIL],
        [3, APRIL, APRIL],
        [4, APRIL, null],
      ])
      // March stays with the version it opened under.
      expect(revised.results).toMatchObject([
        { programVersionId: created.version.id, periodStart: MARCH },
      ])
    })

    it('a scheduled goal whose start has passed is still edited as never started', async () => {
      const { service, repository, revise, setNow } = await scansGoal(MID_MARCH)
      // April has begun and the hourly job has not activated the goal yet.
      setNow(new Date('2026-04-01T00:30:00.000Z'))

      const revised = await revise()

      expect(revised.version).toMatchObject({ version: 2, effectiveFrom: APRIL })
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({ supersedeRowlessHead: true }),
      )
      expect(repository.appendResults).not.toHaveBeenCalled()

      // The next pass activates the new head and opens April under it.
      await expect(service.maintain()).resolves.toMatchObject({
        activated: 1,
        scheduledResults: 1,
        failed: 0,
      })
      expect(repository.activate).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            expect.objectContaining({
              programVersionId: revised.version.id,
              periodStart: APRIL,
              periodEnd: MAY,
            }),
          ],
        }),
      )
    })

    // The reason says what a scheduled goal waits for, and the page prints
    // it. An edit before the start can change the measure, so it is decided
    // again from the measure the goal now has, as it was at creation.
    it('an edit before the start onto a ready measure says the goal waits for its month', async () => {
      const { created, revise, revisions, getCreated } = await scansGoal(
        MID_MARCH,
        'not_active',
      )
      expect(created.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'metric_source_not_active',
      })

      const revised = await revise({ metric: 'portal_rating_count', targetValue: 25 })

      expect(revised.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(revisions()[0]?.[0].scheduledStatusReason).toBe('awaiting_first_full_month')
      expect((await getCreated())?.program.statusReason).toBe('awaiting_first_full_month')
    })

    it('an edit before the start onto a measure that is not ready says the goal waits for its source', async () => {
      const { created, metrics, revise, revisions, getCreated } =
        await scansGoal(MID_MARCH)
      expect(created.program.statusReason).toBe('awaiting_first_full_month')
      sourceNotActiveOnce(metrics)

      const revised = await revise()

      expect(revised.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'metric_source_not_active',
      })
      expect(revisions()[0]?.[0].scheduledStatusReason).toBe('metric_source_not_active')
      expect((await getCreated())?.program.statusReason).toBe('metric_source_not_active')
    })

    it('revising a goal that has started leaves its status reason alone', async () => {
      const { service, created, revise, revisions, setNow } = await scansGoal()
      setNow(MID_MARCH)
      await service.changeStatus(
        {
          propertyId: PROPERTY_ID,
          programId: created.program.id,
          status: 'paused',
          reason: 'Closed for works',
        },
        actor,
      )

      const revised = await revise()

      expect(revised.program).toMatchObject({
        status: 'paused',
        statusReason: 'Closed for works',
      })
      expect(revisions()[0]?.[0].scheduledStatusReason).toBeUndefined()
    })

    it('revise right after a month begins opens that month first and starts the revision next month', async () => {
      const { created, repository, revise, setNow } = await scansGoal()
      // April has begun and the hourly job has not opened it yet.
      setNow(new Date('2026-04-01T00:10:00.000Z'))

      const revised = await revise()

      expect(repository.appendResults).toHaveBeenCalledOnce()
      expect(repository.appendResults).toHaveBeenCalledWith(
        expect.objectContaining({
          version: expect.objectContaining({ id: created.version.id }),
          results: [
            expect.objectContaining({
              programVersionId: created.version.id,
              periodStart: APRIL,
              periodEnd: MAY,
            }),
          ],
        }),
      )
      expect(revised.results.map(({ periodStart }) => periodStart)).toEqual([
        MARCH,
        APRIL,
      ])
      expect(revised.version).toMatchObject({ version: 2, effectiveFrom: MAY })
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({ supersedeRowlessHead: false }),
      )
    })

    it('reads the goal again when the hourly job opened the due month first', async () => {
      const { created, repository, revise, setNow } = await scansGoal()
      setNow(new Date('2026-04-01T00:10:00.000Z'))
      // The job's write lands between this command's read and its own attempt:
      // nothing is left to insert, and the bundle in hand is a month behind.
      const aprilByTheJob = {
        ...created.results[0]!,
        id: '00000000-0000-4000-8000-00000000c0de',
        periodStart: APRIL,
        periodEnd: MAY,
      }
      vi.mocked(repository.appendResults).mockImplementationOnce(async (input) => {
        await createGoalProgramRepository(db).appendResults({
          ...input,
          results: [aprilByTheJob],
        })
        return 0
      })

      const revised = await revise()

      expect(revised.results.map(({ periodStart }) => periodStart)).toEqual([
        MARCH,
        APRIL,
      ])
      expect(revised.version).toMatchObject({ version: 2, effectiveFrom: MAY })
    })

    it('a pending change whose month has begun is opened, not replaced', async () => {
      const { repository, revise, setNow } = await scansGoal()
      setNow(MID_MARCH)
      const pending = await revise()
      expect(pending.version).toMatchObject({ version: 2, effectiveFrom: APRIL })
      setNow(new Date('2026-04-01T00:10:00.000Z'))

      const next = await revise({ targetValue: 140 })

      // April opens under the change that was waiting for it, and the new
      // change follows it in May.
      expect(repository.appendResults).toHaveBeenCalledWith(
        expect.objectContaining({
          results: [
            expect.objectContaining({
              programVersionId: pending.version.id,
              periodStart: APRIL,
            }),
          ],
        }),
      )
      expect(next.version).toMatchObject({ version: 3, effectiveFrom: MAY })
      expect(repository.revise).toHaveBeenLastCalledWith(
        expect.objectContaining({ supersedeRowlessHead: false }),
      )
    })

    it('reports a month opened under the pending change since the read as a conflict', async () => {
      const { repository, revise, setNow } = await scansGoal()
      setNow(MID_MARCH)
      await revise()
      // The repository finds a month under the head it was told to replace.
      vi.mocked(repository.revise).mockResolvedValueOnce(false)

      await expect(revise({ targetValue: 140 })).rejects.toMatchObject({
        code: 'revision_conflict',
      })
    })

    it('a supersede after a time-zone change starts at a real local month start', async () => {
      const { created, repository, subjects, revise } = await scansGoal(MID_MARCH)
      expect(created.version).toMatchObject({
        propertyTimezone: 'UTC',
        effectiveFrom: APRIL,
      })
      vi.mocked(subjects.getTimezone).mockResolvedValue('Europe/Sofia')

      const revised = await revise()

      // 1 April 00:00 UTC is 03:00 in Sofia: that local month has begun, so
      // the goal now starts with Sofia's May. The start is never copied.
      expect(revised.version).toMatchObject({
        propertyTimezone: 'Europe/Sofia',
        effectiveFrom: new Date('2026-04-30T21:00:00.000Z'),
      })
      expect(repository.revise).toHaveBeenCalledWith(
        expect.objectContaining({ supersedeRowlessHead: true }),
      )
      expect(revised.versions[0]).toMatchObject({
        effectiveFrom: APRIL,
        effectiveTo: APRIL,
      })
    })

    it('revise without a note stores the default reason', async () => {
      const { revise, revisions, setNow } = await scansGoal()
      setNow(MID_MARCH)

      await revise()
      await revise({ reason: '  Agreed with the owner  ', targetValue: 140 })
      await revise({ reason: '   ' })
      await revise({ reason: ' Seasonal target ' })

      expect(revisions().map(([input]) => input.version.changeReason)).toEqual([
        'revised',
        'Agreed with the owner',
        'revised',
        'Seasonal target',
      ])
    })

    it('revise writes where the new number came from on its version, and none when not told', async () => {
      const { revise, revisions, setNow } = await scansGoal()
      setNow(MID_MARCH)

      await revise({ targetSource: 'own' })
      await revise({ targetValue: 140 })

      expect(revisions().map(([input]) => input.version.targetSource)).toEqual([
        'own',
        undefined,
      ])
    })

    it('a status change without a note stores no status reason', async () => {
      const { service, repository, created } = await scansGoal()
      const changeStatus = (status: 'paused' | 'active', reason?: string) =>
        service.changeStatus(
          { propertyId: PROPERTY_ID, programId: created.program.id, status, reason },
          actor,
        )

      await expect(changeStatus('paused')).resolves.toMatchObject({
        status: 'paused',
        statusReason: null,
      })
      await expect(changeStatus('active', '   ')).resolves.toMatchObject({
        status: 'active',
        statusReason: null,
      })
      await expect(changeStatus('paused', ' Closed for works ')).resolves.toMatchObject({
        statusReason: 'Closed for works',
      })
      expect(
        vi.mocked(repository.changeStatus).mock.calls.map(([input]) => input.reason),
      ).toEqual([null, null, 'Closed for works'])
    })

    it('reports a status change the repository could not apply as a conflict', async () => {
      const { service, repository, created } = await scansGoal()
      vi.mocked(repository.changeStatus).mockResolvedValueOnce(null)

      await expect(
        service.changeStatus(
          { propertyId: PROPERTY_ID, programId: created.program.id, status: 'ended' },
          actor,
        ),
      ).rejects.toMatchObject({ code: 'revision_conflict' })
    })

    it('revise refuses a subject another goal holds for the measure', async () => {
      const { created, repository, revise, setNow } = await scansGoal()
      setNow(MID_MARCH)
      vi.mocked(repository.findAssignmentConflicts).mockResolvedValueOnce([
        { subject: portal(2), programId: 'program-busy', effectiveTo: null },
      ])

      await expect(
        revise({ metric: 'portal_rating_count', subjects: [portal(1), portal(2)] }),
      ).rejects.toMatchObject({ code: 'subject_has_goal' })

      // Asked for the measure and month the change would take, without the
      // goal's own assignments.
      expect(repository.findAssignmentConflicts).toHaveBeenLastCalledWith({
        organizationId: 'org-1',
        propertyId: PROPERTY_ID,
        excludeProgramId: created.program.id,
        metric: 'portal_rating_count',
        effectiveFrom: APRIL,
        subjects: [portal(1), portal(2)],
      })
      expect(repository.revise).not.toHaveBeenCalled()
    })

    it('revise refuses a form opened on a version that has since changed', async () => {
      const { repository, revise, setNow } = await scansGoal()
      setNow(MID_MARCH)
      await revise({ targetValue: 130 })

      await expect(revise({ expectedVersion: 1 })).rejects.toMatchObject({
        code: 'revision_conflict',
      })
      expect(repository.revise).toHaveBeenCalledOnce()

      await expect(
        revise({ expectedVersion: 2, subjects: [portal(1), portal(2)] }),
      ).resolves.toMatchObject({ version: { version: 3 } })
    })

    it('revise refuses a form whose start month the turn of the month moved on', async () => {
      const { repository, revise, setNow } = await scansGoal()
      // Read in March's last minutes: "From Apr 1". Sent once April has begun,
      // the change would start in May.
      setNow(new Date('2026-04-01T00:05:00.000Z'))

      await expect(revise({ expectedStartMonth: '2026-04' })).rejects.toMatchObject({
        code: 'start_month_changed',
      })
      expect(repository.revise).not.toHaveBeenCalled()

      await expect(revise({ expectedStartMonth: '2026-05' })).resolves.toMatchObject({
        version: { version: 2, effectiveFrom: MAY },
      })
    })

    it('rename changes name only and leaves the version untouched', async () => {
      const { service, repository, policy, created } = await scansGoal()

      await expect(
        service.rename(
          {
            propertyId: PROPERTY_ID,
            programId: created.program.id,
            name: '  Lobby scans  ',
          },
          actor,
        ),
      ).resolves.toMatchObject({ name: 'Lobby scans', description: null })

      expect(policy.authorize).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'goal.update', propertyId: PROPERTY_ID }),
      )
      expect(repository.rename).toHaveBeenCalledWith({
        organizationId: 'org-1',
        propertyId: PROPERTY_ID,
        programId: created.program.id,
        name: 'Lobby scans',
        description: null,
        previousName: 'Portal scans',
        previousDescription: null,
        actorId: 'manager-1',
        at: MARCH,
      })
      expect(repository.revise).not.toHaveBeenCalled()
      await expect(
        service.get({ propertyId: PROPERTY_ID, programId: created.program.id }, actor),
      ).resolves.toMatchObject({
        program: { name: 'Lobby scans', currentVersion: 1 },
        version: { id: created.version.id, version: 1, changeReason: 'created' },
        versions: [{ id: created.version.id }],
      })
    })

    it('rename keeps a description that is not sent and clears an empty one', async () => {
      const { service, created } = await scansGoal()
      const rename = (name: string, description?: string | null) =>
        service.rename(
          { propertyId: PROPERTY_ID, programId: created.program.id, name, description },
          actor,
        )

      await expect(rename('Lobby scans', ' Counted at the desk ')).resolves.toMatchObject(
        { description: 'Counted at the desk' },
      )
      await expect(rename('Front desk scans')).resolves.toMatchObject({
        name: 'Front desk scans',
        description: 'Counted at the desk',
      })
      await expect(rename('Front desk scans', '  ')).resolves.toMatchObject({
        description: null,
      })
    })

    it('rename hands over the name and description it read, so the write applies only to them', async () => {
      const { service, repository, created } = await scansGoal()
      const rename = (name: string, description?: string | null) =>
        service.rename(
          { propertyId: PROPERTY_ID, programId: created.program.id, name, description },
          actor,
        )
      await rename('Lobby scans', 'Counted at the desk')

      await rename('Lobby scans', 'Counted at the front desk')

      expect(repository.rename).toHaveBeenLastCalledWith(
        expect.objectContaining({
          name: 'Lobby scans',
          description: 'Counted at the front desk',
          previousName: 'Lobby scans',
          previousDescription: 'Counted at the desk',
        }),
      )
    })

    it('rename refuses a blank or overlong name and writes nothing for an unchanged one', async () => {
      const { service, repository, created } = await scansGoal()
      const rename = (name: string) =>
        service.rename(
          { propertyId: PROPERTY_ID, programId: created.program.id, name },
          actor,
        )

      await expect(rename('   ')).rejects.toMatchObject({ code: 'invalid_name' })
      await expect(rename('x'.repeat(201))).rejects.toMatchObject({
        code: 'invalid_name',
      })
      await expect(rename(' Portal scans ')).resolves.toMatchObject({
        name: 'Portal scans',
      })
      expect(repository.rename).not.toHaveBeenCalled()

      // The goal ended, or was renamed, between the read and the write.
      vi.mocked(repository.rename).mockResolvedValueOnce(null)
      await expect(rename('Lobby scans')).rejects.toMatchObject({
        code: 'revision_conflict',
      })
    })
  })

  it('materializes a revised version only when its effective month starts', async () => {
    const { service, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    await service.revise(
      {
        propertyId: PROPERTY_ID,
        programId: created.program.id,
        metric: 'portal_rating_average',
        targetValue: 4.5,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
        reason: 'Use the average next month',
      },
      actor,
    )

    await expect(service.maintain()).resolves.toMatchObject({ scheduledResults: 0 })
    expect(repository.appendResults).not.toHaveBeenCalled()

    setNow(new Date('2026-04-01T00:00:00.000Z'))
    await expect(service.maintain()).resolves.toMatchObject({
      scheduledResults: 1,
      failed: 0,
    })
    expect(repository.appendResults).toHaveBeenCalledOnce()
    expect(repository.appendResults).toHaveBeenCalledWith(
      expect.objectContaining({
        results: [
          expect.objectContaining({
            programVersionId: expect.any(String),
            periodStart: new Date('2026-04-01T00:00:00.000Z'),
            periodEnd: new Date('2026-05-01T00:00:00.000Z'),
          }),
        ],
      }),
    )
  })

  it('does not activate a scheduled program before its period or source is ready', async () => {
    const { service } = setup(new Date('2026-03-15T12:00:00.000Z'))
    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'April ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    expect(created.program.status).toBe('scheduled')
    await expect(
      service.changeStatus(
        {
          propertyId: PROPERTY_ID,
          programId: created.program.id,
          status: 'active',
          reason: 'too early',
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'metric_unavailable' })
  })

  it('pauses future scheduling without abandoning an already-open monthly result', async () => {
    const { service, metrics, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 20,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    await service.changeStatus(
      {
        propertyId: PROPERTY_ID,
        programId: created.program.id,
        status: 'paused',
        reason: 'Pause after the March period',
      },
      actor,
    )
    setNow(new Date('2026-04-02T01:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 20,
      sampleCount: 20,
      minimumSample: 0,
      sourceCompleteThrough: new Date('2026-04-01T00:00:00.000Z'),
      reason: null,
    })

    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 0,
      scheduledResults: 0,
      reconciled: 1,
      failed: 0,
    })
    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 0,
      scheduledResults: 0,
      reconciled: 1,
      closed: 1,
      failed: 0,
    })
    expect(repository.appendResults).not.toHaveBeenCalled()
  })

  // The Closing phase can pause only an active program and the database has no
  // scheduled -> paused edge. So once a closure is requested nothing may put a
  // program into `active` again: Goal's purge-readiness check would find it
  // there on every pass and the Organization would stay in `closing` for good.
  describe('an Organization whose closure the lifecycle holds', () => {
    const definition = {
      propertyId: PROPERTY_ID,
      name: 'March ratings',
      metric: 'portal_rating_count' as const,
      targetValue: 20,
      subjects: [{ kind: 'portal' as const, portalId: portalUuid(1) }],
    }
    const change = (programId: string, status: 'paused' | 'active' | 'ended') => ({
      propertyId: PROPERTY_ID,
      programId,
      status,
    })

    it('creates no goal', async () => {
      const { service, repository, holdOrganization } = setup()
      holdOrganization()

      await expect(service.create(definition, actor)).rejects.toMatchObject({
        name: 'GoalProgramError',
        code: 'organization_closing',
      })

      expect(repository.isOrganizationHeld).toHaveBeenCalledExactlyOnceWith('org-1')
      expect(repository.create).not.toHaveBeenCalled()
    })

    it('does not resume a goal its Closing phase paused', async () => {
      const { service, repository, holdOrganization } = setup()
      const created = await service.create(definition, actor)
      await service.changeStatus(change(created.program.id, 'paused'), actor)
      vi.mocked(repository.isOrganizationHeld).mockClear()
      holdOrganization()

      await expect(
        service.changeStatus(change(created.program.id, 'active'), actor),
      ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'organization_closing' })

      expect(repository.changeStatus).toHaveBeenCalledTimes(1)
      expect(repository.isOrganizationHeld).toHaveBeenCalledExactlyOnceWith('org-1')
    })

    it('does not start a goal that is still scheduled', async () => {
      const { service, repository, holdOrganization } = setup(
        new Date('2026-03-15T12:00:00.000Z'),
      )
      const created = await service.create(definition, actor)
      expect(created.program.status).toBe('scheduled')
      holdOrganization()

      await expect(
        service.changeStatus(change(created.program.id, 'active'), actor),
      ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'organization_closing' })

      expect(repository.changeStatus).not.toHaveBeenCalled()
    })

    it('still pauses and ends a goal, which only stops work', async () => {
      const { service, holdOrganization } = setup()
      const created = await service.create(definition, actor)
      holdOrganization()

      await expect(
        service.changeStatus(change(created.program.id, 'paused'), actor),
      ).resolves.toMatchObject({ status: 'paused' })
      await expect(
        service.changeStatus(change(created.program.id, 'ended'), actor),
      ).resolves.toMatchObject({ status: 'ended' })
    })

    it('does not ask the lifecycle about a change that is not a start', async () => {
      const { service, repository } = setup()
      const created = await service.create(definition, actor)
      vi.mocked(repository.isOrganizationHeld).mockClear()

      await service.changeStatus(change(created.program.id, 'paused'), actor)

      expect(repository.isOrganizationHeld).not.toHaveBeenCalled()
    })
  })

  it('retains terminal several-subject Program history after Stop', async () => {
    const { service } = setup()
    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 20,
        subjects: [
          { kind: 'portal', portalId: portalUuid(1) },
          { kind: 'portal', portalId: portalUuid(2) },
        ],
      },
      actor,
    )
    await expect(
      service.changeStatus(
        {
          propertyId: PROPERTY_ID,
          programId: created.program.id,
          status: 'ended',
          reason: 'Program archived by manager',
        },
        actor,
      ),
    ).resolves.toMatchObject({ status: 'ended' })
    await expect(
      service.get({ propertyId: PROPERTY_ID, programId: created.program.id }, actor),
    ).resolves.toMatchObject({
      program: { status: 'ended' },
      // Stopping closes the windows where the open month ends.
      assignments: created.assignments.map((assignment) => ({
        ...assignment,
        effectiveTo: created.results[0]?.periodEnd,
      })),
      results: created.results.map(({ id }) => ({ id })),
    })
  })

  it('stores an average goal over several subjects, one open month for each', async () => {
    const { service, getCreated } = setup()

    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March average',
        metric: 'portal_rating_average',
        targetValue: 4.5,
        subjects: [
          { kind: 'portal', portalId: portalUuid(1) },
          { kind: 'portal', portalId: portalUuid(2) },
          { kind: 'portal_group', portalGroupId: GROUP_ID },
        ],
      },
      actor,
    )

    const stored = await getCreated()
    expect(stored?.version).toMatchObject({
      metric: 'portal_rating_average',
      targetValue: 4.5,
    })
    expect(stored?.assignments.map(({ id }) => id).sort()).toEqual(
      created.assignments.map(({ id }) => id).sort(),
    )
    expect(stored?.results).toHaveLength(3)
    expect(stored?.results.every(({ status }) => status === 'open')).toBe(true)
  })

  it('activates due programs and materializes only the month that has started', async () => {
    const { service, repository, setNow } = setup(new Date('2026-03-15T12:00:00.000Z'))
    await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'April ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [
          { kind: 'portal', portalId: portalUuid(1) },
          { kind: 'portal', portalId: portalUuid(2) },
        ],
      },
      actor,
    )
    setNow(new Date('2026-04-01T00:00:00.000Z'))

    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 1,
      activated: 1,
      scheduledResults: 2,
      unavailable: 0,
      failed: 0,
    })
    expect(repository.activate).toHaveBeenCalledOnce()
    expect(repository.appendResults).not.toHaveBeenCalled()
  })

  it('fails the job after partial infrastructure failure so BullMQ can retry it', async () => {
    const { service, repository, setNow } = setup(new Date('2026-03-15T12:00:00.000Z'))
    await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'April ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    setNow(new Date('2026-04-01T00:00:00.000Z'))
    vi.mocked(repository.activate).mockRejectedValueOnce(new Error('db down'))

    await expect(service.maintain()).rejects.toMatchObject({
      name: 'GoalProgramMaintenanceError',
      stats: { inspected: 1, failed: 1 },
    })
  })

  describe('a failed maintenance run', () => {
    async function failingActivation(failure: unknown) {
      const { service, repository, setNow } = setup(new Date('2026-03-15T12:00:00.000Z'))
      await service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'April ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
        },
        actor,
      )
      setNow(new Date('2026-04-01T00:00:00.000Z'))
      vi.mocked(repository.activate).mockRejectedValueOnce(failure)
      return service.maintain()
    }

    it('names the SQL state of a database refusal in the error, with no identifier', async () => {
      const refusal = Object.assign(new Error('Failed query: update "goal_programs"'), {
        cause: Object.assign(new Error('guard'), { code: '23514' }),
      })

      await expect(failingActivation(refusal)).rejects.toMatchObject({
        name: 'GoalProgramMaintenanceError',
        message: 'Goal Program maintenance had 1 failed operation(s): sqlstate_23514 x1',
        stats: { failed: 1, failureCauses: { sqlstate_23514: 1 } },
      })
    })

    it('names the error class of any other failure', async () => {
      await expect(failingActivation(new TypeError('db down'))).rejects.toMatchObject({
        message: 'Goal Program maintenance had 1 failed operation(s): TypeError x1',
        stats: { failed: 1, failureCauses: { TypeError: 1 } },
      })
    })
  })

  describe('a due result another run settled first', () => {
    async function dueResult() {
      const { service, repository, setNow } = setup()
      await service.create(
        {
          propertyId: PROPERTY_ID,
          name: 'March ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
        },
        actor,
      )
      setNow(new Date('2026-04-03T00:00:00.000Z'))
      return { service, repository }
    }

    it('is a lost race and not a failure when it is already closed', async () => {
      const { service, repository } = await dueResult()
      vi.mocked(repository.getDueResult).mockResolvedValue(null)

      await expect(service.maintain()).resolves.toMatchObject({
        raced: 1,
        reconciled: 0,
        failed: 0,
      })
    })

    it('is a lost race and not a failure when its compare-and-set loses', async () => {
      const { service, repository } = await dueResult()
      vi.mocked(repository.updateResult).mockResolvedValue(null)

      await expect(service.maintain()).resolves.toMatchObject({
        raced: 1,
        reconciled: 0,
        failed: 0,
      })
    })
  })

  describe('a due result whose program, assignment or version row is missing', () => {
    // Not a lost race: nothing settled the result, a row it points to is gone.
    // That is a broken reference and the run must say so.
    it.each([
      ['program', 'get'],
      ['assignment', 'getAssignment'],
      ['version', 'getVersion'],
    ] as const)(
      'fails the run and names its cause when the %s is missing',
      async (_row, read) => {
        const { service, repository, setNow } = setup()
        await service.create(
          {
            propertyId: PROPERTY_ID,
            name: 'March ratings',
            metric: 'portal_rating_count',
            targetValue: 25,
            subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
          },
          actor,
        )
        setNow(new Date('2026-04-03T00:00:00.000Z'))
        // Only the due-result pass runs, and the row it reads is gone.
        vi.mocked(repository.listOperational).mockResolvedValue([])
        const missing = repository[read] as ReturnType<typeof vi.fn>
        missing.mockResolvedValue(null)

        await expect(service.maintain()).rejects.toMatchObject({
          name: 'GoalProgramMaintenanceError',
          message:
            'Goal Program maintenance had 1 failed operation(s): GoalResultReferenceMissingError x1',
          stats: {
            raced: 0,
            reconciled: 0,
            failed: 1,
            failureCauses: { GoalResultReferenceMissingError: 1 },
          },
        })
      },
    )
  })

  // A result whose month runs past its version or assignment window can never
  // be updated: the database guard rejects every write. Before revisions
  // respected the open month, a timezone move could leave one behind, and it
  // failed every hourly run for every tenant.
  it('reports a result stranded outside its version window without failing the run', async () => {
    const { service, repository, setNow } = setup()
    const created = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'Monthly ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    const closedEarly = {
      ...created.version,
      effectiveTo: new Date('2026-03-31T21:00:00.000Z'),
    }
    vi.mocked(repository.getVersion).mockResolvedValue(closedEarly)
    vi.mocked(repository.updateResult).mockRejectedValue(
      Object.assign(new Error('goal monthly result falls outside its window'), {
        code: '23514',
      }),
    )
    setNow(new Date('2026-04-03T00:00:00.000Z'))

    await expect(service.maintain()).resolves.toMatchObject({
      reconciled: 0,
      stranded: 1,
      failed: 0,
    })
    expect(repository.updateResult).not.toHaveBeenCalled()
  })

  it('moves a due result through reconciling before immutable closure', async () => {
    const reconciliationTime = new Date('2026-04-02T01:00:00.000Z')
    const setupResult = setup()
    const { service, metrics, repository, setNow } = setupResult
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    const result = bundle.results[0]
    if (!result) throw new Error('expected monthly result')
    setNow(reconciliationTime)
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 26,
      sampleCount: 26,
      minimumSample: 0,
      sourceCompleteThrough: new Date('2026-04-01T00:00:00.000Z'),
      reason: null,
    })

    const reconciling = await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      resultId: result.id,
    })
    expect(reconciling.status).toBe('reconciling')
    expect(reconciling.evaluation).toMatchObject({
      state: 'eligible',
      value: 26,
      achieved: true,
    })

    const closed = await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      resultId: result.id,
    })
    expect(closed.status).toBe('closed')
    expect(closed.closedAt).toEqual(reconciliationTime)

    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 20,
      sampleCount: 20,
      minimumSample: 0,
      sourceCompleteThrough: new Date('2026-04-01T00:00:00.000Z'),
      reason: null,
    })
    const corrected = await service.reconcileClosedResult({
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      resultId: result.id,
    })
    expect(corrected).toMatchObject({
      status: 'revised',
      result: {
        status: 'closed',
        evaluation: { state: 'eligible', value: 20, achieved: false },
        closedAt: reconciliationTime,
      },
      revision: { revision: 1, changeReason: 'metric_correction_reconciliation' },
      outcomeChanged: true,
      availabilityChanged: false,
    })
    expect(repository.updateResult).toHaveBeenCalledTimes(2)

    await expect(
      service.reconcileClosedResult({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'unchanged' })
  })

  it('keeps an eligible result reconciling until Metric is complete through period end', async () => {
    const { service, metrics, setNow } = setup()
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 26,
      sampleCount: 26,
      minimumSample: 0,
      sourceCompleteThrough: new Date('2026-03-31T23:59:59.999Z'),
      reason: null,
    })

    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'reconciling', closedAt: null })
    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'reconciling', closedAt: null })

    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 26,
      sampleCount: 26,
      minimumSample: 0,
      sourceCompleteThrough: result.periodEnd,
      reason: null,
    })
    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        resultId: result.id,
      }),
    ).resolves.toMatchObject({
      status: 'closed',
      sourceCompleteThrough: result.periodEnd,
      closedAt: new Date('2026-04-02T00:00:00.000Z'),
    })
  })

  it('keeps an unavailable result with unknown source completeness reconciling', async () => {
    const { service, metrics, setNow } = setup()
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'unavailable',
      exactValue: null,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'metric_source_unavailable',
    })

    await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      resultId: result.id,
    })
    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        resultId: result.id,
      }),
    ).resolves.toMatchObject({
      status: 'reconciling',
      evaluation: { state: 'unavailable', achieved: null },
      sourceCompleteThrough: null,
      closedAt: null,
    })
  })

  it('closes a verified zero count at the exact time and source boundaries', async () => {
    const { service, metrics, repository, setNow } = setup()
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March ratings',
        metric: 'portal_rating_count',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
      metricKey: 'portal.rating_count',
      state: 'eligible',
      exactValue: 0,
      sampleCount: 0,
      minimumSample: 0,
      sourceCompleteThrough: result.periodEnd,
      reason: null,
    })

    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'reconciling' })
    await expect(
      service.reconcileResult({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        resultId: result.id,
      }),
    ).resolves.toMatchObject({
      status: 'closed',
      evaluation: { state: 'eligible', value: 0, achieved: false },
      sourceCompleteThrough: result.periodEnd,
      closedAt: new Date('2026-04-02T00:00:00.000Z'),
    })
    expect(repository.updateResult).toHaveBeenCalledTimes(2)
  })

  describe('which target a month is judged against', () => {
    const PROPERTY = PROPERTY_ID
    const DUE = new Date('2026-04-02T01:00:00.000Z')

    /** A March ratings goal with a version target of 25, read after March ends. */
    async function marchRatingsGoal(monthTarget: number | null) {
      const context = setup()
      const bundle = await context.service.create(
        {
          propertyId: PROPERTY,
          name: 'March ratings',
          metric: 'portal_rating_count',
          targetValue: 25,
          subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
        },
        actor,
      )
      const opened = bundle.results[0]
      if (!opened) throw new Error('expected monthly result')
      // Nothing in the service sets a month's own target yet, so the stored row
      // is given one directly, as the database row would carry it. This March
      // is long over on the database clock, so the target lock is stepped around.
      if (monthTarget !== null) {
        await seedLockedMonthTarget(held!.client, opened.id, monthTarget)
      }
      context.setNow(DUE)
      const reference = {
        organizationId: actor.organizationId,
        propertyId: PROPERTY,
        resultId: opened.id,
      }
      const countIs = (count: number) =>
        vi.mocked(context.metrics.queryGoalMetric).mockResolvedValue({
          definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
          metricKey: 'portal.rating_count',
          state: 'eligible',
          exactValue: count,
          sampleCount: count,
          minimumSample: 0,
          sourceCompleteThrough: opened.periodEnd,
          reason: null,
        })
      return { ...context, reference, countIs }
    }

    it("a month with its own target is judged against it, not the version's", async () => {
      const { service, reference, countIs } = await marchRatingsGoal(30)
      // 26 ratings meet the version's 25 but not the month's own 30.
      countIs(26)

      const reconciling = await service.reconcileResult(reference)

      expect(reconciling).toMatchObject({
        status: 'reconciling',
        targetValue: 30,
        evaluation: { state: 'eligible', value: 26, achieved: false },
      })
    })

    it('a row with its own target closes against it', async () => {
      const { service, reference, countIs } = await marchRatingsGoal(20)
      // 22 ratings miss the version's 25 but meet the month's own 20.
      countIs(22)

      await service.reconcileResult(reference)
      const closed = await service.reconcileResult(reference)

      expect(closed).toMatchObject({
        status: 'closed',
        targetValue: 20,
        evaluation: { state: 'eligible', value: 22, achieved: true },
      })
    })

    it("a closed-month correction keeps using the month's own target", async () => {
      const { service, reference, countIs } = await marchRatingsGoal(20)
      countIs(22)
      await service.reconcileResult(reference)
      await service.reconcileResult(reference)
      // One rating is retracted after the month closed: 21 still meets the
      // month's own 20, and would miss the version's 25.
      countIs(21)

      const corrected = await service.reconcileClosedResult(reference)

      expect(corrected).toMatchObject({
        status: 'revised',
        result: {
          status: 'closed',
          targetValue: 20,
          evaluation: { state: 'eligible', value: 21, achieved: true },
        },
        outcomeChanged: false,
      })
    })

    it("a month without its own target uses the version's", async () => {
      const { service, reference, countIs } = await marchRatingsGoal(null)
      countIs(22)

      await service.reconcileResult(reference)
      const closed = await service.reconcileResult(reference)

      expect(closed).toMatchObject({
        status: 'closed',
        targetValue: null,
        evaluation: { state: 'eligible', value: 22, achieved: false },
      })
      countIs(26)
      await expect(service.reconcileClosedResult(reference)).resolves.toMatchObject({
        status: 'revised',
        result: { evaluation: { value: 26, achieved: true } },
        outcomeChanged: true,
      })
    })
  })

  it('preserves the last closed result while a late correction is still updating', async () => {
    const setupResult = setup()
    const { service, metrics, repository, setNow } = setupResult
    const bundle = await service.create(
      {
        propertyId: PROPERTY_ID,
        name: 'March scans',
        metric: 'qualified_scans',
        targetValue: 25,
        subjects: [{ kind: 'portal', portalId: portalUuid(1) }],
      },
      actor,
    )
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T01:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      metricKey: 'portal.qualified_scan',
      state: 'eligible',
      exactValue: 30,
      sampleCount: 30,
      minimumSample: 0,
      sourceCompleteThrough: result.periodEnd,
      reason: null,
    })
    await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      resultId: result.id,
    })
    await service.reconcileResult({
      organizationId: actor.organizationId,
      propertyId: PROPERTY_ID,
      resultId: result.id,
    })
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue({
      definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
      metricKey: 'portal.qualified_scan',
      state: 'updating',
      exactValue: 29,
      sampleCount: 29,
      minimumSample: 0,
      sourceCompleteThrough: null,
      reason: 'source_reconciling',
    })

    await expect(
      service.reconcileClosedResult({
        organizationId: actor.organizationId,
        propertyId: PROPERTY_ID,
        resultId: result.id,
      }),
    ).resolves.toMatchObject({ status: 'pending' })
    expect(repository.appendResultRevision).not.toHaveBeenCalled()
  })
})

describe('rating goals on switched Portals', () => {
  const request = {
    propertyId: PROPERTY_ID,
    name: 'A goal',
    description: null,
    metric: 'portal_rating_count' as const,
    targetValue: 10,
    subjects: [{ kind: 'portal' as const, portalId: portalUuid(1) }],
  }
  it.each(['portal_rating_count', 'portal_rating_average'] as const)(
    'refuses %s for a switched subject',
    async (metric) => {
      const { service, subjects, repository } = setup()
      vi.mocked(subjects.ratingSubjectsSkipPrivateRating!).mockResolvedValue(true)
      await expect(
        service.create(
          {
            ...request,
            metric,
            targetValue: metric === 'portal_rating_average' ? 4 : 10,
          },
          actor,
        ),
      ).rejects.toMatchObject({
        _tag: 'GoalProgramError',
        code: 'private_ratings_skipped',
        message: 'This subject skips private ratings. Choose scans instead.',
      })
      expect(repository.create).not.toHaveBeenCalled()
    },
  )
  it('refuses a change to ratings but keeps scans available', async () => {
    const { service, subjects } = setup()
    const scans = await service.create({ ...request, metric: 'qualified_scans' }, actor)
    vi.mocked(subjects.ratingSubjectsSkipPrivateRating!).mockResolvedValue(true)
    await expect(
      service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: scans.program.id,
          metric: 'portal_rating_count',
          targetValue: 10,
          subjects: request.subjects,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'private_ratings_skipped' })
  })
})

describe('rating-goal changes after its subjects skip ratings', () => {
  const input = {
    propertyId: PROPERTY_ID,
    name: 'Ratings',
    metric: 'portal_rating_count' as const,
    targetValue: 10,
    subjects: [{ kind: 'portal' as const, portalId: portalUuid(1) }],
  }
  it('refuses a running month target change', async () => {
    const { service, subjects } = setup()
    const goal = await service.create(input, actor)
    vi.mocked(subjects.ratingSubjectsSkipPrivateRating!).mockResolvedValue(true)
    await expect(
      service.changeMonthTarget(
        {
          propertyId: input.propertyId,
          programId: goal.program.id,
          month: '2026-03',
          targetValue: 12,
          expectedTarget: 10,
          expectedVersion: 1,
          expectedFollowingMonth: '2026-04',
          applyToFollowing: false,
        },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'private_ratings_skipped' })
  })
  it('refuses resumption but permits ending the goal', async () => {
    const { service, subjects } = setup()
    const goal = await service.create(input, actor)
    await service.changeStatus(
      { propertyId: input.propertyId, programId: goal.program.id, status: 'paused' },
      actor,
    )
    vi.mocked(subjects.ratingSubjectsSkipPrivateRating!).mockResolvedValue(true)
    await expect(
      service.changeStatus(
        { propertyId: input.propertyId, programId: goal.program.id, status: 'active' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'private_ratings_skipped' })
    await expect(
      service.changeStatus(
        { propertyId: input.propertyId, programId: goal.program.id, status: 'ended' },
        actor,
      ),
    ).resolves.toMatchObject({ status: 'ended' })
  })
})
