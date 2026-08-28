// Property context — build.ts tests
// Tests the PublicApi behavior and build wiring.

import { describe, it, expect, vi } from 'vitest'
import { buildPropertyContext } from './build'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import { createCapturingEventBus } from '#/shared/testing/capturing-event-bus'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
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
})

const identityManagerFacts = { listActiveManagers: async () => [] }
const runtimeDeps = {
  idGen: () => '81000000-0000-4000-8000-000000000099',
  logger: {
    info: () => {},
    warn: () => {},
  },
} as const

describe('PropertyPublicApi', () => {
  it('returns one standard publicApi/internal boundary for every cross-context seam', () => {
    const context = buildPropertyContext({
      db: {} as never,
      repo: createInMemoryPropertyRepo(),
      events: createCapturingEventBus(),
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      localCell: 'us',
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    // ARC-03-T11: `responsibility` is the named member-authority capability.
    // LIF-01: `organizationExportContributor` is lifecycle composition input,
    // so it sits beside publicApi rather than inside it.
    expect(Object.keys(context).sort()).toEqual([
      'internal',
      'organizationExportContributor',
      'publicApi',
      'responsibility',
      'worker',
    ])
    expect(context.organizationExportContributor.context).toBe('property')
    expect(Object.keys(context.publicApi)).not.toContain('organizationExportContributor')
    expect(Object.keys(context.internal).sort()).toEqual(['repos', 'useCases'])
    expect(context.worker.registerOutboxConsumers).toBeTypeOf('function')
    expect(context.publicApi.management).toBeDefined()
    expect(context.publicApi).toHaveProperty('readInternal')
    expect(context.publicApi).toHaveProperty('createBoundProperty')
  })

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
      ...runtimeDeps,
      localCell: 'us',
      staffPublicApi,
      identityManagerFacts,
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
      ...runtimeDeps,
      localCell: 'us',
      staffPublicApi,
      identityManagerFacts,
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    const exists = await publicApi.propertyExists(
      organizationId('org-1'),
      propertyId('nonexistent'),
    )
    expect(exists).toBe(false)
  })

  it('exposes current lifecycle authority without treating archived or missing Properties as active', async () => {
    const repo = createInMemoryPropertyRepo()
    const active = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000030',
      slug: 'lifecycle-active',
      lifecycleState: 'active',
    })
    const archived = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000031',
      slug: 'lifecycle-archived',
      lifecycleState: 'archived',
    })
    repo.seed([active, archived])
    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      events: createCapturingEventBus(),
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      localCell: 'us',
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    await expect(
      publicApi.isPropertyActive(active.organizationId, active.id),
    ).resolves.toBe(true)
    await expect(
      publicApi.isPropertyActive(archived.organizationId, archived.id),
    ).resolves.toBe(false)
    await expect(
      publicApi.isPropertyActive(
        active.organizationId,
        propertyId('81000000-0000-4000-8000-000000000099'),
      ),
    ).resolves.toBe(false)
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
      ...runtimeDeps,
      localCell: 'us',
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts: {
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

  it('chooses a stable Google notice scope, preferring a linked Property', async () => {
    const repo = createInMemoryPropertyRepo()
    const connection = googleConnectionId('81000000-0000-4000-8000-000000000001')
    const first = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000010',
      slug: 'notice-first',
    })
    const linked = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000020',
      slug: 'notice-linked',
      googleConnectionId: connection,
    })
    repo.seed([linked, first])
    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      events: createCapturingEventBus(),
      clock: () => new Date('2025-01-01'),
      ...runtimeDeps,
      localCell: 'us',
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
      regionMove: { writeOperatorAudit: async () => {}, queues: [] },
    })

    await expect(
      publicApi.findGoogleNotificationAnchor(connection, first.organizationId),
    ).resolves.toBe(linked.id)
    await expect(
      publicApi.findGoogleNotificationAnchor(
        googleConnectionId('81000000-0000-4000-8000-000000000099'),
        first.organizationId,
      ),
    ).resolves.toBe(first.id)
  })

  it('uses the injected ID authority for an accepted region-move request', async () => {
    const repo = createInMemoryPropertyRepo()
    const prop = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000040',
      dataCellId: 'us',
      processingRegion: 'us',
    })
    repo.seed([prop])
    const expectedMoveId = '81000000-0000-4000-8000-000000000041'
    const idGen = vi.fn(() => expectedMoveId)
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => [{ id: prop.id }],
          }),
        }),
      }),
      insert: () => ({ values: async () => {} }),
      execute: async () => ({ rows: [] }),
    }
    const db = {
      transaction: async (run: (executor: typeof tx) => Promise<unknown>) => run(tx),
    }
    const context = buildPropertyContext({
      db: db as never,
      repo,
      events: createCapturingEventBus(),
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      idGen,
      localCell: 'us',
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
      logger: {
        info: () => {},
        warn: () => {},
      },
      regionMove: {
        writeOperatorAudit: async () => {},
        queues: [],
        approvedCells: new Set(['us', 'europe']),
      },
    })

    const result = await context.internal.useCases.requestRegionMove(
      {
        propertyId: prop.id,
        toRegion: 'europe',
        reason: 'approved rehearsal',
      },
      buildTestAuthContext({
        organizationId: prop.organizationId,
        role: 'AccountAdmin',
      }),
    )

    expect(result).toMatchObject({ ok: true, move: { id: expectedMoveId } })
    expect(idGen).toHaveBeenCalledTimes(1)
  })
})
