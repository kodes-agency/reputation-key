// Property context — build.ts tests
// Tests the PublicApi behavior and build wiring.

import { describe, it, expect, vi } from 'vitest'
import { buildPropertyContext } from './build'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import {
  googleConnectionId,
  organizationId,
  propertyId,
  userId,
} from '#/shared/domain/ids'
import { buildTestProperty } from '#/shared/testing/fixtures'
import type { StaffPublicApi } from '#/contexts/identity/application/public-api'
import { createConsumerRegistry } from '#/shared/outbox/consumer-registry'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import type { PropertyGoogleBindingStore } from './application/ports/property-google-binding.port'
import { createPropertyGoogleBindingStore } from './infrastructure/property-google-binding-store'

// Pass-through, so one test can hand the build a stub binding store.
vi.mock('./infrastructure/property-google-binding-store', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('./infrastructure/property-google-binding-store')
    >()
  return {
    ...actual,
    createPropertyGoogleBindingStore: vi.fn(actual.createPropertyGoogleBindingStore),
  }
})

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

// Keyed by the store type, so a new binding method must be listed here.
const GOOGLE_BINDING_MEMBERS = Object.keys({
  readInternal: true,
  readByLocationIds: true,
  readSummary: true,
  readReceipt: true,
  createBoundProperty: true,
  relink: true,
  disconnect: true,
  scrubProviderIdentity: true,
  releaseRetention: true,
  releaseRetentionFromEvent: true,
  sweepReleasedExpired: true,
  countUnreleasedExpired: true,
  cleanupOrganization: true,
} satisfies Record<keyof PropertyGoogleBindingStore, true>) as Array<
  keyof PropertyGoogleBindingStore
>
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
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
    })

    // ARC-03-T11: `responsibility` is the named member-authority capability.
    // LIF-01: the Organization export and lifecycle contributors are built by
    // composition/organization-export-contributors.ts, never by this build, and
    // never reach the request-facing surface: the lifecycle contributor owns an
    // irreversible purge phase that must stay unreachable by default.
    expect(Object.keys(context).sort()).toEqual([
      'googleBinding',
      'internal',
      'publicApi',
      'responsibility',
      'worker',
    ])
    expect(Object.keys(context.publicApi)).not.toContain('organizationExportContributor')
    expect(Object.keys(context.publicApi)).not.toContain(
      'organizationLifecycleContributor',
    )
    expect(Object.keys(context.internal).sort()).toEqual(['repos', 'useCases'])
    expect(context.worker.registerOutboxConsumers).toBeTypeOf('function')
    expect(context.publicApi.management).toBeDefined()
  })

  it('keeps the Google-binding store its own capability, off publicApi', () => {
    const context = buildPropertyContext({
      db: {} as never,
      repo: createInMemoryPropertyRepo(),
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
    })

    // publicApi reaches every consuming context and every server function;
    // create/relink/disconnect must reach only Integration.
    expect(Object.keys(context.googleBinding).sort()).toEqual(
      [...GOOGLE_BINDING_MEMBERS].sort(),
    )
    for (const member of GOOGLE_BINDING_MEMBERS) {
      expect(context.googleBinding[member]).toBeTypeOf('function')
      expect(context.publicApi).not.toHaveProperty(member)
    }
    expect(Object.isFrozen(context.googleBinding)).toBe(true)
  })

  it('hands the retention consumer the Google-binding capability', async () => {
    const releaseRetentionFromEvent = vi.fn().mockResolvedValue('applied')
    vi.mocked(createPropertyGoogleBindingStore).mockReturnValueOnce({
      releaseRetentionFromEvent,
    } as unknown as PropertyGoogleBindingStore)
    const context = buildPropertyContext({
      db: {} as never,
      repo: createInMemoryPropertyRepo(),
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
    })
    const registry = createConsumerRegistry()
    context.worker.registerOutboxConsumers(registry)
    const [consumer] = registry.listFor('integration.property_import.retention_released')
    const org = '00000000-0000-4000-8000-000000000001'

    clearEventSchemas()
    registerAllEventSchemas()
    try {
      await expect(
        consumer!.handler({
          eventId: '30000000-0000-4000-8000-000000000001',
          eventType: 'integration.property_import.retention_released',
          eventVersion: 1,
          payload: {
            organizationId: org,
            idempotencyKeys: ['40000000-0000-4000-8000-000000000001'],
          },
          organizationId: org,
          propertyId: null,
          sourceContext: 'integration',
          sourceAggregateId: 'import-parent-1',
          recordedAt: '2026-08-10T12:00:00.000Z',
        }),
      ).resolves.toEqual({ status: 'applied' })
    } finally {
      clearEventSchemas()
    }
    expect(releaseRetentionFromEvent).toHaveBeenCalledOnce()
  })

  it('propertyExists returns true when repo has the property', async () => {
    const repo = createInMemoryPropertyRepo()
    const prop = buildTestProperty({ id: 'prop-1' })
    repo.seed([prop])

    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      clock,
      ...runtimeDeps,
      staffPublicApi,
      identityManagerFacts,
    })

    const exists = await publicApi.propertyExists(prop.organizationId, prop.id)
    expect(exists).toBe(true)
    await expect(publicApi.getSourceEpoch(prop.organizationId, prop.id)).resolves.toEqual(
      {
        sourceEpoch: prop.sourceEpoch,
      },
    )
  })

  it('propertyExists returns false when repo does not have the property', async () => {
    const repo = createInMemoryPropertyRepo()
    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      clock,
      ...runtimeDeps,
      staffPublicApi,
      identityManagerFacts,
    })

    const exists = await publicApi.propertyExists(
      organizationId('org-1'),
      propertyId('nonexistent'),
    )
    expect(exists).toBe(false)
  })

  it('getPropertyTimezones answers each Property’s zone in one read and leaves out an unknown one', async () => {
    const repo = createInMemoryPropertyRepo()
    const sofia = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000040',
      slug: 'zone-sofia',
      timezone: 'Europe/Sofia',
    })
    const newYork = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000041',
      slug: 'zone-new-york',
      timezone: 'America/New_York',
    })
    repo.seed([sofia, newYork])
    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
    })

    const zones = await publicApi.getPropertyTimezones(sofia.organizationId, [
      sofia.id,
      newYork.id,
      propertyId('81000000-0000-4000-8000-000000000099'),
    ])

    expect(zones).toEqual([
      { id: sofia.id, timezone: 'Europe/Sofia' },
      { id: newYork.id, timezone: 'America/New_York' },
    ])
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
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
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
      clock: () => new Date('2025-01-01'),
      ...runtimeDeps,
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

  it('treats a grant-only PropertyManager as an eligible direct recipient and fails closed without the grant', async () => {
    const repo = createInMemoryPropertyRepo()
    const prop = buildTestProperty({ id: 'prop-1' })
    const otherProp = buildTestProperty({ id: 'prop-2', slug: 'other-property' })
    repo.seed([prop, otherProp])
    const manager = userId('manager-1')
    const grantedPropertyIds = { current: [prop.id] as ReadonlyArray<typeof prop.id> }
    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      clock: () => new Date('2025-01-01'),
      ...runtimeDeps,
      // No Staff participation exists anywhere in these deps: the grant alone decides.
      staffPublicApi: {
        ...createStubStaffApi(),
        getAccessiblePropertyIds: async () => grantedPropertyIds.current,
      },
      identityManagerFacts: {
        listActiveManagers: async () => [
          {
            userId: manager,
            role: 'PropertyManager' as const,
            propertyAccessScope: 'assigned-properties' as const,
          },
        ],
      },
    })

    await expect(
      publicApi.isEligibleResponsibleManagerUserId(prop.organizationId, prop.id, manager),
    ).resolves.toBe(true)
    await expect(
      publicApi.isEligibleResponsibleManagerUserId(
        otherProp.organizationId,
        otherProp.id,
        manager,
      ),
    ).resolves.toBe(false)

    grantedPropertyIds.current = []
    await expect(
      publicApi.isEligibleResponsibleManagerUserId(prop.organizationId, prop.id, manager),
    ).resolves.toBe(false)
  })

  // Reply publication refuses in words that match the Property's state, and
  // compares the epoch read from the same snapshot.
  it('reads a Property lifecycle and source epoch together for reply publication', async () => {
    const repo = createInMemoryPropertyRepo()
    const archived = buildTestProperty({
      id: '82000000-0000-4000-8000-000000000010',
      slug: 'publication-scope-archived',
      lifecycleState: 'archived',
      sourceEpoch: 3,
    })
    repo.seed([archived])
    const { publicApi } = buildPropertyContext({
      db: {} as never,
      repo,
      clock: () => new Date('2025-01-01'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
    })

    await expect(
      publicApi.getPublicationScope(archived.organizationId, archived.id),
    ).resolves.toEqual({ lifecycleState: 'archived', sourceEpoch: 3 })
    await expect(
      publicApi.getPublicationScope(
        archived.organizationId,
        propertyId('82000000-0000-4000-8000-000000000099'),
      ),
    ).resolves.toBeNull()
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
      clock: () => new Date('2025-01-01'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
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

  it('anchors the Google notice to an active Property, never an archived one', async () => {
    const connection = googleConnectionId('81000000-0000-4000-8000-000000000001')
    const archivedLinked = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000010',
      slug: 'notice-archived',
      googleConnectionId: connection,
      googleBindingState: 'active',
      lifecycleState: 'archived',
    })
    const unboundLinked = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000020',
      slug: 'notice-unbound',
      googleConnectionId: connection,
      googleBindingState: 'disconnected',
    })
    const boundLinked = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000030',
      slug: 'notice-bound',
      googleConnectionId: connection,
      googleBindingState: 'active',
    })
    const unlinked = buildTestProperty({
      id: '81000000-0000-4000-8000-000000000040',
      slug: 'notice-unlinked',
    })
    const orgId = archivedLinked.organizationId
    const anchorFor = (properties: ReadonlyArray<typeof archivedLinked>) => {
      const scoped = createInMemoryPropertyRepo()
      scoped.seed(properties)
      return buildPropertyContext({
        db: {} as never,
        repo: scoped,
        clock: () => new Date('2025-01-01'),
        ...runtimeDeps,
        staffPublicApi: createStubStaffApi(),
        identityManagerFacts,
      }).publicApi.findGoogleNotificationAnchor(connection, orgId)
    }

    await expect(
      anchorFor([archivedLinked, unboundLinked, boundLinked, unlinked]),
    ).resolves.toBe(boundLinked.id)
    await expect(anchorFor([archivedLinked, unboundLinked, unlinked])).resolves.toBe(
      unboundLinked.id,
    )
    await expect(anchorFor([archivedLinked, unlinked])).resolves.toBe(unlinked.id)
    await expect(anchorFor([archivedLinked])).resolves.toBeNull()
  })
})
