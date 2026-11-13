import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
// Property context — build.ts tests
// Tests the PublicApi behavior and build wiring.

import { describe, it, expect, vi } from 'vitest'
import { buildPropertyContext } from './build'
import { getDb } from '#/shared/db'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { createPropertyRepository } from './infrastructure/repositories/property.repository'
import { seedTestProperty } from './infrastructure/property-test-fixtures'
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
import { createPropertyGoogleBindingStore } from './profile/google-binding-store.server'

// Pass-through, so one test can hand the build a stub binding store.
vi.mock('./profile/google-binding-store.server', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('./profile/google-binding-store.server')>()
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
  refreshPrimaryCategory: true,
  readInternal: true,
  readByLocationIds: true,
  readSummary: true,
  readReceipt: true,
  ensureImportFollowUps: true,
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
  outboxRepo: { insertReceipt: async () => undefined },
  logger: {
    info: () => {},
    warn: () => {},
  },
} as const

const ORG_A = organizationId('org-property-build-a')
const ORG_B = organizationId('org-property-build-b')
const PROPERTY_ONE = '81000000-0000-4000-8000-000000000001'
const PROPERTY_TWO = '81000000-0000-4000-8000-000000000002'
const CONNECTION = googleConnectionId('81000000-0000-4000-8000-000000000001')
const READ_CONNECTION = googleConnectionId('82000000-0000-4000-8000-000000000020')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['properties', 'google_connections'],
})
const db = getDb()

/** A binding's account and location: the location is unique within an Organization. */
const located = (n: number) => ({
  gbpAccountId: 'account-1',
  gbpLocationId: `location-${n}`,
})

const build = (overrides: Parameters<typeof buildTestProperty>[0] = {}) =>
  buildTestProperty({ organizationId: ORG_A, ...overrides })

// A Property that references a Google connection needs that connection's row, and an
// active or disconnected binding needs its account and location with it.
const seed = async (...properties: ReadonlyArray<ReturnType<typeof build>>) => {
  for (const connection of [CONNECTION, READ_CONNECTION]) {
    await getPool().query(
      `INSERT INTO google_connections (
         id, organization_id, google_subject,
         encrypted_access_token, encrypted_refresh_token, token_expires_at,
         scopes, connected_by, created_at, updated_at
       ) VALUES ($1, $2, $3, 'encrypted', 'encrypted', NOW(),
                 ARRAY['https://www.googleapis.com/auth/business.manage'], 'user-1', NOW(), NOW())
       ON CONFLICT (id) DO NOTHING`,
      [connection, ORG_A, `build-subject-${connection}`],
    )
  }
  for (const property of properties) await seedTestProperty(db, property)
}

describe('PropertyPublicApi', () => {
  it('returns one standard publicApi/internal boundary for every cross-context seam', () => {
    const context = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
      repo: createPropertyRepository(db),
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
    })

    // ARC-03-T11: `responsibility` is the named member-authority capability.
    // Export and erasure run through the rights request executors, never from
    // this build, and never reach the request-facing surface.
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
      replyEffects: replyScopeEffects,
      db,
      repo: createPropertyRepository(db),
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

  // A Property's connection reference moves with its binding state, epoch and
  // fact, inside the binding store. publicApi once also carried a bare
  // "null the reference" write for a connection hard-delete nothing calls.
  it('publishes no raw Google-reference mutator on publicApi', () => {
    const repo = createPropertyRepository(db)
    const context = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
      repo,
      clock: () => new Date('2026-08-28T00:00:00.000Z'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
    })

    expect(context.publicApi).not.toHaveProperty('clearGoogleConnectionRef')
    expect(repo).not.toHaveProperty('clearGoogleConnectionRef')
    // The read Integration's connection lifecycle asks stays.
    expect(context.publicApi.findIdsByGoogleConnection).toBeTypeOf('function')
  })

  it('hands the retention consumer the Google-binding capability', async () => {
    const releaseRetentionFromEvent = vi.fn().mockResolvedValue('applied')
    vi.mocked(createPropertyGoogleBindingStore).mockReturnValueOnce({
      releaseRetentionFromEvent,
    } as unknown as PropertyGoogleBindingStore)
    const context = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
      repo: createPropertyRepository(db),
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
    const repo = createPropertyRepository(db)
    const prop = build({ id: PROPERTY_ONE })
    await seed(prop)

    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
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
    const repo = createPropertyRepository(db)
    const clock = () => new Date('2025-01-01')
    const staffPublicApi = createStubStaffApi()

    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
      repo,
      clock,
      ...runtimeDeps,
      staffPublicApi,
      identityManagerFacts,
    })

    const exists = await publicApi.propertyExists(
      organizationId('org-1'),
      propertyId('81000000-0000-4000-8000-000000000097'),
    )
    expect(exists).toBe(false)
  })

  it('getPropertyTimezones answers each Property’s zone in one read and leaves out an unknown one', async () => {
    const repo = createPropertyRepository(db)
    const sofia = build({
      id: '81000000-0000-4000-8000-000000000040',
      slug: 'zone-sofia',
      timezone: 'Europe/Sofia',
    })
    const newYork = build({
      id: '81000000-0000-4000-8000-000000000041',
      slug: 'zone-new-york',
      timezone: 'America/New_York',
    })
    await seed(sofia, newYork)
    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
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
    const repo = createPropertyRepository(db)
    const active = build({
      id: '81000000-0000-4000-8000-000000000030',
      slug: 'lifecycle-active',
      lifecycleState: 'active',
    })
    const archived = build({
      id: '81000000-0000-4000-8000-000000000031',
      slug: 'lifecycle-archived',
      lifecycleState: 'archived',
    })
    await seed(active, archived)
    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
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
    const repo = createPropertyRepository(db)
    const prop = build({ id: PROPERTY_ONE })
    await seed(prop)
    const managerId = userId('admin-1')
    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
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
        propertyId('81000000-0000-4000-8000-000000000098'),
        managerId,
      ),
    ).resolves.toBe(false)
  })

  it('treats a grant-only PropertyManager as an eligible direct recipient and fails closed without the grant', async () => {
    const repo = createPropertyRepository(db)
    const prop = build({ id: PROPERTY_ONE })
    const otherProp = build({ id: PROPERTY_TWO, slug: 'other-property' })
    await seed(prop, otherProp)
    const manager = userId('manager-1')
    const grantedPropertyIds = { current: [prop.id] as ReadonlyArray<typeof prop.id> }
    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
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
    const repo = createPropertyRepository(db)
    const archived = build({
      id: '82000000-0000-4000-8000-000000000010',
      slug: 'publication-scope-archived',
      lifecycleState: 'archived',
      sourceEpoch: 3,
    })
    await seed(archived)
    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
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

  // A read of one review from Google authorizes against the Property's
  // current binding, not what a Review row cached when it was last synced.
  it('reads the current Google connection, binding state and epoch of a Property', async () => {
    const repo = createPropertyRepository(db)
    const connection = googleConnectionId('82000000-0000-4000-8000-000000000020')
    const linked = build({
      id: '82000000-0000-4000-8000-000000000021',
      slug: 'read-scope-linked',
      ...located(1),
      googleConnectionId: connection,
      googleBindingState: 'active',
      sourceEpoch: 7,
    })
    await seed(linked)
    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
      repo,
      clock: () => new Date('2025-01-01'),
      ...runtimeDeps,
      staffPublicApi: createStubStaffApi(),
      identityManagerFacts,
    })

    await expect(
      publicApi.getGoogleReadScope(linked.organizationId, linked.id),
    ).resolves.toEqual({
      lifecycleState: 'active',
      googleBindingState: 'active',
      googleConnectionId: connection,
      sourceEpoch: 7,
    })
    await expect(
      publicApi.getGoogleReadScope(
        linked.organizationId,
        propertyId('82000000-0000-4000-8000-000000000099'),
      ),
    ).resolves.toBeNull()
  })

  it('chooses a stable Google notice scope, preferring a linked Property', async () => {
    const repo = createPropertyRepository(db)
    const connection = googleConnectionId('81000000-0000-4000-8000-000000000001')
    const first = build({
      id: '81000000-0000-4000-8000-000000000010',
      slug: 'notice-first',
    })
    const linked = build({
      id: '81000000-0000-4000-8000-000000000020',
      slug: 'notice-linked',
      googleConnectionId: connection,
    })
    await seed(linked, first)
    const { publicApi } = buildPropertyContext({
      replyEffects: replyScopeEffects,
      db,
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
    const archivedLinked = build({
      id: '81000000-0000-4000-8000-000000000010',
      slug: 'notice-archived',
      ...located(2),
      googleConnectionId: connection,
      googleBindingState: 'active',
      lifecycleState: 'archived',
    })
    const unboundLinked = build({
      id: '81000000-0000-4000-8000-000000000020',
      slug: 'notice-unbound',
      ...located(3),
      googleConnectionId: connection,
      googleBindingState: 'disconnected',
    })
    const boundLinked = build({
      id: '81000000-0000-4000-8000-000000000030',
      slug: 'notice-bound',
      ...located(4),
      googleConnectionId: connection,
      googleBindingState: 'active',
    })
    const unlinked = build({
      id: '81000000-0000-4000-8000-000000000040',
      slug: 'notice-unlinked',
    })
    const orgId = archivedLinked.organizationId
    const anchorFor = async (properties: ReadonlyArray<typeof archivedLinked>) => {
      await getPool().query('DELETE FROM properties WHERE organization_id = $1', [ORG_A])
      const scoped = createPropertyRepository(db)
      await seed(...properties)
      return buildPropertyContext({
        replyEffects: replyScopeEffects,
        db,
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
