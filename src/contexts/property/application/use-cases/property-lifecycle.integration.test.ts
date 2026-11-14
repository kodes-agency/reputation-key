// Property context — archive, restore and Google disconnect use cases against
// real PostgreSQL: the repository's reads, the lifecycle and binding stores and
// the outbox decide the outcome.

import { describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { replyScopeEffects } from '#/contexts/reputation/application/public-api'
import { getDb } from '#/shared/db'
import { outboxEvents } from '#/shared/db/schema/outbox.schema'
import { properties } from '#/shared/db/schema/property.schema'
import { googleConnectionId, organizationId } from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { clearEventSchemas } from '#/shared/events/schema-registry'
import { setupIntegrationDb } from '#/shared/testing/integration-helpers'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { createPropertyLifecycleCommandStore } from '../../lifecycle/transition-store.server'
import { createPropertyGoogleBindingStore } from '../../profile/google-binding-store.server'
import { createPropertyRepository } from '../../infrastructure/repositories/property.repository'
import { seedTestProperty } from '../../infrastructure/property-test-fixtures'
import {
  archiveProperty,
  disconnectPropertyGoogleBinding,
  restoreProperty,
} from './property-lifecycle'
import { seedGoogleConnection } from '#/shared/testing/google-connection-seed'

const NOW = new Date('2026-08-28T12:00:00.000Z')
const ORG_A = organizationId('org-property-lifecycle-a')
const ORG_B = organizationId('org-property-lifecycle-b')

const { getPool } = setupIntegrationDb({
  orgA: ORG_A,
  orgB: ORG_B,
  tables: ['properties', 'outbox_events', 'google_connections'],
})

const db = getDb()
const propertyRepo = createPropertyRepository(db)
const staffPublicApi = { getAccessiblePropertyIds: async () => null }

const CONNECTION = googleConnectionId('80000000-0000-4000-8000-000000000001')

const seedConnection = () =>
  seedGoogleConnection(getPool(), {
    id: CONNECTION,
    organizationId: ORG_A,
    googleSubject: 'lifecycle-subject',
    accessToken: 'encrypted',
    refreshToken: 'encrypted',
    tokenExpiresAt: new Date(),
    connectedBy: 'user-1',
    onExistingId: 'keep',
  })

/** A Google binding the database accepts: connection, account and location together. */
const BOUND = {
  googleConnectionId: CONNECTION,
  gbpAccountId: 'account-1',
  gbpLocationId: 'location-1',
} as const

let sequence = 0
const build = (overrides: Parameters<typeof buildTestProperty>[0] = {}) => {
  sequence += 1
  return buildTestProperty({
    id: crypto.randomUUID(),
    slug: `lifecycle-slug-${sequence}`,
    organizationId: ORG_A,
    ...overrides,
  })
}

const admin = (...permissions: string[]) =>
  buildTestAuthContext({
    role: 'AccountAdmin',
    organizationId: ORG_A,
    effectivePermissions: new Set(permissions as never[]),
    scopeByPermission: new Map(permissions.map((p) => [p as never, 'organization'])),
  })

const stored = async (propertyId: string) => {
  const found = await propertyRepo.findById(ORG_A, propertyId as never)
  if (!found) throw new Error('expected a stored Property')
  return found
}

const recordedEventTypes = async () =>
  (
    await db
      .select({ type: outboxEvents.eventType })
      .from(outboxEvents)
      .where(eq(outboxEvents.organizationId, ORG_A))
  ).map((row) => row.type)

/** Events other tests in the shard leave behind must never reach an assertion. */
const seedUnrelatedOutboxEvent = () =>
  db.insert(outboxEvents).values({
    eventType: 'property.archived',
    payload: {},
    organizationId: ORG_B,
    sourceContext: 'property',
    sourceAggregateId: crypto.randomUUID(),
  })

const setup = async () => {
  await seedConnection()
  await seedUnrelatedOutboxEvent()
  clearEventSchemas()
  registerAllEventSchemas()
  return {
    lifecycleStore: createPropertyLifecycleCommandStore(db, replyScopeEffects),
    bindingStore: createPropertyGoogleBindingStore(db, replyScopeEffects),
  }
}

describe('archiveProperty', () => {
  it('archives in place with a bounded recovery window and a new authority epoch', async () => {
    const { lifecycleStore } = await setup()
    const property = build({ sourceEpoch: 7, responsibilityNeededSince: null })
    await seedTestProperty(db, property)
    const useCase = archiveProperty({
      propertyRepo,
      lifecycleStore,
      staffPublicApi,
      clock: () => NOW,
    })
    const ctx = admin('property.archive')

    const result = await useCase(
      { propertyId: property.id, reason: 'Property no longer trading' },
      ctx,
    )

    expect(result).toMatchObject({
      id: property.id,
      lifecycleState: 'archived',
      lifecycleReason: 'Property no longer trading',
      lifecycleStateChangedAt: NOW,
      purgeScheduledFor: new Date('2026-09-27T12:00:00.000Z'),
      lifecycleInitiatedBy: ctx.userId,
      sourceEpoch: 8,
    })
    await expect(stored(property.id)).resolves.toMatchObject({
      lifecycleState: 'archived',
      purgeScheduledFor: new Date('2026-09-27T12:00:00.000Z'),
      sourceEpoch: 8,
    })
    expect(await recordedEventTypes()).toEqual(['property.archived'])
  })

  it('is idempotent for an already archived Property without extending recovery', async () => {
    const { lifecycleStore } = await setup()
    const property = build({
      lifecycleState: 'archived',
      lifecycleReason: 'Property no longer trading',
      lifecycleStateChangedAt: new Date('2026-08-20T12:00:00.000Z'),
      purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
      sourceEpoch: 8,
    })
    await seedTestProperty(db, property)
    const useCase = archiveProperty({
      propertyRepo,
      lifecycleStore,
      staffPublicApi,
      clock: () => NOW,
    })

    const result = await useCase(
      { propertyId: property.id, reason: 'A different reason' },
      admin('property.archive'),
    )

    expect(result).toMatchObject({
      lifecycleReason: 'Property no longer trading',
      purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
      sourceEpoch: 8,
    })
    await expect(stored(property.id)).resolves.toMatchObject({
      lifecycleReason: 'Property no longer trading',
      purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
      sourceEpoch: 8,
    })
    expect(await recordedEventTypes()).toEqual([])
  })

  it('refuses lifecycle mutation before the command store when permission is absent', async () => {
    const { lifecycleStore } = await setup()
    const property = build({ lifecycleState: 'active' })
    await seedTestProperty(db, property)
    const useCase = archiveProperty({
      propertyRepo,
      lifecycleStore,
      staffPublicApi,
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'PropertyManager',
      organizationId: ORG_A,
      effectivePermissions: new Set(),
      scopeByPermission: new Map(),
    })

    await expect(
      useCase({ propertyId: property.id, reason: 'Temporarily closed' }, ctx),
    ).rejects.toMatchObject({ _tag: 'PropertyError', code: 'forbidden' })
    await expect(stored(property.id)).resolves.toMatchObject({
      lifecycleState: 'active',
      sourceEpoch: property.sourceEpoch,
    })
    expect(await recordedEventTypes()).toEqual([])
  })
})

describe('restoreProperty', () => {
  const archived = (overrides: Parameters<typeof buildTestProperty>[0] = {}) =>
    build({
      lifecycleState: 'archived',
      lifecycleReason: 'Property no longer trading',
      lifecycleStateChangedAt: new Date('2026-08-20T12:00:00.000Z'),
      purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
      lifecycleInitiatedBy: 'admin-previous',
      sourceEpoch: 8,
      ...overrides,
    })

  it('restores stable identity inside the recovery window and exposes reconnect readiness', async () => {
    const { lifecycleStore } = await setup()
    const property = archived({
      ...BOUND,
      googleBindingState: 'disconnected',
      responsibleManagerRevision: 6,
      responsibilityNeededSince: null,
    })
    await seedTestProperty(db, property)
    const useCase = restoreProperty({
      propertyRepo,
      lifecycleStore,
      staffPublicApi,
      readiness: { hasEligibleResponsibleManager: async () => true },
      clock: () => NOW,
    })
    const ctx = admin('property.restore')

    const result = await useCase({ propertyId: property.id }, ctx)

    expect(result).toMatchObject({
      googleBindingReadiness: 'reconnect_required',
      property: {
        id: property.id,
        lifecycleState: 'active',
        lifecycleReason: null,
        lifecycleStateChangedAt: NOW,
        purgeScheduledFor: null,
        lifecycleInitiatedBy: ctx.userId,
        sourceEpoch: 9,
      },
    })
    await expect(stored(property.id)).resolves.toMatchObject({
      lifecycleState: 'active',
      purgeScheduledFor: null,
      sourceEpoch: 9,
      responsibleManagerRevision: 6,
    })
    expect(await recordedEventTypes()).toEqual(['property.restored'])
  })

  it('refuses a restore when the managers changed after the readiness check', async () => {
    const { lifecycleStore } = await setup()
    const property = archived({ responsibleManagerRevision: 6 })
    await seedTestProperty(db, property)
    const useCase = restoreProperty({
      propertyRepo,
      lifecycleStore,
      staffPublicApi,
      // A release of the managers commits between the check and the Restore.
      readiness: {
        hasEligibleResponsibleManager: async () => {
          await db
            .update(properties)
            .set({ responsibleManagerRevision: 7 })
            .where(eq(properties.id, property.id))
          return true
        },
      },
      clock: () => NOW,
    })

    await expect(
      useCase({ propertyId: property.id }, admin('property.restore')),
    ).rejects.toMatchObject({ _tag: 'PropertyError', code: 'stale_property' })
    await expect(stored(property.id)).resolves.toMatchObject({
      lifecycleState: 'archived',
      sourceEpoch: 8,
    })
    expect(await recordedEventTypes()).toEqual([])
  })

  it('refuses restore at the recovery deadline without mutating state', async () => {
    const { lifecycleStore } = await setup()
    const property = archived({ purgeScheduledFor: NOW })
    await seedTestProperty(db, property)
    let readinessChecked = false
    const useCase = restoreProperty({
      propertyRepo,
      lifecycleStore,
      staffPublicApi,
      readiness: {
        hasEligibleResponsibleManager: async () => {
          readinessChecked = true
          return true
        },
      },
      clock: () => NOW,
    })

    await expect(
      useCase({ propertyId: property.id }, admin('property.restore')),
    ).rejects.toMatchObject({ _tag: 'PropertyError', code: 'property_recovery_expired' })
    expect(readinessChecked).toBe(false)
    await expect(stored(property.id)).resolves.toMatchObject({
      lifecycleState: 'archived',
      sourceEpoch: 8,
    })
    expect(await recordedEventTypes()).toEqual([])
  })

  it('refuses restore when no Responsible Manager remains eligible', async () => {
    const { lifecycleStore } = await setup()
    const property = archived()
    await seedTestProperty(db, property)
    const useCase = restoreProperty({
      propertyRepo,
      lifecycleStore,
      staffPublicApi,
      readiness: { hasEligibleResponsibleManager: async () => false },
      clock: () => NOW,
    })

    await expect(
      useCase({ propertyId: property.id }, admin('property.restore')),
    ).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'property_restore_not_ready',
      context: expect.objectContaining({ reason: 'responsible_manager_required' }),
    })
    await expect(stored(property.id)).resolves.toMatchObject({
      lifecycleState: 'archived',
      sourceEpoch: 8,
    })
    expect(await recordedEventTypes()).toEqual([])
  })
})

describe('disconnectPropertyGoogleBinding', () => {
  it('routes an already-disconnected Property through idempotent cleanup', async () => {
    const { bindingStore } = await setup()
    const property = build({
      lifecycleState: 'archived',
      ...BOUND,
      googleBindingState: 'disconnected',
      sourceEpoch: 9,
    })
    await seedTestProperty(db, property)
    const command = disconnectPropertyGoogleBinding({
      propertyRepo,
      staffPublicApi,
      bindingStore,
      clock: () => NOW,
    })

    await expect(
      command({ propertyId: property.id }, admin('property.disconnect')),
    ).resolves.toMatchObject({
      state: 'disconnected',
      sourceEpoch: 9,
      profileVersion: property.profileVersion,
    })
    await expect(stored(property.id)).resolves.toMatchObject({ sourceEpoch: 9 })
    expect(await recordedEventTypes()).toEqual([])
  })

  it('disconnects only the archived Property binding and preserves the Organization connection', async () => {
    const { bindingStore } = await setup()
    const property = build({
      lifecycleState: 'archived',
      purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
      ...BOUND,
      googleBindingState: 'active',
      sourceEpoch: 8,
    })
    await seedTestProperty(db, property)
    const useCase = disconnectPropertyGoogleBinding({
      propertyRepo,
      staffPublicApi,
      bindingStore,
      clock: () => NOW,
    })

    await expect(
      useCase({ propertyId: property.id }, admin('property.disconnect')),
    ).resolves.toMatchObject({ state: 'disconnected', sourceEpoch: 9 })

    await expect(stored(property.id)).resolves.toMatchObject({
      googleBindingState: 'disconnected',
      googleConnectionId: CONNECTION,
      sourceEpoch: 9,
    })
    expect(await recordedEventTypes()).toEqual(['property.google_binding.changed'])
  })

  it('refuses to disconnect an active Property', async () => {
    const { bindingStore } = await setup()
    const property = build({
      lifecycleState: 'active',
      ...BOUND,
      googleBindingState: 'active',
      sourceEpoch: 8,
    })
    await seedTestProperty(db, property)
    const useCase = disconnectPropertyGoogleBinding({
      propertyRepo,
      staffPublicApi,
      bindingStore,
      clock: () => NOW,
    })

    await expect(
      useCase({ propertyId: property.id }, admin('property.disconnect')),
    ).rejects.toMatchObject({ _tag: 'PropertyError', code: 'invalid_transition' })
    await expect(stored(property.id)).resolves.toMatchObject({
      googleBindingState: 'active',
      sourceEpoch: 8,
    })
    expect(await recordedEventTypes()).toEqual([])
  })
})
