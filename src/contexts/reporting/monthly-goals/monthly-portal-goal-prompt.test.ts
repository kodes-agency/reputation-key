import { describe, expect, it, vi } from 'vitest'
import { GoalProgramError } from '../application/use-cases/goal-program-shared'
import {
  deferMonthlyPortalGoalPrompt,
  keepMonthlyPortalGoal,
  type MonthlyPortalGoalKeepDeps,
  type MonthlyPortalGoalPromptDeps,
} from './monthly-portal-goal.server'
import { readMonthlyPortalGoalCard } from './monthly-portal-goal-card.server'
import {
  DEC_1,
  NOV_1,
  OCT_23,
  PROPERTY_ID,
  actor,
  days,
  fakeWorld as seaviewWorld,
  portal,
  propertyGoal,
  readings,
} from './monthly-portal-goal.test-fixtures'
import type { GoalProgramBundle } from '../application/ports/goal-program.repository'
import {
  asked,
  changeWorld,
  existing,
} from './monthly-portal-goal-commands.test-fixtures'

// ─── The month-start check-in ─────────────────────────────────

describe('keepMonthlyPortalGoal', () => {
  const JAN_1 = new Date('2026-12-31T22:00:00.000Z')
  /** Dec 3, noon in Sofia. */
  const DEC_3 = new Date('2026-12-03T10:00:00.000Z')
  const KEEP = {
    propertyId: PROPERTY_ID,
    programId: 'monthly',
    month: '2026-12',
  } as const

  /** Running since November at 40; November is being read, December has opened. */
  const runningDecember = () =>
    propertyGoal('monthly', 'portal_rating_count', {
      status: 'active',
      months: [
        { start: NOV_1, end: DEC_1, status: 'reconciling' },
        { start: DEC_1, end: JAN_1 },
      ],
    })

  /** Keep over an in-memory Property, with the engine's change commands watched. */
  function keepWorld(
    programs: readonly GoalProgramBundle[] = [runningDecember()],
    now: Date = DEC_3,
  ) {
    const { deps: change, calls } = changeWorld(programs, now)
    const deps = {
      policy: change.policy,
      repository: {
        list: change.repository.list,
        answerCheckIn: vi.fn(async () => {
          calls.push('answer')
          return true
        }),
      },
      now: change.now,
    } satisfies MonthlyPortalGoalKeepDeps
    return { deps, calls, change }
  }

  it('Keep writes the answered month without a version bump', async () => {
    const { deps, calls, change } = keepWorld()

    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).resolves.toEqual({
      month: '2026-12',
    })

    expect(deps.repository.answerCheckIn).toHaveBeenCalledWith({
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      programId: 'monthly',
      month: '2026-12',
    })
    // No version and no change row: none of the engine's commands runs.
    expect(change.programs.changeMonthTarget).not.toHaveBeenCalled()
    expect(change.programs.revise).not.toHaveBeenCalled()
    expect(change.programs.changeStatus).not.toHaveBeenCalled()
    expect(asked(change)).toEqual(['goal.update'])
    expect(calls).toEqual(['authorize', 'programs', 'answer'])
  })

  it('Keep twice is idempotent', async () => {
    const { deps } = keepWorld()

    await keepMonthlyPortalGoal(deps, KEEP, actor)
    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).resolves.toEqual({
      month: '2026-12',
    })

    expect(vi.mocked(deps.repository.answerCheckIn).mock.calls).toEqual([
      [
        {
          organizationId: 'org-1',
          propertyId: PROPERTY_ID,
          programId: 'monthly',
          month: '2026-12',
        },
      ],
      [
        {
          organizationId: 'org-1',
          propertyId: PROPERTY_ID,
          programId: 'monthly',
          month: '2026-12',
        },
      ],
    ])
  })

  it('Keep on day 8 is check_in_closed', async () => {
    // 23:59 on Dec 7 in Sofia is the check-in's last minute; midnight closes it.
    const lastMinute = keepWorld(
      [runningDecember()],
      new Date('2026-12-07T21:59:00.000Z'),
    )
    const day8 = keepWorld([runningDecember()], new Date('2026-12-07T22:00:00.000Z'))

    await expect(keepMonthlyPortalGoal(lastMinute.deps, KEEP, actor)).resolves.toEqual({
      month: '2026-12',
    })
    await expect(keepMonthlyPortalGoal(day8.deps, KEEP, actor)).rejects.toEqual(
      new GoalProgramError('check_in_closed'),
    )
    expect(day8.deps.repository.answerCheckIn).not.toHaveBeenCalled()
  })

  it('a month that is not the one running is check_in_closed', async () => {
    // A card read on Nov 7, pressed on Dec 3.
    const { deps } = keepWorld()

    await expect(
      keepMonthlyPortalGoal(deps, { ...KEEP, month: '2026-11' }, actor),
    ).rejects.toEqual(new GoalProgramError('check_in_closed'))
    expect(deps.repository.answerCheckIn).not.toHaveBeenCalled()
  })

  it('a stopped goal takes no Keep', async () => {
    // Stopped on Dec 2: December still counts, and there is nothing to keep.
    const stopped = propertyGoal('monthly', 'portal_rating_count', {
      status: 'ended',
      until: JAN_1,
      endedAt: new Date('2026-12-02T08:00:00.000Z'),
      months: [
        { start: NOV_1, end: DEC_1, status: 'reconciling' },
        { start: DEC_1, end: JAN_1 },
      ],
    })
    const { deps } = keepWorld([stopped])

    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).rejects.toEqual(
      new GoalProgramError('invalid_transition'),
    )
    expect(deps.repository.answerCheckIn).not.toHaveBeenCalled()
  })

  it('a goal stopped while Keep was on its way is invalid_transition', async () => {
    const { deps } = keepWorld()
    deps.repository.answerCheckIn.mockResolvedValueOnce(false)

    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).rejects.toEqual(
      new GoalProgramError('invalid_transition'),
    )
  })

  it('refuses a goal that is not the monthly portal goal', async () => {
    const { deps } = keepWorld([
      runningDecember(),
      existing('reception', {
        subject: { kind: 'portal', portalId: 'portal-reception' },
      }),
    ])

    await expect(
      keepMonthlyPortalGoal(deps, { ...KEEP, programId: 'reception' }, actor),
    ).rejects.toEqual(new GoalProgramError('invalid_subject'))
    expect(deps.repository.answerCheckIn).not.toHaveBeenCalled()
  })

  it('a refused actor reads and writes nothing', async () => {
    const { deps, calls } = keepWorld()
    deps.policy.authorize.mockRejectedValueOnce(new GoalProgramError('forbidden'))

    await expect(keepMonthlyPortalGoal(deps, KEEP, actor)).rejects.toMatchObject({
      code: 'forbidden',
    })
    expect(calls).toEqual([])
  })
})

describe("the Overview prompt's Not now", () => {
  // Seaview on Sofia time: Reception live since Sep 20 with a private rating a
  // day, so its number is ready all October. Through the 20th the prompt names
  // October; from the 21st, November.
  const OCT_10 = new Date('2026-10-10T09:00:00.000Z')
  const world = (now: Date = OCT_10) => {
    const { deps, calls } = seaviewWorld({
      now,
      portals: [portal('Reception', '2026-09-20')],
      counts: {
        days: readings('portal-reception', 'portal_rating_count', days('2026-09-20', 20)),
      },
    })
    const command = {
      policy: deps.policy,
      subjects: deps.recommendation.subjects,
      prompts: deps.prompts,
      now: deps.now,
    } satisfies MonthlyPortalGoalPromptDeps
    return { deps, command, calls }
  }
  const promptOf = async (deps: ReturnType<typeof world>['deps'], now: Date) => {
    const card = await readMonthlyPortalGoalCard(
      { ...deps, now: () => now },
      { propertyId: PROPERTY_ID },
      actor,
    )
    return card.state === 'ready' ? card.prompt : null
  }

  it("Not now hides this month's prompt and not next month's", async () => {
    const { deps, command } = world()
    await expect(promptOf(deps, OCT_10)).resolves.toMatchObject({
      month: '2026-10',
      deferred: false,
    })

    await deferMonthlyPortalGoalPrompt(
      command,
      { propertyId: PROPERTY_ID, month: '2026-10' },
      actor,
    )

    await expect(promptOf(deps, OCT_10)).resolves.toMatchObject({
      month: '2026-10',
      deferred: true,
    })
    // After the 20th the prompt names November, which nobody put off.
    await expect(promptOf(deps, OCT_23)).resolves.toMatchObject({
      month: '2026-11',
      deferred: false,
    })
  })

  it('asks goal.create first, then records the month it named, by whom and when', async () => {
    const { command, calls } = world()

    await expect(
      deferMonthlyPortalGoalPrompt(
        command,
        { propertyId: PROPERTY_ID, month: '2026-10' },
        actor,
      ),
    ).resolves.toEqual({ month: '2026-10' })

    expect(calls).toEqual(['authorize', 'defer'])
    expect(command.policy.authorize).toHaveBeenCalledWith({
      actor,
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      action: 'goal.create',
    })
    expect(command.prompts.defer).toHaveBeenCalledWith({
      organizationId: 'org-1',
      propertyId: PROPERTY_ID,
      month: '2026-10',
      deferredBy: 'elena',
      deferredAt: OCT_10,
    })
  })

  it("takes a month already gone (a tab left open), and never a month after next month's", async () => {
    const { command } = world(OCT_23)

    await deferMonthlyPortalGoalPrompt(
      command,
      { propertyId: PROPERTY_ID, month: '2026-10' },
      actor,
    )
    await deferMonthlyPortalGoalPrompt(
      command,
      { propertyId: PROPERTY_ID, month: '2026-11' },
      actor,
    )
    await expect(
      deferMonthlyPortalGoalPrompt(
        command,
        { propertyId: PROPERTY_ID, month: '2026-12' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'start_month_changed' })

    expect(
      vi.mocked(command.prompts.defer).mock.calls.map(([{ month }]) => month),
    ).toEqual(['2026-10', '2026-11'])
  })

  it('a refused actor and a Property with no time zone write nothing', async () => {
    const refused = world()
    vi.mocked(refused.command.policy.authorize).mockRejectedValueOnce(
      new GoalProgramError('forbidden'),
    )
    await expect(
      deferMonthlyPortalGoalPrompt(
        refused.command,
        { propertyId: PROPERTY_ID, month: '2026-10' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'forbidden' })

    const unknown = world()
    vi.mocked(unknown.command.subjects.getTimezone).mockResolvedValueOnce(null)
    await expect(
      deferMonthlyPortalGoalPrompt(
        unknown.command,
        { propertyId: PROPERTY_ID, month: '2026-10' },
        actor,
      ),
    ).rejects.toMatchObject({ code: 'not_found' })

    expect(refused.command.prompts.defer).not.toHaveBeenCalled()
    expect(unknown.command.prompts.defer).not.toHaveBeenCalled()
  })
})
