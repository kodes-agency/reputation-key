// The harness's goal, Metric, Google numbers and merchant AI seeds, each read
// back through the server function that serves it.

import { describe, expect, it, vi } from 'vitest'
import {
  GOAL_CLEANUP_TABLES,
  GOAL_CLEANUP_TRIGGERS,
} from '#/shared/testing/server-function-goal-seeds'
import { setupServerFunctionHarness } from '#/shared/testing/server-function-harness'

vi.mock(
  '@tanstack/react-start',
  async () => (await import('#/shared/testing/compiled-server-fns')).startServerBuild,
)

import { getMerchantAiAuthorizationFn } from '#/contexts/identity/server/merchant-ai'
import {
  getGoalListProgress,
  listGoalPrograms,
} from '#/contexts/reporting/server/goal-programs'
import { getPropertyGoogleNumbersFn } from '#/contexts/reporting/server/property-google-numbers'
import { getRatingGoalSetup } from '#/contexts/reporting/server/rating-goals'

const NOW = new Date('2026-08-15T12:00:00.000Z')

const harness = setupServerFunctionHarness({
  clock: () => NOW,
  cleanupTables: GOAL_CLEANUP_TABLES,
  disabledTriggers: GOAL_CLEANUP_TRIGGERS,
})

async function hotel() {
  const organization = await harness.seedOrganization()
  const admin = await harness.seedMember(organization, 'AccountAdmin')
  const property = await harness.seedProperty(organization)
  return { organization, admin, property }
}

describe('server-function harness goal seeds', () => {
  it('seeds a Goal Program the Goals list shows', async () => {
    const { admin, property } = await hotel()
    const seeded = await harness.seedGoalProgram(property, { target: 25 })

    const listed = await harness.callAs(admin, () =>
      listGoalPrograms({ data: { propertyId: property.id } }),
    )

    expect(listed.programs.map((entry) => entry.program.id)).toEqual([seeded.programId])
  })

  it('seeds Metric readings the running month counts', async () => {
    const { admin, property } = await hotel()
    const seeded = await harness.seedGoalProgram(property, { target: 25 })
    await harness.seedMetricReading(property, {
      count: 3,
      at: new Date('2026-08-10T10:00:00.000Z'),
    })

    const progress = await harness.callAs(admin, () =>
      getGoalListProgress({ data: { propertyId: property.id } }),
    )

    expect(progress.goals).toEqual([
      expect.objectContaining({
        programId: seeded.programId,
        month: { reading: { kind: 'live', sampleCount: 3, value: 3 }, targetValue: 25 },
      }),
    ])
  })

  it('seeds the Google numbers of the Property', async () => {
    const { admin, property } = await hotel()
    await harness.seedGoogleNumbers(property, { reviewCount: 57, averageRating: 4.6 })

    const numbers = await harness.callAs(admin, () =>
      getPropertyGoogleNumbersFn({ data: { propertyId: property.id } }),
    )

    expect(numbers).toMatchObject({ reviewCount: 57, shows: 4.6 })
  })

  it('seeds an active Google rating goal', async () => {
    const { admin, property } = await hotel()
    const setup = () =>
      harness.callAs(admin, () =>
        getRatingGoalSetup({ data: { propertyId: property.id } }),
      )
    expect(await setup()).toMatchObject({ hasActiveGoal: false })

    await harness.seedRatingGoal(property, { createdBy: admin, targetTenths: 46 })

    expect(await setup()).toMatchObject({ hasActiveGoal: true })
  })

  it('seeds merchant AI consent on a Google-bound Property', async () => {
    const { organization, admin } = await hotel()
    const property = await harness.seedProperty(organization, { google: true })
    const consent = await harness.seedMerchantAiConsent(property, { actor: admin })

    const read = await harness.callAs(admin, () =>
      getMerchantAiAuthorizationFn({ data: { propertyId: property.id } }),
    )

    expect(consent.stateVersion).toBe(1)
    expect(read.authorization).toMatchObject({ state: 'enabled', stateVersion: 1 })
  })
})
