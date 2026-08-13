import { describe, expect, it, vi } from 'vitest'
import { organizationId, propertyId } from '#/shared/domain/ids'
import type { PropertyOperationReceipt } from '#/contexts/property/application/ports/property-google-binding.port'
import type { GoogleImportV2Store } from './ports/google-import-v2-store.port'
import { createGoogleImportV2Lifecycle } from './google-import-v2-lifecycle'

const NOW = new Date('2026-08-12T10:00:00.000Z')
const ORG_ID = 'org-1'
const RECEIPT_ITEM_ID = '10000000-0000-4000-8000-000000000001'
const EXPIRED_ITEM_ID = '10000000-0000-4000-8000-000000000002'
const IMPORT_JOB_ID = '10000000-0000-4000-8000-000000000003'
const RELEASE_EVENT_ID = '10000000-0000-4000-8000-000000000004'

function receipt(): PropertyOperationReceipt {
  return {
    organizationId: organizationId(ORG_ID),
    idempotencyKey: RECEIPT_ITEM_ID,
    destinationPropertyId: propertyId('10000000-0000-4000-8000-000000000005'),
    outcome: 'imported',
    destinationSourceEpoch: 1,
    destinationProfileVersion: 1,
    tombstone: false,
    expiresAt: new Date('2026-09-13T10:00:00.000Z'),
    retentionReleasedAt: null,
  }
}

function setup(overrides?: { unreleasedExpired?: number }) {
  const store = {
    listExpiredItems: vi.fn<GoogleImportV2Store['listExpiredItems']>(async () => [
      { organizationId: ORG_ID, itemId: RECEIPT_ITEM_ID, retryRevision: 2 },
      { organizationId: ORG_ID, itemId: EXPIRED_ITEM_ID, retryRevision: 3 },
    ]),
    reconcileFromReceipt: vi.fn<GoogleImportV2Store['reconcileFromReceipt']>(
      async () => 'completed',
    ),
    terminalizeItem: vi.fn<GoogleImportV2Store['terminalizeItem']>(
      async () => 'completed',
    ),
    listPurgeCandidates: vi.fn<GoogleImportV2Store['listPurgeCandidates']>(async () => [
      { organizationId: ORG_ID, importJobId: IMPORT_JOB_ID, deletionFence: 7 },
    ]),
    purgeParent: vi.fn<GoogleImportV2Store['purgeParent']>(async () => 'purged'),
    listLifecycleScopeParents: vi.fn<GoogleImportV2Store['listLifecycleScopeParents']>(
      async () => [],
    ),
    fenceLifecycleParent: vi.fn<GoogleImportV2Store['fenceLifecycleParent']>(
      async () => 'fenced',
    ),
    listLifecycleScopeItems: vi.fn<GoogleImportV2Store['listLifecycleScopeItems']>(
      async () => [],
    ),
    scrubLifecycleItems: vi.fn<GoogleImportV2Store['scrubLifecycleItems']>(
      async (input) => input.itemIds.length,
    ),
    countLifecycleScopeItems: vi.fn<GoogleImportV2Store['countLifecycleScopeItems']>(
      async () => 0,
    ),
    getOperatorProgress: vi.fn<GoogleImportV2Store['getOperatorProgress']>(
      async () => null,
    ),
  }
  const propertyBindingApi = {
    readReceipt: vi.fn(async (_organizationId: unknown, itemId: string) =>
      itemId === RECEIPT_ITEM_ID ? receipt() : null,
    ),
    sweepReleasedExpired: vi.fn(async () => 4),
    countUnreleasedExpired: vi.fn(async () => overrides?.unreleasedExpired ?? 0),
    cleanupOrganization: vi.fn(async () => 0),
  }
  const references = {
    invalidateOrganization: vi.fn(async () => true),
    invalidateUser: vi.fn(async () => true),
    invalidateConnection: vi.fn(async () => true),
    invalidateProperty: vi.fn(async () => true),
  }
  const lifecycle = createGoogleImportV2Lifecycle({
    store,
    propertyBindingApi,
    clock: () => NOW,
    newEventId: () => RELEASE_EVENT_ID,
    references,
  })
  return { lifecycle, store, propertyBindingApi, references }
}

describe('Google import v2 lifecycle', () => {
  it('reconciles receipts before expiry terminalization, purges parents, and sweeps released receipts', async () => {
    const fixture = setup()

    await expect(fixture.lifecycle.sweep()).resolves.toEqual({
      expiredItemsVisited: 2,
      receiptsReconciled: 1,
      itemsTerminalized: 1,
      parentsPurged: 1,
      propertyReceiptsSwept: 4,
      unreleasedExpiredReceipts: 0,
    })
    expect(fixture.store.reconcileFromReceipt).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: RECEIPT_ITEM_ID,
      destinationPropertyId: receipt().destinationPropertyId,
      outcomeCode: 'imported',
      now: NOW,
    })
    expect(fixture.store.terminalizeItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: EXPIRED_ITEM_ID,
      retryRevision: 3,
      outcomeCode: 'temporarily_unavailable',
      retainProtectedRouting: false,
      now: NOW,
    })
    expect(fixture.store.purgeParent).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      importJobId: IMPORT_JOB_ID,
      expectedDeletionFence: 7,
      now: NOW,
      outboxEventId: RELEASE_EVENT_ID,
    })
    expect(fixture.propertyBindingApi.sweepReleasedExpired).toHaveBeenCalledWith({
      now: NOW,
      limit: 100,
    })
  })

  it('fails the sweep when expired Property receipts still lack retention release', async () => {
    const fixture = setup({ unreleasedExpired: 2 })

    await expect(fixture.lifecycle.sweep()).rejects.toThrow(
      '2 expired Property import receipts lack retention release',
    )
    expect(fixture.propertyBindingApi.countUnreleasedExpired).toHaveBeenCalledWith({
      now: NOW,
      limit: 100,
    })
  })

  it('invalidates connection references, fences parents, reconciles receipts, and scrubs items', async () => {
    const fixture = setup()
    fixture.store.listLifecycleScopeParents
      .mockResolvedValueOnce([{ organizationId: ORG_ID, importJobId: IMPORT_JOB_ID }])
      .mockResolvedValueOnce([])
    fixture.store.listLifecycleScopeItems
      .mockResolvedValueOnce([
        {
          organizationId: ORG_ID,
          importJobId: IMPORT_JOB_ID,
          itemId: RECEIPT_ITEM_ID,
          retryRevision: 2,
          active: true,
        },
        {
          organizationId: ORG_ID,
          importJobId: IMPORT_JOB_ID,
          itemId: EXPIRED_ITEM_ID,
          retryRevision: 3,
          active: true,
        },
      ])
      .mockResolvedValueOnce([])

    await expect(
      fixture.lifecycle.cancelConnection(ORG_ID, 'connection-1'),
    ).resolves.toEqual({
      parentsFenced: 1,
      itemsVisited: 2,
      receiptsReconciled: 1,
      itemsCancelled: 1,
      itemIds: [RECEIPT_ITEM_ID, EXPIRED_ITEM_ID],
    })
    expect(fixture.references.invalidateConnection).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      connectionId: 'connection-1',
    })
    expect(fixture.store.fenceLifecycleParent).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      importJobId: IMPORT_JOB_ID,
      now: NOW,
    })
    expect(fixture.store.terminalizeItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: EXPIRED_ITEM_ID,
      retryRevision: 3,
      outcomeCode: 'authorization_changed',
      retainProtectedRouting: false,
      now: NOW,
    })
    expect(fixture.store.scrubLifecycleItems).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemIds: [RECEIPT_ITEM_ID, EXPIRED_ITEM_ID],
      now: NOW,
    })
  })

  it('reconciles deletion tombstones after Property deletion', async () => {
    const fixture = setup()
    fixture.store.listLifecycleScopeParents
      .mockResolvedValueOnce([{ organizationId: ORG_ID, importJobId: IMPORT_JOB_ID }])
      .mockResolvedValueOnce([])
    fixture.store.listLifecycleScopeItems
      .mockResolvedValueOnce([
        {
          organizationId: ORG_ID,
          importJobId: IMPORT_JOB_ID,
          itemId: RECEIPT_ITEM_ID,
          retryRevision: 2,
          active: true,
        },
      ])
      .mockResolvedValueOnce([])

    const prepared = await fixture.lifecycle.preparePropertyDeletion(
      ORG_ID,
      '10000000-0000-4000-8000-000000000005',
    )
    fixture.propertyBindingApi.readReceipt.mockResolvedValueOnce({
      ...receipt(),
      destinationPropertyId: null,
      outcome: 'property_deleted',
      tombstone: true,
    })
    await fixture.lifecycle.finalizePropertyDeletion(ORG_ID, prepared.itemIds)

    expect(fixture.references.invalidateProperty).toHaveBeenCalled()
    expect(fixture.store.reconcileFromReceipt).toHaveBeenLastCalledWith({
      organizationId: ORG_ID,
      itemId: RECEIPT_ITEM_ID,
      destinationPropertyId: null,
      outcomeCode: 'property_deleted',
      now: NOW,
    })
  })

  it('fails closed when provider-reference invalidation is unavailable', async () => {
    const fixture = setup()
    fixture.references.invalidateUser.mockResolvedValueOnce(false)

    await expect(fixture.lifecycle.cancelUser(ORG_ID, 'user-1')).rejects.toThrow(
      'google import reference invalidation failed',
    )
    expect(fixture.store.listLifecycleScopeParents).not.toHaveBeenCalled()
  })

  it('inspects bounded global and tenant lifecycle backlog without mutation', async () => {
    const fixture = setup({ unreleasedExpired: 3 })
    fixture.store.countLifecycleScopeItems.mockResolvedValueOnce(7)

    await expect(fixture.lifecycle.inspectBacklog()).resolves.toEqual({
      expiredItems: 2,
      purgeCandidates: 1,
      unreleasedExpiredReceipts: 3,
    })
    await expect(
      fixture.lifecycle.inspectScope({
        kind: 'organization',
        organizationId: ORG_ID,
      }),
    ).resolves.toEqual({ outstandingItems: 7 })
    expect(fixture.store.countLifecycleScopeItems).toHaveBeenCalledWith(
      { kind: 'organization', organizationId: ORG_ID },
      100,
    )
    expect(fixture.store.terminalizeItem).not.toHaveBeenCalled()
    expect(fixture.store.purgeParent).not.toHaveBeenCalled()
  })
})
