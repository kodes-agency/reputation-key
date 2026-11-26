// The Goal Program service on the real repository, against PostgreSQL:
// revising a goal and changing its status.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createGoalProgramRepository } from './goal-program-repository.server'
import {
  actor,
  ratingsGoal,
  PROPERTY_ID,
  portalUuid,
  useGoalProgramsScenario,
} from './goal-program-service.test-fixtures'

const { db, setup, versionWindows } = useGoalProgramsScenario()

describe('canonical Goal Program service', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('applies revisions only from the next complete property-local month', async () => {
    const { service, repository } = setup()
    const created = await ratingsGoal(service)
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
    const created = await ratingsGoal(service)
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
    const created = await ratingsGoal(service)
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

    /**
     * A scans goal for portal-1. Created on 1 March it is active with March
     * open; mid-March it waits for April.
     */
    async function scansGoal(at?: Date) {
      const context = setup(at)
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

    it('an edit before the start says the goal waits for its month', async () => {
      const { created, revise, revisions, getCreated } = await scansGoal(MID_MARCH)
      expect(created.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })

      const revised = await revise({ metric: 'portal_rating_count', targetValue: 25 })

      expect(revised.program).toMatchObject({
        status: 'scheduled',
        statusReason: 'awaiting_first_full_month',
      })
      expect(revisions()[0]?.[0].scheduledStatusReason).toBe('awaiting_first_full_month')
      expect((await getCreated())?.program.statusReason).toBe('awaiting_first_full_month')
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
        await createGoalProgramRepository(db()).appendResults({
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
  })
})
