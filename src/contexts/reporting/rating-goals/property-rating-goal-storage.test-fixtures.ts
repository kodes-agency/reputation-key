// Shared setup for the Property Google rating goal storage suites: one held
// transaction per test, always rolled back, with two Organizations and three
// Properties seeded in it.

import { afterEach, beforeAll, beforeEach } from 'vitest'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import {
  holdTransaction,
  type HeldTransaction,
} from '#/shared/db/testing/held-transaction'
import type { NewPropertyRatingGoal } from './property-rating-goal-repository.port.server'
import { createPropertyRatingGoalRepository } from './property-rating-goal-repository.server'

export const ORG = 'org-rating-goal-repository-0001'
export const OTHER_ORG = 'org-rating-goal-repository-0002'
export const PROPERTY = '58000000-0000-4000-8000-000000000001'
export const OTHER_PROPERTY = '58000000-0000-4000-8000-000000000002'
export const FOREIGN_PROPERTY = '58000000-0000-4000-8000-000000000003'
export const SET_AT = new Date('2026-09-01T09:00:00.000Z')
export const LATER = new Date('2026-10-01T09:00:00.000Z')

let current: HeldTransaction

/** The transaction held for the running test. */
export const held = {
  get db() {
    return current.db
  },
  get client() {
    return current.client
  },
}

export const goalId = (n: number) =>
  `59000000-0000-4000-8000-${String(n).padStart(12, '0')}`

export const newGoal = (
  overrides: Partial<NewPropertyRatingGoal> = {},
): NewPropertyRatingGoal => ({
  id: goalId(1),
  organizationId: ORG,
  propertyId: PROPERTY,
  sourceEpoch: 2,
  mode: 'climb',
  targetTenths: 45,
  qualityTenths: 47,
  paceTenthsPerWeek: 110,
  baseline: { reviewCount: 812, googleAverage: 4.3, exactAverage: 4.31 },
  lastEvaluation: {
    displayedTenths: 43,
    status: 'getting_started',
    evaluatedAt: SET_AT,
    knownStatus: 'getting_started',
    belowPaceNoticedAt: null,
    tooLowNoticedAt: null,
  },
  createdBy: 'manager-1',
  createdAt: SET_AT,
  updatedAt: SET_AT,
  ...overrides,
})

export const repository = () => createPropertyRatingGoalRepository(held.db)

/** Runs a statement that must fail in a savepoint, so the held transaction survives. */
export async function refused(
  statement: () => Promise<unknown>,
): Promise<string | undefined> {
  try {
    await held.db.transaction(async () => {
      await statement()
    })
  } catch (error) {
    const cause = (error as { cause?: { code?: string } }).cause
    return cause?.code ?? (error as { code?: string }).code
  }
  return undefined
}

/** Opens the held transaction around each test and seeds the Organizations and Properties. */
export function useRatingGoalStorageTransaction(): void {
  beforeAll(() => {
    registerAllEventSchemas()
  })

  beforeEach(async () => {
    current = await holdTransaction()
    for (const org of [ORG, OTHER_ORG]) {
      await held.client.query(
        `INSERT INTO organization (id, name, slug, "createdAt") VALUES ($1, $1, $1, now())`,
        [org],
      )
    }
    for (const [id, org] of [
      [PROPERTY, ORG],
      [OTHER_PROPERTY, ORG],
      [FOREIGN_PROPERTY, OTHER_ORG],
    ] as const) {
      await held.client.query(
        `INSERT INTO properties (id, organization_id, name, slug, timezone, source_epoch)
         VALUES ($1::uuid, $2, $1::text, $1::text, 'Europe/Sofia', 2)`,
        [id, org],
      )
    }
  })

  afterEach(async () => {
    await current.rollBack()
  })
}
