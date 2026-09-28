import { describe, expect, it, vi } from 'vitest'
import type { Permission } from '#/shared/domain/permissions'
import type { GoalSubject } from '../../domain/goal-program'
import type { GoalProgramBundle } from '../ports/goal-program.repository'
import { GoalProgramError, type GoalActor } from './goal-programs'
import {
  scopeGoalProgramsForMember,
  withGoalProgramVisibility,
  type GoalProgramVisibilityPort,
} from './goal-program-visibility'

const PROPERTY_ID = '00000000-0000-4000-8000-000000000002'

const actorWith = (...permissions: Permission[]): GoalActor => ({
  organizationId: '00000000-0000-4000-8000-000000000001',
  userId: 'user-1',
  role: 'Member',
  effectivePermissions: new Set(permissions),
})

/** A bundle with one assignment and one result per subject; only those fields are read. */
const bundle = (programId: string, subjects: readonly GoalSubject[]) =>
  ({
    program: { id: programId },
    assignments: subjects.map((subject, index) => ({
      id: `${programId}-assignment-${index}`,
      subject,
    })),
    results: subjects.map((_, index) => ({
      id: `${programId}-result-${index}`,
      assignmentId: `${programId}-assignment-${index}`,
    })),
  }) as unknown as GoalProgramBundle

const propertyWide = bundle('program-property', [
  { kind: 'property', propertyId: PROPERTY_ID },
])
const portalOnly = bundle('program-portal', [
  { kind: 'portal', portalId: 'portal-visible' },
  { kind: 'portal', portalId: 'portal-hidden' },
])
const hiddenGroup = bundle('program-group', [
  { kind: 'portal_group', portalGroupId: 'group-hidden' },
])

function setup(programs: readonly GoalProgramBundle[]) {
  const reads = {
    get: vi.fn(async () => programs[0]!),
    list: vi.fn(async () => programs),
  }
  const visibility = vi.fn<GoalProgramVisibilityPort>(async () => ({
    portalIds: ['portal-visible'],
    groupIds: [],
  }))
  return { reads, visibility, scoped: withGoalProgramVisibility(reads, visibility) }
}

describe('scopeGoalProgramsForMember', () => {
  it('returns only the assignments and results a Member may see', () => {
    const visible = scopeGoalProgramsForMember(
      [
        bundle('program-1', [
          { kind: 'property', propertyId: PROPERTY_ID },
          { kind: 'portal', portalId: 'portal-visible' },
          { kind: 'portal', portalId: 'portal-hidden' },
        ]),
        bundle('program-2', [{ kind: 'portal_group', portalGroupId: 'group-visible' }]),
        bundle('program-3', [{ kind: 'portal_group', portalGroupId: 'group-hidden' }]),
      ],
      ['portal-visible'],
      ['group-visible'],
    )

    expect(visible).toHaveLength(2)
    expect(visible[0]?.assignments.map(({ subject }) => subject)).toEqual([
      { kind: 'property', propertyId: PROPERTY_ID },
      { kind: 'portal', portalId: 'portal-visible' },
    ])
    expect(visible[0]?.results.map(({ id }) => id)).toEqual([
      'program-1-result-0',
      'program-1-result-1',
    ])
    expect(visible[1]?.assignments[0]?.subject).toEqual({
      kind: 'portal_group',
      portalGroupId: 'group-visible',
    })
  })
})

describe('withGoalProgramVisibility', () => {
  it('returns every Program unscoped to an actor who can create Goals', async () => {
    const { reads, visibility, scoped } = setup([propertyWide, portalOnly, hiddenGroup])
    const manager = actorWith('goal.read', 'goal.create')

    await expect(scoped.list(PROPERTY_ID, manager)).resolves.toEqual([
      propertyWide,
      portalOnly,
      hiddenGroup,
    ])
    await expect(
      scoped.get({ propertyId: PROPERTY_ID, programId: 'program-property' }, manager),
    ).resolves.toBe(propertyWide)
    expect(reads.list).toHaveBeenCalledWith(PROPERTY_ID, manager)
    expect(visibility).not.toHaveBeenCalled()
  })

  it('scopes Programs by current permissions, not the role label', async () => {
    const { visibility, scoped } = setup([propertyWide, portalOnly, hiddenGroup])
    const reader = actorWith('goal.read')

    const visible = await scoped.list(PROPERTY_ID, reader)

    expect(visibility).toHaveBeenCalledWith({ actor: reader, propertyId: PROPERTY_ID })
    expect(visible.map(({ program }) => program.id)).toEqual([
      'program-property',
      'program-portal',
    ])
    expect(visible[1]?.assignments.map(({ id }) => id)).toEqual([
      'program-portal-assignment-0',
    ])
    expect(visible[1]?.results.map(({ id }) => id)).toEqual(['program-portal-result-0'])
  })

  it('reports a Program the actor may not see as not found', async () => {
    const { scoped } = setup([hiddenGroup])

    await expect(
      scoped.get(
        { propertyId: PROPERTY_ID, programId: 'program-group' },
        actorWith('goal.read'),
      ),
    ).rejects.toMatchObject({ name: 'GoalProgramError', code: 'not_found' })
  })

  it('authorizes and loads before resolving visibility', async () => {
    const { reads, visibility, scoped } = setup([portalOnly])
    const refusal = new GoalProgramError('forbidden')
    reads.get.mockRejectedValue(refusal)

    await expect(
      scoped.get(
        { propertyId: PROPERTY_ID, programId: 'program-portal' },
        actorWith('goal.read'),
      ),
    ).rejects.toBe(refusal)
    expect(visibility).not.toHaveBeenCalled()
  })
})
