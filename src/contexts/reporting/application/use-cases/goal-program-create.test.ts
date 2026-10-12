// createGoalCore writes one Program for a start period its caller resolved.
// The request command around it (authorise, resolve the month) is covered
// through the service in goal-programs.test.ts; these cases pin what the core
// owes a caller that resolves the month once for several goals.
import { describe, expect, it, vi } from 'vitest'
import { METRIC_VERSION_IDS } from '../../domain/metric-registry'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import { createGoalCore } from './goal-program-create'
import type { GoalActor, GoalProgramDependencies } from './goal-program-shared'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}
const MID_MARCH = new Date('2026-03-15T12:00:00.000Z')
const UTC_MARCH = {
  start: new Date('2026-03-01T00:00:00.000Z'),
  end: new Date('2026-04-01T00:00:00.000Z'),
}
const UTC_APRIL = {
  start: new Date('2026-04-01T00:00:00.000Z'),
  end: new Date('2026-05-01T00:00:00.000Z'),
}
const definition = {
  propertyId: 'property-1',
  name: 'Lobby ratings',
  metric: 'portal_rating_count',
  targetValue: 25,
  subjects: [{ kind: 'portal', portalId: 'portal-1' }],
} as const

function setup(timezone = 'UTC') {
  let id = 0
  const fakes = {
    repository: {
      create: vi.fn(async (_input: { bundle: GoalProgramBundle }) => 'created' as const),
      findAssignmentConflicts: vi.fn(async () => []),
    },
    policy: { authorize: vi.fn(async () => undefined) },
    subjects: {
      getTimezone: vi.fn(async () => timezone),
      subjectBelongsToProperty: vi.fn(async () => true),
    },
    metrics: {
      queryGoalMetric: vi.fn(async () => ({
        definitionVersionId: METRIC_VERSION_IDS.portalRatingCountGoal,
        metricKey: 'portal.rating_count',
        state: 'updating',
        exactValue: 0,
        sampleCount: 0,
        minimumSample: 0,
        sourceCompleteThrough: null,
        reason: 'source_reconciling',
      })),
      getApprovedGoalVersion: vi.fn(async (versionId: string) => ({
        definition: { id: `definition-${versionId}` },
        version: { id: versionId, minimumSample: 0 },
      })),
    },
    id: () => `id-${++id}`,
    // The core never asks the clock: its caller's instant is the one it writes.
    now: vi.fn(() => new Date('2030-01-01T00:00:00.000Z')),
  }
  return { fakes, deps: fakes as unknown as GoalProgramDependencies }
}

describe('createGoalCore', () => {
  it('writes the goal for the period and instant its caller resolved', async () => {
    const { fakes, deps } = setup()

    const bundle = await createGoalCore(deps, definition, actor, {
      now: MID_MARCH,
      period: UTC_MARCH,
    })

    expect(bundle.program).toMatchObject({
      status: 'active',
      createdAt: MID_MARCH,
      updatedAt: MID_MARCH,
    })
    expect(bundle.version).toMatchObject({
      effectiveFrom: UTC_MARCH.start,
      createdAt: MID_MARCH,
    })
    expect(bundle.results).toEqual([
      expect.objectContaining({
        periodStart: UTC_MARCH.start,
        periodEnd: UTC_MARCH.end,
        createdAt: MID_MARCH,
      }),
    ])
    expect(fakes.now).not.toHaveBeenCalled()
    // Authorising is the caller's: one check covers every goal of one save.
    expect(fakes.policy.authorize).not.toHaveBeenCalled()
    expect(fakes.repository.create).toHaveBeenCalledWith({
      bundle,
      auditAction: 'goal.program.created',
    })
  })

  it('schedules a goal whose period has not begun at the caller’s instant', async () => {
    const { deps } = setup()

    const bundle = await createGoalCore(deps, definition, actor, {
      now: MID_MARCH,
      period: UTC_APRIL,
    })

    expect(bundle.program).toMatchObject({
      status: 'scheduled',
      statusReason: 'awaiting_first_full_month',
    })
    expect(bundle.results).toEqual([])
  })

  // The month was resolved under one time zone and the Property now has
  // another: UTC March is not a month on Sofia's calendar. Saving it would
  // pin a period the database refuses for that zone.
  it('refuses a period that is not a complete month in the Property’s time zone', async () => {
    const { fakes, deps } = setup('Europe/Sofia')

    await expect(
      createGoalCore(deps, definition, actor, { now: MID_MARCH, period: UTC_MARCH }),
    ).rejects.toMatchObject({ code: 'start_month_changed' })

    expect(fakes.repository.findAssignmentConflicts).not.toHaveBeenCalled()
    expect(fakes.metrics.queryGoalMetric).not.toHaveBeenCalled()
    expect(fakes.repository.create).not.toHaveBeenCalled()
  })

  it('refuses a blank name before it reads anything', async () => {
    const { fakes, deps } = setup()

    await expect(
      createGoalCore(deps, { ...definition, name: '   ' }, actor, {
        now: MID_MARCH,
        period: UTC_MARCH,
      }),
    ).rejects.toMatchObject({ code: 'invalid_name' })

    expect(fakes.subjects.getTimezone).not.toHaveBeenCalled()
    expect(fakes.repository.create).not.toHaveBeenCalled()
  })

  it('checks that the subjects are free before it asks whether the measure can be read', async () => {
    const { fakes, deps } = setup()
    fakes.repository.findAssignmentConflicts.mockResolvedValueOnce([
      {
        subject: { kind: 'portal', portalId: 'portal-1' },
        programId: 'program-live',
        effectiveTo: null,
      },
    ] as never)

    await expect(
      createGoalCore(deps, definition, actor, { now: MID_MARCH, period: UTC_MARCH }),
    ).rejects.toMatchObject({ code: 'subject_has_goal' })

    expect(fakes.metrics.queryGoalMetric).not.toHaveBeenCalled()
    expect(fakes.repository.create).not.toHaveBeenCalled()
  })
})
