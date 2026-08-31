import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildTestAuthContext, buildTestProperty } from '#/shared/testing/fixtures'
import { createInMemoryPropertyRepo } from '#/shared/testing/in-memory-property-repo'
import {
  archiveProperty,
  disconnectPropertyGoogleBinding,
  restoreProperty,
} from './property-lifecycle'

const NOW = new Date('2026-08-28T12:00:00.000Z')

describe('archiveProperty', () => {
  beforeEach(() => vi.clearAllMocks())

  it('archives in place with a bounded recovery window and a new authority epoch', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const property = buildTestProperty({
      dataCellId: 'us',
      processingRegion: 'us',
      sourceEpoch: 7,
      responsibilityNeededSince: null,
    })
    propertyRepo.seed([property])
    const transitionLifecycle = vi.fn(async (command) => ({
      ...property,
      lifecycleState: command.to,
      lifecycleReason: command.reason,
      lifecycleStateChangedAt: command.occurredAt,
      purgeScheduledFor: command.recoveryDeadline,
      lifecycleInitiatedBy: command.initiatedBy,
      sourceEpoch: command.nextSourceEpoch,
      updatedAt: command.occurredAt,
    }))
    const useCase = archiveProperty({
      propertyRepo,
      lifecycleStore: { transitionLifecycle },
      staffPublicApi: {
        getAccessiblePropertyIds: async () => null,
      },
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      effectivePermissions: new Set(['property.archive' as never]),
      scopeByPermission: new Map([['property.archive' as never, 'organization']]),
    })

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
    expect(transitionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: property.organizationId,
        propertyId: property.id,
        from: 'active',
        to: 'archived',
        expectedSourceEpoch: 7,
        nextSourceEpoch: 8,
        expectedProfileVersion: property.profileVersion,
        recoveryDeadline: new Date('2026-09-27T12:00:00.000Z'),
        reason: 'Property no longer trading',
        initiatedBy: ctx.userId,
        occurredAt: NOW,
        event: expect.objectContaining({
          _tag: 'property.archived',
          propertyId: property.id,
          organizationId: property.organizationId,
          userId: ctx.userId,
          sourceEpoch: 8,
        }),
      }),
    )
  })

  it('is idempotent for an already archived Property without extending recovery', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const property = buildTestProperty({
      lifecycleState: 'archived',
      lifecycleReason: 'Property no longer trading',
      lifecycleStateChangedAt: new Date('2026-08-20T12:00:00.000Z'),
      purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
      sourceEpoch: 8,
    })
    propertyRepo.seed([property])
    const transitionLifecycle = vi.fn()
    const useCase = archiveProperty({
      propertyRepo,
      lifecycleStore: { transitionLifecycle },
      staffPublicApi: { getAccessiblePropertyIds: async () => null },
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      effectivePermissions: new Set(['property.archive']),
      scopeByPermission: new Map([['property.archive', 'organization']]),
    })

    await expect(
      useCase({ propertyId: property.id, reason: 'A different reason' }, ctx),
    ).resolves.toBe(property)
    expect(transitionLifecycle).not.toHaveBeenCalled()
  })

  it('refuses lifecycle mutation before the command store when permission is absent', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const property = buildTestProperty({ lifecycleState: 'active' })
    propertyRepo.seed([property])
    const transitionLifecycle = vi.fn()
    const useCase = archiveProperty({
      propertyRepo,
      lifecycleStore: { transitionLifecycle },
      staffPublicApi: { getAccessiblePropertyIds: async () => null },
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'PropertyManager',
      effectivePermissions: new Set(),
      scopeByPermission: new Map(),
    })

    await expect(
      useCase({ propertyId: property.id, reason: 'Temporarily closed' }, ctx),
    ).rejects.toMatchObject({ _tag: 'PropertyError', code: 'forbidden' })
    expect(transitionLifecycle).not.toHaveBeenCalled()
  })
})

describe('restoreProperty', () => {
  it('restores stable identity inside the recovery window and exposes reconnect readiness', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const property = buildTestProperty({
      lifecycleState: 'archived',
      lifecycleReason: 'Property no longer trading',
      lifecycleStateChangedAt: new Date('2026-08-20T12:00:00.000Z'),
      purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
      lifecycleInitiatedBy: 'admin-previous',
      googleBindingState: 'disconnected',
      dataCellId: 'us',
      processingRegion: 'us',
      sourceEpoch: 8,
      responsibilityNeededSince: null,
    })
    propertyRepo.seed([property])
    const transitionLifecycle = vi.fn(async (command) => ({
      ...property,
      lifecycleState: command.to,
      lifecycleReason: command.reason,
      lifecycleStateChangedAt: command.occurredAt,
      purgeScheduledFor: command.recoveryDeadline,
      lifecycleInitiatedBy: command.initiatedBy,
      sourceEpoch: command.nextSourceEpoch,
      updatedAt: command.occurredAt,
    }))
    const useCase = restoreProperty({
      propertyRepo,
      lifecycleStore: { transitionLifecycle },
      staffPublicApi: {
        getAccessiblePropertyIds: async () => null,
      },
      readiness: { hasEligibleResponsibleManager: async () => true },
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      effectivePermissions: new Set(['property.restore']),
      scopeByPermission: new Map([['property.restore', 'organization']]),
    })

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
    expect(transitionLifecycle).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'archived',
        to: 'active',
        expectedSourceEpoch: 8,
        nextSourceEpoch: 9,
        reason: null,
        recoveryDeadline: null,
        event: expect.objectContaining({
          _tag: 'property.restored',
          googleBindingReadiness: 'reconnect_required',
          sourceEpoch: 9,
        }),
      }),
    )
  })

  it('refuses restore at the recovery deadline without mutating state', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const property = buildTestProperty({
      lifecycleState: 'archived',
      purgeScheduledFor: NOW,
      sourceEpoch: 8,
      dataCellId: 'us',
      processingRegion: 'us',
    })
    propertyRepo.seed([property])
    const transitionLifecycle = vi.fn()
    const hasEligibleResponsibleManager = vi.fn(async () => true)
    const useCase = restoreProperty({
      propertyRepo,
      lifecycleStore: { transitionLifecycle },
      staffPublicApi: { getAccessiblePropertyIds: async () => null },
      readiness: { hasEligibleResponsibleManager },
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      effectivePermissions: new Set(['property.restore']),
      scopeByPermission: new Map([['property.restore', 'organization']]),
    })

    await expect(useCase({ propertyId: property.id }, ctx)).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'property_recovery_expired',
    })
    expect(hasEligibleResponsibleManager).not.toHaveBeenCalled()
    expect(transitionLifecycle).not.toHaveBeenCalled()
  })

  it.each([
    {
      name: 'Data Cell is not accepting work',
      propertyOverrides: { dataCellId: 'europe' as const, processingRegion: 'europe' },
      managerReady: true,
      reason: 'data_cell_unavailable',
    },
    {
      name: 'no Responsible Manager remains eligible',
      propertyOverrides: { dataCellId: 'us' as const, processingRegion: 'us' },
      managerReady: false,
      reason: 'responsible_manager_required',
    },
  ])(
    'refuses restore when $name',
    async ({ propertyOverrides, managerReady, reason }) => {
      const propertyRepo = createInMemoryPropertyRepo()
      const property = buildTestProperty({
        lifecycleState: 'archived',
        purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
        sourceEpoch: 8,
        ...propertyOverrides,
      })
      propertyRepo.seed([property])
      const transitionLifecycle = vi.fn()
      const useCase = restoreProperty({
        propertyRepo,
        lifecycleStore: { transitionLifecycle },
        staffPublicApi: { getAccessiblePropertyIds: async () => null },
        readiness: { hasEligibleResponsibleManager: async () => managerReady },
        clock: () => NOW,
      })
      const ctx = buildTestAuthContext({
        role: 'AccountAdmin',
        effectivePermissions: new Set(['property.restore']),
        scopeByPermission: new Map([['property.restore', 'organization']]),
      })

      await expect(useCase({ propertyId: property.id }, ctx)).rejects.toMatchObject({
        _tag: 'PropertyError',
        code: 'property_restore_not_ready',
        context: expect.objectContaining({ reason }),
      })
      expect(transitionLifecycle).not.toHaveBeenCalled()
    },
  )
})

describe('disconnectPropertyGoogleBinding', () => {
  it('disconnects only the archived Property binding and preserves the Organization connection', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const property = buildTestProperty({
      lifecycleState: 'archived',
      purgeScheduledFor: new Date('2026-09-19T12:00:00.000Z'),
      googleBindingState: 'active',
      googleConnectionId: '80000000-0000-4000-8000-000000000001' as never,
      gbpAccountId: 'account-1',
      gbpLocationId: 'location-1',
      sourceEpoch: 8,
      dataCellId: 'us',
      processingRegion: 'us',
    })
    propertyRepo.seed([property])
    const disconnect = vi.fn(async () => ({
      state: 'disconnected' as const,
      sourceEpoch: 9,
      profileVersion: property.profileVersion,
      profileSource: property.profileSource,
      profileConfirmedAt: property.profileConfirmedAt,
    }))
    const useCase = disconnectPropertyGoogleBinding({
      propertyRepo,
      staffPublicApi: { getAccessiblePropertyIds: async () => null },
      bindingStore: {
        disconnect,
        readSummary: vi.fn(),
      },
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      effectivePermissions: new Set(['property.disconnect']),
      scopeByPermission: new Map([['property.disconnect', 'organization']]),
    })

    await expect(useCase({ propertyId: property.id }, ctx)).resolves.toMatchObject({
      state: 'disconnected',
      sourceEpoch: 9,
    })
    expect(disconnect).toHaveBeenCalledWith({
      organizationId: property.organizationId,
      propertyId: property.id,
      expectedSourceEpoch: 8,
      expectedProfileVersion: property.profileVersion,
      now: NOW,
    })
    expect(propertyRepo.all()[0]).toMatchObject({
      id: property.id,
      googleConnectionId: property.googleConnectionId,
    })
  })

  it('refuses to disconnect an active Property', async () => {
    const propertyRepo = createInMemoryPropertyRepo()
    const property = buildTestProperty({
      lifecycleState: 'active',
      googleBindingState: 'active',
      sourceEpoch: 8,
    })
    propertyRepo.seed([property])
    const disconnect = vi.fn()
    const useCase = disconnectPropertyGoogleBinding({
      propertyRepo,
      staffPublicApi: { getAccessiblePropertyIds: async () => null },
      bindingStore: { disconnect, readSummary: vi.fn() },
      clock: () => NOW,
    })
    const ctx = buildTestAuthContext({
      role: 'AccountAdmin',
      effectivePermissions: new Set(['property.disconnect']),
      scopeByPermission: new Map([['property.disconnect', 'organization']]),
    })

    await expect(useCase({ propertyId: property.id }, ctx)).rejects.toMatchObject({
      _tag: 'PropertyError',
      code: 'invalid_transition',
    })
    expect(disconnect).not.toHaveBeenCalled()
  })
})
