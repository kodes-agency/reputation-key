// Property context — build.ts tests
// Tests the PublicApi behavior and build wiring.

import { describe, it, expect, vi } from 'vitest'
import { buildPropertyContext } from './build'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import { organizationId, propertyId, userId } from '#/shared/domain/ids'
import { buildTestProperty } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'

vi.mock('#/shared/observability/logger', () => ({
  getLogger: () => ({
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => ({
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    }),
  }),
}))

vi.mock('#/shared/observability/trace', () => ({
  trace: async (_name: string, fn: () => Promise<unknown>) => fn(),
}))

const createStubStaffApi = (): StaffPublicApi => ({
  getAccessiblePropertyIds: async () => null,
  getAssignedPortals: async () => [],
  countAssignmentsByTeam: async () => 0,
})

const identityPublicApi = { listActiveManagers: async () => [] }

describe('PropertyPublicApi', () => {
  it('propertyExists returns true when repo has the property', async () => {
    const repo = createInMemoryPropertyRepo()
    const prop = buildTestProperty({ id: 'prop-1' })
    repo.seed([prop])

    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      events,
      clock,
      localCell: 'us',
      staffPublicApi,
      identityPublicApi,
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    const exists = await publicApi.propertyExists(prop.organizationId, prop.id)
    expect(exists).toBe(true)
  })

  it('propertyExists returns false when repo does not have the property', async () => {
    const repo = createInMemoryPropertyRepo()
    const events = createCapturingEventBus()
    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      events,
      clock,
      localCell: 'us',
      staffPublicApi,
      identityPublicApi,
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    const exists = await publicApi.propertyExists(
      organizationId('org-1'),
      propertyId('nonexistent'),
    )
    expect(exists).toBe(false)
  })

  it('revalidates a direct notification recipient and fails closed for a deleted property', async () => {
    const repo = createInMemoryPropertyRepo()
    const prop = buildTestProperty({ id: 'prop-1' })
    repo.seed([prop])
    const managerId = userId('admin-1')
    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      events: createCapturingEventBus(),
      clock: () => new Date('2025-01-01'),
      localCell: 'us',
      staffPublicApi: createStubStaffApi(),
      identityPublicApi: {
        listActiveManagers: async () => [
          {
            userId: managerId,
            role: 'AccountAdmin' as const,
            propertyAccessScope: 'organization' as const,
          },
        ],
      },
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    await expect(
      publicApi.isEligibleResponsibleManagerUserId(
        prop.organizationId,
        prop.id,
        managerId,
      ),
    ).resolves.toBe(true)
    await expect(
      publicApi.isEligibleResponsibleManagerUserId(
        prop.organizationId,
        propertyId('deleted-property'),
        managerId,
      ),
    ).resolves.toBe(false)
  })
})
