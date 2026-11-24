// The Goal Program service on the real repository, against PostgreSQL:
// materializing, activating, pausing, the maintenance run and closing months.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { METRIC_VERSION_IDS } from '../readings/contracts'
import { withGoalProgramVisibility } from './goal-program-visibility.server'
import { seedLockedMonthTarget } from './goal-month-target-seed.test-fixtures'
import {
  actor,
  eligibleCount,
  ratingsGoal,
  readiness,
  resultReference,
  GROUP_ID,
  PROPERTY_ID,
  portalUuid,
  useGoalProgramsScenario,
} from './goal-program-service.test-fixtures'
import type { GoalActor } from '../application/use-cases/goal-program-shared'

const { client, setup } = useGoalProgramsScenario()

describe('canonical Goal Program service', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('materializes a revised version only when its effective month starts', async () => {
    const { service, repository, setNow } = setup()
    const created = await ratingsGoal(service)
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
    const created = await ratingsGoal(service, { name: 'April ratings' })
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
    const created = await ratingsGoal(service, { name: 'March ratings', targetValue: 20 })
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
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      eligibleCount(20, new Date('2026-04-01T00:00:00.000Z')),
    )

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

  describe('history for a Member scoped to some Portals', () => {
    const member: GoalActor = { ...actor, userId: 'member-1', role: 'Member' }

    async function revisedProgram() {
      const { service } = setup()
      const created = await ratingsGoal(service, {
        name: 'March ratings',
        targetValue: 20,
      })
      const revised = await service.revise(
        {
          propertyId: PROPERTY_ID,
          programId: created.program.id,
          metric: 'portal_rating_count',
          targetValue: 30,
          subjects: [{ kind: 'portal', portalId: portalUuid(2) }],
          reason: 'Move the goal to the second Portal',
        },
        actor,
      )
      return { service, created, revised }
    }

    it('shows provenance only for versions of subjects the Member can see', async () => {
      const { service, created, revised } = await revisedProgram()
      const scoped = withGoalProgramVisibility(service, async () => ({
        portalIds: [portalUuid(1)],
        groupIds: [],
      }))

      const page = await scoped.history!(
        { propertyId: PROPERTY_ID, programId: created.program.id },
        member,
      )

      expect(page.assignments.map(({ subject }) => subject)).toEqual([
        { kind: 'portal', portalId: portalUuid(1) },
      ])
      expect(page.versions.map(({ id }) => id)).not.toContain(revised.version.id)
      expect(Object.keys(page.targetProvenance ?? {})).not.toContain(revised.version.id)
    })

    it('answers not found for a Program with no visible subject, as get does', async () => {
      const { service, created } = await revisedProgram()
      const scoped = withGoalProgramVisibility(service, async () => ({
        portalIds: [portalUuid(3)],
        groupIds: [],
      }))
      const input = { propertyId: PROPERTY_ID, programId: created.program.id }

      await expect(scoped.get(input, member)).rejects.toMatchObject({
        code: 'not_found',
      })
      await expect(scoped.history!(input, member)).rejects.toMatchObject({
        code: 'not_found',
      })
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
    await ratingsGoal(service, { name: 'April ratings' })
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
      await ratingsGoal(service, { name: 'April ratings' })
      setNow(new Date('2026-04-01T00:00:00.000Z'))
      vi.mocked(repository.activate).mockRejectedValueOnce(failure)
      return service.maintain()
    }

    it.each([
      [
        'names the SQL state of a database refusal in the error, with no identifier',
        Object.assign(new Error('Failed query: update "goal_programs"'), {
          cause: Object.assign(new Error('guard'), { code: '23514' }),
        }),
        'sqlstate_23514',
      ],
      [
        'names the error class of any other failure',
        new TypeError('db down'),
        'TypeError',
      ],
    ])('%s', async (_title, failure, cause) => {
      await expect(failingActivation(failure)).rejects.toMatchObject({
        name: 'GoalProgramMaintenanceError',
        message: `Goal Program maintenance had 1 failed operation(s): ${cause} x1`,
        stats: { failed: 1, failureCauses: { [cause]: 1 } },
      })
    })
  })

  describe('a due result another run settled first', () => {
    async function dueResult() {
      const { service, repository, setNow } = setup()
      await ratingsGoal(service, { name: 'March ratings' })
      setNow(new Date('2026-04-03T00:00:00.000Z'))
      return { service, repository }
    }

    it.each([
      ['it is already closed', 'getDueResult'],
      ['its compare-and-set loses', 'updateResult'],
    ] as const)('is a lost race and not a failure when %s', async (_cause, read) => {
      const { service, repository } = await dueResult()
      const settled = repository[read] as ReturnType<typeof vi.fn>
      settled.mockResolvedValue(null)

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
      ['program', 'getProgram'],
      ['assignment', 'getAssignment'],
      ['version', 'getVersion'],
    ] as const)(
      'fails the run and names its cause when the %s is missing',
      async (_row, read) => {
        const { service, repository, setNow } = setup()
        await ratingsGoal(service, { name: 'March ratings' })
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
    const created = await ratingsGoal(service)
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
    const bundle = await ratingsGoal(service, { name: 'March ratings' })
    const result = bundle.results[0]
    if (!result) throw new Error('expected monthly result')
    setNow(reconciliationTime)
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      eligibleCount(26, new Date('2026-04-01T00:00:00.000Z')),
    )

    const reconciling = await service.reconcileResult(resultReference(result))
    expect(reconciling.status).toBe('reconciling')
    expect(reconciling.evaluation).toMatchObject({
      state: 'eligible',
      value: 26,
      achieved: true,
    })

    const closed = await service.reconcileResult(resultReference(result))
    expect(closed.status).toBe('closed')
    expect(closed.closedAt).toEqual(reconciliationTime)

    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      eligibleCount(20, new Date('2026-04-01T00:00:00.000Z')),
    )
    const corrected = await service.reconcileClosedResult(resultReference(result))
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
      service.reconcileClosedResult(resultReference(result)),
    ).resolves.toMatchObject({ status: 'unchanged' })
  })

  it('keeps an eligible result reconciling until Metric is complete through period end', async () => {
    const { service, metrics, setNow } = setup()
    const bundle = await ratingsGoal(service, { name: 'March ratings' })
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      eligibleCount(26, new Date('2026-03-31T23:59:59.999Z')),
    )

    await expect(service.reconcileResult(resultReference(result))).resolves.toMatchObject(
      { status: 'reconciling', closedAt: null },
    )
    await expect(service.reconcileResult(resultReference(result))).resolves.toMatchObject(
      { status: 'reconciling', closedAt: null },
    )

    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      eligibleCount(26, result.periodEnd),
    )
    await expect(service.reconcileResult(resultReference(result))).resolves.toMatchObject(
      {
        status: 'closed',
        sourceCompleteThrough: result.periodEnd,
        closedAt: new Date('2026-04-02T00:00:00.000Z'),
      },
    )
  })

  it('keeps an unavailable result with unknown source completeness reconciling', async () => {
    const { service, metrics, setNow } = setup()
    const bundle = await ratingsGoal(service, { name: 'March ratings' })
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      readiness({ reason: 'metric_source_unavailable' }),
    )

    await service.reconcileResult(resultReference(result))
    await expect(service.reconcileResult(resultReference(result))).resolves.toMatchObject(
      {
        status: 'reconciling',
        evaluation: { state: 'unavailable', achieved: null },
        sourceCompleteThrough: null,
        closedAt: null,
      },
    )
  })

  it('closes a verified zero count at the exact time and source boundaries', async () => {
    const { service, metrics, repository, setNow } = setup()
    const bundle = await ratingsGoal(service, { name: 'March ratings' })
    const result = bundle.results[0]!
    setNow(new Date('2026-04-02T00:00:00.000Z'))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      eligibleCount(0, result.periodEnd),
    )

    await expect(service.reconcileResult(resultReference(result))).resolves.toMatchObject(
      { status: 'reconciling' },
    )
    await expect(service.reconcileResult(resultReference(result))).resolves.toMatchObject(
      {
        status: 'closed',
        evaluation: { state: 'eligible', value: 0, achieved: false },
        sourceCompleteThrough: result.periodEnd,
        closedAt: new Date('2026-04-02T00:00:00.000Z'),
      },
    )
    expect(repository.updateResult).toHaveBeenCalledTimes(2)
  })

  describe('which target a month is judged against', () => {
    const DUE = new Date('2026-04-02T01:00:00.000Z')

    /** A March ratings goal with a version target of 25, read after March ends. */
    async function marchRatingsGoal(monthTarget: number | null) {
      const context = setup()
      const bundle = await ratingsGoal(context.service, { name: 'March ratings' })
      const opened = bundle.results[0]
      if (!opened) throw new Error('expected monthly result')
      // Nothing in the service sets a month's own target yet, so the stored row
      // is given one directly, as the database row would carry it. This March
      // is long over on the database clock, so the target lock is stepped around.
      if (monthTarget !== null) {
        await seedLockedMonthTarget(client(), opened.id, monthTarget)
      }
      context.setNow(DUE)
      const reference = resultReference(opened)
      const countIs = (count: number) =>
        vi
          .mocked(context.metrics.queryGoalMetric)
          .mockResolvedValue(eligibleCount(count, opened.periodEnd))
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
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      eligibleCount(30, result.periodEnd, {
        definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
        metricKey: 'portal.qualified_scan',
      }),
    )
    await service.reconcileResult(resultReference(result))
    await service.reconcileResult(resultReference(result))
    vi.mocked(metrics.queryGoalMetric).mockResolvedValue(
      readiness({
        definitionVersionId: METRIC_VERSION_IDS.qualifiedScanGoal,
        metricKey: 'portal.qualified_scan',
        state: 'updating',
        exactValue: 29,
        sampleCount: 29,
        reason: 'source_reconciling',
      }),
    )

    await expect(
      service.reconcileClosedResult(resultReference(result)),
    ).resolves.toMatchObject({ status: 'pending' })
    expect(repository.appendResultRevision).not.toHaveBeenCalled()
  })
})
