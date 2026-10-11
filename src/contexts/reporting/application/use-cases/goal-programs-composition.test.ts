// The Goal Program service is composed from flat sibling modules behind the one
// GoalProgramService surface. Composing the service only builds closures, so
// the first case needs no dependencies; the second gives `maintain` only the
// two repository reads and the clock it uses on a system with nothing to do.
import { describe, expect, it, vi } from 'vitest'
import { GoalProgramMaintenanceError as MaintenanceModuleError } from './goal-program-maintenance'
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

  it('runs maintain through the maintenance module, with the injected clock', async () => {
    const now = new Date('2026-03-10T00:00:00.000Z')
    const listOperational = vi.fn(async () => [])
    const listDueResults = vi.fn(async () => [])
    const service = createGoalProgramService({
      repository: { listOperational, listDueResults },
      now: () => now,
    } as unknown as GoalProgramDependencies)

    await expect(service.maintain()).resolves.toEqual({
      inspected: 0,
      activated: 0,
      scheduledResults: 0,
      reconciled: 0,
      closed: 0,
      denied: 0,
      unavailable: 0,
      stranded: 0,
      failed: 0,
    })
    expect(listOperational).toHaveBeenCalledTimes(1)
    expect(listDueResults).toHaveBeenCalledWith(now)
  })

  it('re-exports the one error class of each module, so instanceof holds everywhere', () => {
    expect(GoalProgramError).toBe(SharedGoalProgramError)
    expect(GoalProgramMaintenanceError).toBe(MaintenanceModuleError)
  })
})
