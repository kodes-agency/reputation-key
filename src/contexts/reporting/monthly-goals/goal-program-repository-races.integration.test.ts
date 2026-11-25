import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { findMetricVersionById } from '../readings/contracts'
import type { GoalProgramVersion } from '../application/ports/goal-program.repository'
import {
  FEBRUARY,
  followingVersion,
  JANUARY,
  MARCH,
  openMonth,
  windowsOf,
} from './goal-program-bundle.test-fixtures'
import { useGoalProgramRepositorySuite } from './goal-program-repository-suite.test-fixtures'
import { createGoalProgramService } from './goal-programs.server'
import { type GoalActor } from '../application/use-cases/goal-program-shared'

describe.sequential('Goal Program repository races (integration)', () => {
  const suite = useGoalProgramRepositorySuite('goal-program-races')
  const { organizationId } = suite
  const plannedAt = new Date('2026-01-15T12:00:00.000Z')
  const editedAt = new Date('2026-01-20T12:00:00.000Z')
  const january = JANUARY
  const february = FEBRUARY
  const march = MARCH

  /** A goal set mid-January for February: scheduled, with no month yet. */
  const scheduledForFebruary = (label: string) =>
    suite.seed(label, {
      status: 'scheduled',
      effectiveFrom: february.start,
      at: plannedAt,
    })

  const following = (previous: GoalProgramVersion, effectiveFrom: Date, target: number) =>
    followingVersion(previous, effectiveFrom, target, editedAt)

  // A replacement is decided from a read, and maintenance can open a month
  // under the same head at that moment. Both writers take the Program row
  // first, so whichever comes second sees what the first one wrote: the
  // cases above run them one after the other, these run them together.
  const RACES = 20
  const RACE_TIMEOUT_MS = 60_000

  it(
    'an activation and a replacement racing for one head never both win',
    async () => {
      for (let attempt = 0; attempt < RACES; attempt += 1) {
        const { repository, targetPropertyId, bundle } = await scheduledForFebruary(
          `Raced Activation Property ${attempt}`,
        )
        const replacement = following(bundle.version, february.start, 40)

        const [activated, replaced] = await Promise.all([
          repository.activate({
            bundle,
            results: [
              openMonth(
                bundle.assignments[0]!,
                february.start,
                february.end,
                february.start,
              ),
            ],
            at: february.start,
          }),
          repository.revise({
            expectedVersion: bundle.version,
            ...replacement,
            supersedeRowlessHead: true,
            actorId: 'manager-1',
            at: editedAt,
          }),
        ])

        const settled = await repository.getHistory(
          organizationId,
          targetPropertyId,
          bundle.program.id,
        )
        const outcome = {
          activated: activated !== null,
          replaced,
          status: settled?.program.status,
          currentVersion: settled?.program.currentVersion,
          openVersions: settled?.versions
            .filter((version) => version.effectiveTo === null)
            .map((version) => version.id),
          monthsUnder: settled?.results.map((monthly) => monthly.programVersionId),
        }
        expect([
          // The activation won: the head is in force and was not replaced.
          {
            activated: true,
            replaced: false,
            status: 'active',
            currentVersion: 1,
            openVersions: [bundle.version.id],
            monthsUnder: [bundle.version.id],
          },
          // The replacement won: the goal still waits, with no month at all.
          {
            activated: false,
            replaced: true,
            status: 'scheduled',
            currentVersion: 2,
            openVersions: [replacement.version.id],
            monthsUnder: [],
          },
        ]).toContainEqual(outcome)
      }
    },
    RACE_TIMEOUT_MS,
  )

  it(
    'opening a month under a pending change and replacing that change never both win',
    async () => {
      for (let attempt = 0; attempt < RACES; attempt += 1) {
        const repository = suite.repository()
        const targetPropertyId = await suite.createProperty(
          `Raced Pending Property ${attempt}`,
        )
        const running = suite.bundle({
          propertyId: targetPropertyId,
          status: 'active',
          effectiveFrom: january.start,
          at: january.start,
          withOpenResult: { end: january.end },
        })
        await repository.create({
          bundle: running,
          auditAction: 'goal.program.created',
        })
        const pending = following(running.version, february.start, 40)
        await repository.revise({
          expectedVersion: running.version,
          ...pending,
          supersedeRowlessHead: false,
          actorId: 'manager-1',
          at: editedAt,
        })
        const replacement = following(pending.version, february.start, 55)

        const [opened, replaced] = await Promise.all([
          repository.appendResults({
            program: { ...running.program, currentVersion: pending.version.version },
            version: pending.version,
            results: [
              openMonth(
                pending.assignments[0]!,
                february.start,
                february.end,
                february.start,
              ),
            ],
            at: february.start,
          }),
          repository.revise({
            expectedVersion: pending.version,
            ...replacement,
            supersedeRowlessHead: true,
            actorId: 'manager-1',
            at: editedAt,
          }),
        ])

        const settled = await repository.getHistory(
          organizationId,
          targetPropertyId,
          running.program.id,
        )
        const outcome = {
          opened,
          replaced,
          currentVersion: settled?.program.currentVersion,
          pendingWindowEnds: settled?.versions.find(
            (version) => version.id === pending.version.id,
          )?.effectiveTo,
          februaryUnder: settled?.results
            .filter(
              (monthly) => monthly.periodStart.getTime() === february.start.getTime(),
            )
            .map((monthly) => monthly.programVersionId),
        }
        expect([
          // February opened under the pending change, which is now in force.
          {
            opened: 1,
            replaced: false,
            currentVersion: 2,
            pendingWindowEnds: null,
            februaryUnder: [pending.version.id],
          },
          // The change was replaced first: no month sits under its empty window.
          {
            opened: 0,
            replaced: true,
            currentVersion: 3,
            pendingWindowEnds: february.start,
            februaryUnder: [],
          },
        ]).toContainEqual(outcome)
      }
    },
    RACE_TIMEOUT_MS,
  )

  it('maintenance activates a program whose history holds an empty version', async () => {
    const repository = suite.repository()
    const targetPropertyId = await suite.createProperty('Maintained Goal Property')
    const clock = { now: plannedAt }
    const actor: GoalActor = {
      organizationId,
      userId: 'manager-1',
      role: 'PropertyManager',
    }
    const service = createGoalProgramService({
      // Maintenance discovers Programs across tenants. This case narrows
      // discovery to its own Property; every read and write is PostgreSQL's.
      repository: {
        ...repository,
        listOperational: async () =>
          (await repository.listOperational()).filter(
            ({ program }) => program.propertyId === targetPropertyId,
          ),
        listDueResults: async () => [],
      },
      policy: { authorize: async () => undefined },
      subjects: {
        ratingSubjectsSkipPrivateRating: async () => false,
        staffTargetProblem: async () => null,
        getTimezone: async () => 'UTC',
        subjectBelongsToProperty: async () => true,
      },
      metrics: {
        queryGoalMetric: async (query) => ({
          definitionVersionId: query.definitionVersionId,
          metricKey: 'portal.rating_count',
          state: 'updating',
          exactValue: 0,
          sampleCount: 0,
          minimumSample: 0,
          sourceCompleteThrough: null,
          reason: 'source_reconciling',
        }),
        getApprovedGoalVersion: async (versionId) => findMetricVersionById(versionId),
      },
      id: randomUUID,
      now: () => clock.now,
    })
    const definition = {
      propertyId: targetPropertyId,
      metric: 'portal_rating_count',
      subjects: [{ kind: 'property', propertyId: targetPropertyId }],
    } as const
    const created = await service.create(
      { ...definition, name: 'February ratings', targetValue: 25 },
      actor,
    )
    expect(created.program.status).toBe('scheduled')
    clock.now = editedAt
    const revised = await service.revise(
      { ...definition, programId: created.program.id, targetValue: 40 },
      actor,
    )
    expect(revised.version).toMatchObject({
      version: 2,
      effectiveFrom: february.start,
      changeReason: 'revised',
    })

    clock.now = new Date('2026-02-01T00:10:00.000Z')
    await expect(service.maintain()).resolves.toMatchObject({
      inspected: 1,
      activated: 1,
      scheduledResults: 1,
      failed: 0,
    })
    const activated = await service.get(
      { propertyId: targetPropertyId, programId: created.program.id },
      actor,
    )
    expect(activated).toMatchObject({
      program: { status: 'active', currentVersion: 2 },
      version: { id: revised.version.id, targetValue: 40 },
      results: [{ programVersionId: revised.version.id, periodStart: february.start }],
    })
    expect(windowsOf(activated).versions).toEqual([
      [1, february.start, february.start],
      [2, february.start, null],
    ])

    // March has begun and the hourly job has not opened it yet: the next
    // revision opens it under the version in force and starts in April.
    clock.now = new Date('2026-03-01T00:10:00.000Z')
    const next = await service.revise(
      { ...definition, programId: created.program.id, targetValue: 55 },
      actor,
    )
    expect(next.version).toMatchObject({ version: 3, effectiveFrom: march.end })
    const settled = await service.get(
      { propertyId: targetPropertyId, programId: created.program.id },
      actor,
    )
    expect(
      settled.results.map((monthly) => [monthly.programVersionId, monthly.periodStart]),
    ).toEqual([
      [revised.version.id, february.start],
      [revised.version.id, march.start],
    ])
    expect(windowsOf(settled).versions).toEqual([
      [1, february.start, february.start],
      [2, february.start, march.end],
      [3, march.end, null],
    ])
  })
})
