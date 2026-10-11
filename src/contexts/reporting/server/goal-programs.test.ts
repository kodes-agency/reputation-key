import { withStartContext } from '#/shared/testing/tanstack-start-als'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GoalExecutionPolicy } from '../application/use-cases/goal-programs'

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  revise: vi.fn(),
  changeAssignments: vi.fn(),
  changeStatus: vi.fn(),
  get: vi.fn(),
  list: vi.fn(),
  progress: vi.fn(),
  programProgress: vi.fn(),
  monthPreview: vi.fn(),
  resolveTenantContext: vi.fn(),
  requireExecutionAllowed: vi.fn(),
}))

vi.mock('#/composition', () => ({
  getContainer: () => ({
    goalPublicApi: {
      programs: {
        create: mocks.create,
        revise: mocks.revise,
        changeAssignments: mocks.changeAssignments,
        changeStatus: mocks.changeStatus,
        get: mocks.get,
        list: mocks.list,
        progress: mocks.progress,
        programProgress: mocks.programProgress,
        monthPreview: mocks.monthPreview,
      },
    },
  }),
}))
vi.mock('#/shared/auth/headers', () => ({
  headersFromContext: vi.fn(async () => new Headers()),
}))
vi.mock('#/shared/auth/middleware', () => ({
  resolveTenantContext: mocks.resolveTenantContext,
}))
vi.mock('#/shared/auth/execution-policy', () => ({
  requireExecutionAllowed: mocks.requireExecutionAllowed,
}))

import { GoalProgramError } from '../application/use-cases/goal-programs'
import {
  changeGoalProgramAssignmentsSchema,
  createGoalProgramSchema,
  getGoalProgressSchema,
  previewGoalMonthSchema,
} from '../application/dto/goal-program.dto'
import {
  changeGoalProgramAssignments,
  changeGoalProgramStatus,
  createGoalProgram,
  getGoalProgram,
  getGoalProgramProgress,
  getGoalProgress,
  listGoalPrograms,
  previewGoalMonth,
  reviseGoalProgram,
} from './goal-programs'

const ORG_ID = '00000000-0000-4000-8000-000000000001'
const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'
const PORTAL_ID = '00000000-0000-4000-8000-000000000003'
const actor = {
  organizationId: ORG_ID,
  userId: 'manager-1',
  role: 'AccountAdmin',
} as const
const validInput = {
  propertyId: PROPERTY_ID,
  name: 'Monthly private ratings',
  description: null,
  metric: 'portal_rating_average' as const,
  targetValue: 4.5,
  subjects: [{ kind: 'portal' as const, portalId: PORTAL_ID }],
}

describe('canonical Goal Program server functions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveTenantContext.mockResolvedValue(actor)
    mocks.requireExecutionAllowed.mockResolvedValue(undefined)
  })

  it('validates and forwards one program with many canonical subjects', async () => {
    mocks.create.mockResolvedValue({ program: { id: 'program-1' } })

    await withStartContext(() => createGoalProgram({ data: validInput }))

    expect(mocks.create).toHaveBeenCalledWith(expect.any(Object), validInput, actor)
  })

  it('binds goal.use and the interactive permission to the resolved request', async () => {
    mocks.create.mockResolvedValue({ program: { id: 'program-1' } })
    await withStartContext(() => createGoalProgram({ data: validInput }))
    const policy = mocks.create.mock.calls[0]?.[0] as GoalExecutionPolicy

    await policy.authorize({
      actor,
      organizationId: ORG_ID,
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
    expect(mocks.requireExecutionAllowed).toHaveBeenCalledWith({
      actor,
      action: 'goal.create',
      capability: 'goal.use',
      propertyId: PROPERTY_ID,
    })

    await expect(
      policy.authorize({
        actor: { ...actor, userId: 'another-user' },
        organizationId: ORG_ID,
        propertyId: PROPERTY_ID,
        action: 'goal.create',
      }),
    ).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('forwards Goal Program reads to Reporting, which scopes them', async () => {
    const assignedOnlyActor = {
      ...actor,
      effectivePermissions: new Set(['goal.read']),
      scopeByPermission: new Map([['goal.read', 'assigned-properties']]),
    }
    mocks.resolveTenantContext.mockResolvedValue(assignedOnlyActor)
    const program = { program: { id: 'program-1' }, assignments: [], results: [] }
    mocks.get.mockResolvedValue(program)
    mocks.list.mockResolvedValue([program])
    const identity = {
      propertyId: PROPERTY_ID,
      programId: '00000000-0000-4000-8000-000000000004',
    }

    // The container offers no People or Portal lookups, so any scoping left in
    // the server function would fail these calls.
    await withStartContext(() => getGoalProgram({ data: identity }))
    await withStartContext(() => listGoalPrograms({ data: { propertyId: PROPERTY_ID } }))

    expect(mocks.get).toHaveBeenCalledWith(
      expect.any(Object),
      identity,
      assignedOnlyActor,
    )
    expect(mocks.list).toHaveBeenCalledWith(
      expect.any(Object),
      PROPERTY_ID,
      assignedOnlyActor,
    )
  })

  it('reads live goal progress for one subject through the request policy', async () => {
    const progress = [{ programId: 'program-1', reading: { kind: 'live', value: 3 } }]
    mocks.progress.mockResolvedValue(progress)
    const input = {
      propertyId: PROPERTY_ID,
      subject: {
        kind: 'portal_group' as const,
        portalGroupId: '00000000-0000-4000-8000-000000000005',
      },
    }

    await withStartContext(() => getGoalProgress({ data: input }))

    expect(mocks.progress).toHaveBeenCalledWith(expect.any(Object), input, actor)
  })

  it('forwards the chosen start month with the goal, and leaves it out when none is sent', async () => {
    mocks.create.mockResolvedValue({ program: { id: 'program-1' } })

    await withStartContext(() =>
      createGoalProgram({ data: { ...validInput, startMonth: '2026-10' } }),
    )
    await withStartContext(() => createGoalProgram({ data: validInput }))

    expect(mocks.create).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      { ...validInput, startMonth: '2026-10' },
      actor,
    )
    expect(mocks.create).toHaveBeenNthCalledWith(2, expect.any(Object), validInput, actor)
  })

  it('accepts a start month only as a calendar month key', () => {
    const withStart = (startMonth: unknown) =>
      createGoalProgramSchema.safeParse({ ...validInput, startMonth }).success

    expect(withStart('2026-10')).toBe(true)
    expect(withStart('2026-01')).toBe(true)
    for (const invalid of ['2026-13', '2026-00', '2026-1', '2026_10', 'next', '', 7]) {
      expect(withStart(invalid)).toBe(false)
    }
  })

  it.each(['subject_has_goal', 'start_month_changed'] as const)(
    'answers %s as a conflict the form can explain',
    async (code) => {
      mocks.create.mockRejectedValue(new GoalProgramError(code))

      await expect(
        withStartContext(() =>
          createGoalProgram({ data: { ...validInput, startMonth: '2026-10' } }),
        ),
      ).rejects.toMatchObject({ name: 'GoalProgramError', code, status: 409 })
    },
  )

  it('reads the month so far for every subject of one goal through the request policy', async () => {
    const progress = [
      {
        subject: { kind: 'portal', portalId: PORTAL_ID },
        progress: { programId: 'program-1', reading: { kind: 'live', value: 412 } },
      },
    ]
    mocks.programProgress.mockResolvedValue(progress)
    const identity = {
      propertyId: PROPERTY_ID,
      programId: '00000000-0000-4000-8000-000000000004',
    }

    await withStartContext(() => getGoalProgramProgress({ data: identity }))

    expect(mocks.programProgress).toHaveBeenCalledWith(
      expect.any(Object),
      identity,
      actor,
    )
  })

  it('reads the month so far for one subject before a goal exists', async () => {
    const preview = { metric: 'qualified_scans', reading: { kind: 'live', value: 412 } }
    mocks.monthPreview.mockResolvedValue(preview)
    const input = {
      propertyId: PROPERTY_ID,
      metric: 'qualified_scans' as const,
      subject: { kind: 'portal' as const, portalId: PORTAL_ID },
    }

    await withStartContext(() => previewGoalMonth({ data: input }))

    expect(mocks.monthPreview).toHaveBeenCalledWith(expect.any(Object), input, actor)
  })

  it('accepts a month preview only for a known measure and a subject that is an id', () => {
    const subject = { kind: 'portal' as const, portalId: PORTAL_ID }
    const base = { propertyId: PROPERTY_ID, metric: 'qualified_scans', subject }

    expect(previewGoalMonthSchema.safeParse(base).success).toBe(true)
    expect(
      previewGoalMonthSchema.safeParse({ ...base, metric: 'google_rating' }).success,
    ).toBe(false)
    expect(
      previewGoalMonthSchema.safeParse({
        ...base,
        subject: { kind: 'portal', portalId: 'not-an-id' },
      }).success,
    ).toBe(false)
  })

  it('accepts a progress read only for a subject that is an id', () => {
    const subject = { kind: 'portal_group' as const, portalGroupId: 'not-an-id' }
    expect(
      getGoalProgressSchema.safeParse({ propertyId: PROPERTY_ID, subject }).success,
    ).toBe(false)
  })

  it('rejects empty subjects and count targets are left to domain validation', () => {
    expect(
      createGoalProgramSchema.safeParse({ ...validInput, subjects: [] }).success,
    ).toBe(false)
    expect(
      createGoalProgramSchema.safeParse({
        ...validInput,
        metric: 'portal_rating_count',
        targetValue: 1.5,
      }).success,
    ).toBe(true)
  })

  it('validates and forwards one fenced bulk assignment snapshot', async () => {
    const input = {
      propertyId: PROPERTY_ID,
      programId: '00000000-0000-4000-8000-000000000004',
      expectedVersion: 3,
      add: [{ kind: 'portal' as const, portalId: PORTAL_ID }],
      remove: [],
      selectAllCurrentPortals: true,
      reason: 'Use the current Portal set',
    }
    mocks.changeAssignments.mockResolvedValue({
      programId: input.programId,
      previousVersion: 3,
      currentVersion: 4,
      outcomes: [],
    })

    await withStartContext(() => changeGoalProgramAssignments({ data: input }))

    expect(mocks.changeAssignments).toHaveBeenCalledWith(expect.any(Object), input, actor)
  })

  it('forwards a change without a note, and a revision with the version its form was opened on', async () => {
    const programId = '00000000-0000-4000-8000-000000000004'
    const revision = {
      propertyId: PROPERTY_ID,
      programId,
      metric: 'qualified_scans' as const,
      targetValue: 120,
      subjects: [{ kind: 'portal' as const, portalId: PORTAL_ID }],
      expectedVersion: 2,
    }
    const pause = { propertyId: PROPERTY_ID, programId, status: 'paused' as const }
    mocks.revise.mockResolvedValue({ version: { version: 3 } })
    mocks.changeStatus.mockResolvedValue({ id: programId, status: 'paused' })

    await withStartContext(() => reviseGoalProgram({ data: revision }))
    await withStartContext(() => changeGoalProgramStatus({ data: pause }))

    expect(mocks.revise).toHaveBeenCalledWith(expect.any(Object), revision, actor)
    expect(mocks.changeStatus).toHaveBeenCalledWith(expect.any(Object), pause, actor)
  })

  describe('a change that is refused', () => {
    const identity = {
      propertyId: PROPERTY_ID,
      programId: '00000000-0000-4000-8000-000000000004',
    }
    const revise = (): Promise<unknown> =>
      reviseGoalProgram({
        data: {
          ...identity,
          metric: 'qualified_scans',
          targetValue: 120,
          subjects: [{ kind: 'portal', portalId: PORTAL_ID }],
        },
      })
    const end = (): Promise<unknown> =>
      changeGoalProgramStatus({ data: { ...identity, status: 'ended' } })
    it.each([
      ['a revision', 'revision_conflict', mocks.revise, revise],
      ['a revision', 'subject_has_goal', mocks.revise, revise],
      ['a status change', 'revision_conflict', mocks.changeStatus, end],
    ] as const)(
      'answers %s refused with %s as a conflict',
      async (_name, code, mock, run) => {
        mock.mockRejectedValue(new GoalProgramError(code))

        await expect(withStartContext(run)).rejects.toMatchObject({
          name: 'GoalProgramError',
          code,
          status: 409,
        })
      },
    )
  })

  it('bounds the combined explicit bulk assignment request', () => {
    const subject = { kind: 'portal' as const, portalId: PORTAL_ID }
    expect(
      changeGoalProgramAssignmentsSchema.safeParse({
        propertyId: PROPERTY_ID,
        programId: '00000000-0000-4000-8000-000000000004',
        expectedVersion: 1,
        add: Array.from({ length: 250 }, () => subject),
        remove: [subject],
        selectAllCurrentPortals: false,
        reason: 'Too many explicit selections',
      }).success,
    ).toBe(false)
    expect(
      changeGoalProgramAssignmentsSchema.safeParse({
        propertyId: PROPERTY_ID,
        programId: '00000000-0000-4000-8000-000000000004',
        expectedVersion: 1,
        add: [],
        remove: [],
        selectAllCurrentPortals: false,
        reason: 'No operation',
      }).success,
    ).toBe(false)
  })
})
