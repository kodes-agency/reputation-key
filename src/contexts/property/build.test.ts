// Property context — build.ts tests
// Tests the PublicApi behavior and build wiring.

import { describe, it, expect } from 'vitest'
import { buildPropertyContext } from './build'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { organizationId, propertyId } from '#/shared/domain/ids'
import { buildTestProperty } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

const createStubStaffApi = (): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => null,
})

describe('PropertyPublicApi', () => {
  it('propertyExists returns true when repo has the property', async () => {
    const repo = createInMemoryPropertyRepo()
    const prop = buildTestProperty({ id: 'prop-1' })
    repo.seed([prop])

    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({ repo, events, clock, staffPublicApi })

    const exists = await publicApi.propertyExists(prop.organizationId, prop.id)
    expect(exists).toBe(true)
  })

  it('propertyExists returns false when repo does not have the property', async () => {
    const repo = createInMemoryPropertyRepo()
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({ repo, events, clock, staffPublicApi })

    const exists = await publicApi.propertyExists(
      organizationId('org-1'),
      propertyId('nonexistent'),
    )
    expect(exists).toBe(false)
  })
})
