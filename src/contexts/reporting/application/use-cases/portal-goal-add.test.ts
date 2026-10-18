import { describe, expect, it, vi } from 'vitest'
import type { GoalBulkCreateInput } from './goal-bulk-create'
import type { GoalActor } from './goal-programs'
import {
  actor,
  days,
  fakeWorld,
  NOV_22,
  portal,
  propertyGoal,
  PROPERTY_ID,
  readings,
} from './monthly-portal-goal-test-fixtures'
import { addPortalGoal, addPortalGoals, type PortalGoalAddDeps } from './portal-goal-add'

const RECEPTION = 'portal-reception'
const SPA = 'portal-spa'

/**
 * Nov 22, so December is offered. Reception: 9 private ratings in its 14 live
 * days, so 20 · 22 · 24 for December; Spa: live since October, nothing counted.
 */
function setup() {
  const { deps: world, calls } = fakeWorld({
    now: NOV_22,
    portals: [portal('Reception', '2026-11-08'), portal('Spa', '2026-10-01')],
    counts: {
      days: readings(RECEPTION, 'portal_rating_count', days('2026-11-08', 9)),
    },
    subjectNames: {
      [`portal:${RECEPTION}`]: 'Reception',
      'portal_group:group-1': 'Rooms',
    },
  })
  const created = propertyGoal('goal-new', 'portal_rating_count')
  const deps = {
    policy: world.policy,
    programs: {
      create: vi.fn(async () => {
        calls.push('create')
        return created
      }),
    },
    createForSubjects: vi.fn(async (input: GoalBulkCreateInput, _actor: GoalActor) => {
      calls.push('create for subjects')
      // The first row is saved; the others were taken a moment ago.
      return {
        outcomes: input.items.map(({ subject }, index) =>
          index === 0
            ? { subject, code: 'created' as const, programId: `goal-${index}` }
            : { subject, code: 'subject_has_goal' as const },
        ),
      }
    }),
    subjectNames: world.subjectNames,
    recommendation: world.recommendation,
    now: () => NOV_22,
  } satisfies PortalGoalAddDeps
  return { deps, calls }
}

const oneFor = (patch: Partial<Parameters<typeof addPortalGoal>[1]> = {}) => ({
  propertyId: PROPERTY_ID,
  subject: { kind: 'portal', portalId: RECEPTION } as const,
  metric: 'portal_rating_count' as const,
  targetValue: 22,
  startMonth: '2026-12',
  targetSource: 'recommended' as const,
  ...patch,
})

describe('adding a portal goal', () => {
  it('names a goal for one portal for it and its measure, recommended when it is so', async () => {
    const { deps, calls } = setup()

    await addPortalGoal(deps, oneFor(), actor)

    expect(calls[0]).toBe('authorize')
    expect(deps.programs.create).toHaveBeenCalledWith(
      {
        propertyId: PROPERTY_ID,
        name: 'Reception · Private ratings',
        description: null,
        metric: 'portal_rating_count',
        targetValue: 22,
        subjects: [{ kind: 'portal', portalId: RECEPTION }],
        startMonth: '2026-12',
        targetSource: 'recommended',
      },
      actor,
    )
  })

  it('records own for a number that is not the one offered, whatever was claimed', async () => {
    for (const request of [
      oneFor({ targetValue: 24 }),
      oneFor({ startMonth: '2026-11' }),
      oneFor({ metric: 'qualified_scans' }),
    ]) {
      const { deps } = setup()
      await addPortalGoal(deps, request, actor)
      expect(deps.programs.create).toHaveBeenCalledWith(
        expect.objectContaining({ targetSource: 'own' }),
        actor,
      )
    }
  })

  it('never makes a count goal for the Property alone: that is the Monthly portal goal', async () => {
    const { deps } = setup()

    await expect(
      addPortalGoal(deps, oneFor({ subject: { kind: 'property' } }), actor),
    ).rejects.toMatchObject({ code: 'invalid_subject' })
    await expect(
      addPortalGoal(deps, oneFor({ metric: 'portal_rating_average' }), actor),
    ).rejects.toMatchObject({ code: 'invalid_subject' })
    expect(deps.programs.create).not.toHaveBeenCalled()
  })

  it("the average is the Property's, named for its measure, its number the manager's own", async () => {
    const { deps } = setup()

    await addPortalGoal(
      deps,
      oneFor({
        subject: { kind: 'property' },
        metric: 'portal_rating_average',
        targetValue: 4.5,
      }),
      actor,
    )

    expect(deps.programs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Average private rating',
        subjects: [{ kind: 'property', propertyId: PROPERTY_ID }],
        targetValue: 4.5,
        targetSource: 'own',
      }),
      actor,
    )
  })

  it('refuses a portal or group it cannot name as invalid_subject', async () => {
    const { deps } = setup()

    await expect(
      addPortalGoal(
        deps,
        oneFor({ subject: { kind: 'portal', portalId: 'gone' } }),
        actor,
      ),
    ).rejects.toMatchObject({ code: 'invalid_subject' })
  })

  it("each portal: one goal per row, each row's source its own, saved or not", async () => {
    const { deps } = setup()

    const result = await addPortalGoals(
      deps,
      {
        propertyId: PROPERTY_ID,
        metric: 'portal_rating_count',
        startMonth: '2026-12',
        items: [
          { portalId: RECEPTION, targetValue: 22, targetSource: 'recommended' },
          { portalId: SPA, targetValue: 5, targetSource: 'recommended' },
        ],
      },
      actor,
    )

    expect(deps.createForSubjects).toHaveBeenCalledWith(
      {
        propertyId: PROPERTY_ID,
        metric: 'portal_rating_count',
        startMonth: '2026-12',
        items: [
          {
            subject: { kind: 'portal', portalId: RECEPTION },
            targetValue: 22,
            targetSource: 'recommended',
          },
          // Spa has no number to recommend.
          {
            subject: { kind: 'portal', portalId: SPA },
            targetValue: 5,
            targetSource: 'own',
          },
        ],
      },
      actor,
    )
    expect(result.outcomes).toEqual([
      { portalId: RECEPTION, saved: true },
      { portalId: SPA, saved: false },
    ])
  })

  it('each portal reads no recommendation when every number is its own', async () => {
    const { deps, calls } = setup()

    await addPortalGoals(
      deps,
      {
        propertyId: PROPERTY_ID,
        metric: 'portal_rating_count',
        startMonth: '2026-12',
        items: [{ portalId: RECEPTION, targetValue: 30, targetSource: 'own' }],
      },
      actor,
    )

    expect(calls).toEqual(['authorize', 'create for subjects'])
  })
})
