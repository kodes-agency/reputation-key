// Revising a Program, changing its subjects and renaming it start from one
// shared step, loadChangeableProgram: the Program must exist for the actor's
// organization and Property, and an ended Program takes no further change.
// goal-programs.test.ts pins only the ended refusal of changeAssignments; these
// cases pin the refusal of each command on each of the two paths, so a later
// rewrite of the shared step cannot loosen one of them unnoticed.
import { describe, expect, it, vi } from 'vitest'
import type {
  GoalProgram,
  GoalProgramBundle,
  GoalProgramRepository,
  GoalProgramVersion,
} from '../ports/goal-program.repository'
import {
  createGoalProgramService,
  type GoalActor,
  type GoalProgramDependencies,
} from './goal-programs'

const actor: GoalActor = {
  organizationId: 'org-1',
  userId: 'manager-1',
  role: 'PropertyManager',
}

const AT = new Date('2026-03-10T00:00:00.000Z')

const program: GoalProgram = {
  id: 'program-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  name: 'March ratings',
  description: null,
  status: 'ended',
  statusReason: 'Program archived by manager',
  currentVersion: 1,
  createdBy: 'manager-1',
  createdAt: AT,
  updatedAt: AT,
}

const version: GoalProgramVersion = {
  id: 'version-1',
  programId: 'program-1',
  organizationId: 'org-1',
  propertyId: 'property-1',
  version: 1,
  metricDefinitionId: 'definition-1',
  metricDefinitionVersionId: 'definition-version-1',
  metric: 'portal_rating_count',
  metricMinimumSample: 0,
  targetValue: 20,
  propertyTimezone: 'UTC',
  effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
  effectiveTo: null,
  changeReason: 'created',
  createdBy: 'manager-1',
  createdAt: AT,
}

const endedBundle: GoalProgramBundle = {
  program,
  version,
  versions: [version],
  assignments: [],
  results: [],
}

function serviceWithStoredProgram(stored: GoalProgramBundle | null) {
  const get = vi.fn(async () => stored)
  const authorize = vi.fn(async () => undefined)
  const deps: GoalProgramDependencies = {
    // Only `get` may be reached: a refused command must stop before any write,
    // metric read or subject lookup, so a call to anything else throws.
    repository: { get } as unknown as GoalProgramRepository,
    policy: { authorize },
    subjects: {} as unknown as GoalProgramDependencies['subjects'],
    metrics: {} as unknown as GoalProgramDependencies['metrics'],
    id: () => 'generated-id',
    now: () => AT,
  }
  return { service: createGoalProgramService(deps), get }
}

type Service = ReturnType<typeof serviceWithStoredProgram>['service']

const COMMANDS: ReadonlyArray<
  readonly [name: string, run: (service: Service, programId: string) => Promise<unknown>]
> = [
  [
    'revise',
    (service, programId) =>
      service.revise(
        {
          propertyId: 'property-1',
          programId,
          metric: 'portal_rating_count',
          targetValue: 30,
          subjects: [{ kind: 'portal', portalId: 'portal-1' }],
          reason: 'Raise the target',
        },
        actor,
      ),
  ],
  [
    'changeAssignments',
    (service, programId) =>
      service.changeAssignments(
        {
          propertyId: 'property-1',
          programId,
          expectedVersion: 1,
          add: [{ kind: 'portal', portalId: 'portal-2' }],
          remove: [],
          selectAllCurrentPortals: false,
          reason: 'Add a portal',
        },
        actor,
      ),
  ],
  [
    'rename',
    (service, programId) =>
      service.rename(
        { propertyId: 'property-1', programId, name: 'April ratings' },
        actor,
      ),
  ],
]

describe.each(COMMANDS)('%s on a Program it cannot change', (_name, run) => {
  it('refuses an unknown Program with not_found, looked up for the actor organization and Property', async () => {
    const { service, get } = serviceWithStoredProgram(null)

    await expect(run(service, 'missing-program')).rejects.toMatchObject({
      name: 'GoalProgramError',
      code: 'not_found',
    })
    expect(get).toHaveBeenCalledWith('org-1', 'property-1', 'missing-program')
  })

  it('refuses an ended Program with invalid_transition', async () => {
    const { service } = serviceWithStoredProgram(endedBundle)

    await expect(run(service, 'program-1')).rejects.toMatchObject({
      name: 'GoalProgramError',
      code: 'invalid_transition',
    })
  })
})
