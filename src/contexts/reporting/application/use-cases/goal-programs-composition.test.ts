// The Goal Program service is composed from flat sibling modules behind the one
// GoalProgramService surface. No dependency is touched here: composing the
// service only builds closures, so an empty dependency object is enough.
import { describe, expect, it } from 'vitest'
import { changeAssignments } from './goal-program-assignment-changes'
import {
  GoalProgramMaintenanceError as MaintenanceModuleError,
  maintain,
  reconcileClosedResult,
  reconcileResult,
} from './goal-program-maintenance'
import { GoalProgramError as SharedGoalProgramError } from './goal-program-shared'
import {
  createGoalProgramService,
  GoalProgramError,
  GoalProgramMaintenanceError,
  type GoalProgramDependencies,
} from './goal-programs'

const SERVICE_METHODS = [
  'changeAssignments',
  'changeStatus',
  'create',
  'get',
  'list',
  'maintain',
  'reconcileClosedResult',
  'reconcileResult',
  'revise',
]

describe('Goal Program service composition', () => {
  it('exposes every command of the service once', () => {
    const service = createGoalProgramService({} as GoalProgramDependencies)

    expect(Object.keys(service).sort()).toEqual(SERVICE_METHODS)
    for (const method of SERVICE_METHODS) {
      expect(service).toHaveProperty(method, expect.any(Function))
    }
  })

  it('takes the assignment-change and maintenance commands from their own modules', () => {
    for (const command of [
      changeAssignments,
      maintain,
      reconcileResult,
      reconcileClosedResult,
    ]) {
      expect(command).toBeTypeOf('function')
    }
  })

  it('re-exports the one error class of each module, so instanceof holds everywhere', () => {
    expect(GoalProgramError).toBe(SharedGoalProgramError)
    expect(GoalProgramMaintenanceError).toBe(MaintenanceModuleError)
  })
})
