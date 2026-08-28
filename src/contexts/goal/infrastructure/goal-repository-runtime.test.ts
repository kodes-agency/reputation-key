import { describe, expect, it, vi } from 'vitest'
import type { Database } from '#/shared/db'
import type { LoggerPort } from '#/shared/domain/logger.port'
import { goalId, organizationId, propertyId, userId } from '#/shared/domain/ids'
import { createGoalRepository } from './repositories/goal.repository'

const FIXED_TIME = new Date('2026-08-28T09:30:00.000Z')

function loggerFixture(): Readonly<{
  root: LoggerPort
  child: LoggerPort
}> {
  const child: LoggerPort = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    child: vi.fn(),
  }
  const root: LoggerPort = {
    ...child,
    child: vi.fn(() => child),
  }
  return { root, child }
}

describe('createGoalRepository runtime dependencies', () => {
  it('measures repository duration with the injected monotonic clock', async () => {
    const row = {
      id: 'goal-1',
      organizationId: 'org-1',
      propertyId: 'property-1',
      portalId: null,
      portalGroupId: null,
      name: 'Monthly scans',
      description: null,
      createdBy: 'user-1',
      goalType: 'open',
      aggregationFunction: 'sum',
      metricKey: 'portal.scan',
      targetValue: 50,
      status: 'active',
      periodStart: null,
      periodEnd: null,
      recurrenceRule: null,
      rollingWindowDays: null,
      parentGoalId: null,
      completedAt: null,
      createdAt: FIXED_TIME,
      updatedAt: FIXED_TIME,
    }
    const db = {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ returning: vi.fn(async () => [row]) })),
      })),
    } as unknown as Database
    const logger = loggerFixture()
    const monotonicNow = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(1_037)
    const repository = createGoalRepository(db, {
      clock: () => FIXED_TIME,
      monotonicNow,
      logger: logger.root,
    })

    await repository.insert({
      organizationId: organizationId('org-1'),
      propertyId: propertyId('property-1'),
      portalId: null,
      portalGroupId: null,
      name: 'Monthly scans',
      description: null,
      createdBy: userId('user-1'),
      goalType: 'open',
      aggregationFunction: 'sum',
      metricKey: 'portal.scan',
      targetValue: 50,
      status: 'active',
      periodStart: null,
      periodEnd: null,
      recurrenceRule: null,
      rollingWindowDays: null,
      parentGoalId: null,
      completedAt: null,
    })

    expect(logger.root.child).toHaveBeenCalledWith({ component: 'goal-repo' })
    expect(logger.child.debug).toHaveBeenLastCalledWith(
      { duration: 37 },
      'goal insert complete',
    )
  })

  it('timestamps progress writes with the injected wall clock', async () => {
    let insertedValues: Record<string, unknown> | undefined
    const db = {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => [{ organizationId: 'org-1' }]),
          })),
        })),
      })),
      insert: vi.fn(() => ({
        values: vi.fn((values: Record<string, unknown>) => {
          insertedValues = values
          return {
            onConflictDoUpdate: vi.fn(() => ({
              returning: vi.fn(async () => [
                { currentValue: 4, currentSum: null, currentCount: null },
              ]),
            })),
          }
        }),
      })),
    } as unknown as Database
    const logger = loggerFixture()
    const repository = createGoalRepository(db, {
      clock: () => FIXED_TIME,
      monotonicNow: () => 0,
      logger: logger.root,
    })

    await repository.upsertProgress(goalId('goal-1'), organizationId('org-1'), 'sum', 4)

    expect(insertedValues).toMatchObject({ lastComputedAt: FIXED_TIME })
  })
})
