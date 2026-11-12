import { describe, expect, it, vi } from 'vitest'
import { createGoogleImportClaimReaper } from './google-import-claim-reaper'
import type {
  GoogleImportDueItem,
  GoogleImportStore,
} from './ports/google-import-store.port'

const NOW = new Date('2026-08-12T10:00:00Z')
const dueItem = (over: Partial<GoogleImportDueItem> = {}): GoogleImportDueItem => ({
  organizationId: 'org-one',
  importJobId: '10000000-0000-4000-8000-000000000001',
  itemId: '10000000-0000-4000-8000-000000000002',
  retryRevision: 0,
  dispatchEpoch: 3,
  status: 'pending',
  claimFence: null,
  attemptOrdinal: 0,
  expectedConnectionLifecycleVersion: 1,
  expectedSourceEpoch: null,
  effectDeadlineAt: new Date(NOW.getTime() + 60_000),
  ...over,
})

function setup(items: readonly GoogleImportDueItem[]) {
  const reserveDueItems = vi.fn(async () => items)
  const releaseClaimForRetry = vi.fn<GoogleImportStore['releaseClaimForRetry']>(
    async () => 'released',
  )
  const addImportItemJobs = vi.fn(async () => {})
  const processItem = vi.fn(async () => {})
  const logger = { warn: vi.fn() }
  const reap = createGoogleImportClaimReaper({
    store: { reserveDueItems, releaseClaimForRetry },
    queue: { addImportItemJobs },
    processItem,
    logger,
    clock: () => NOW,
    newDeliveryId: () => '10000000-0000-4000-8000-000000000009',
  })
  return {
    reap,
    reserveDueItems,
    releaseClaimForRetry,
    addImportItemJobs,
    processItem,
    logger,
  }
}

describe('Google import due recovery', () => {
  it('reserves a bounded page before dispatching a pending item from an empty queue', async () => {
    const h = setup([dueItem()])
    await h.reap()
    expect(h.reserveDueItems).toHaveBeenCalledExactlyOnceWith(NOW, 100)
    expect(h.addImportItemJobs).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ dispatchEpoch: 3, itemId: dueItem().itemId }),
    ])
    expect(h.reserveDueItems.mock.invocationCallOrder[0]).toBeLessThan(
      h.addImportItemJobs.mock.invocationCallOrder[0]!,
    )
  })

  it('fences a dead claim before redispatching its next generation', async () => {
    const item = dueItem({
      status: 'processing',
      claimFence: 'old-fence',
      attemptOrdinal: 2,
    })
    const h = setup([item])
    await h.reap()
    expect(h.releaseClaimForRetry).toHaveBeenCalledExactlyOnceWith({
      organizationId: item.organizationId,
      itemId: item.itemId,
      retryRevision: item.retryRevision,
      dispatchEpoch: 3,
      claimFence: 'old-fence',
      expiredOnly: true,
      now: NOW,
    })
    expect(h.addImportItemJobs).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ dispatchEpoch: 4 }),
    ])
  })

  it('uses the receipt-aware processor for an exhausted item and continues after its failure', async () => {
    const poisoned = dueItem({ attemptOrdinal: 5 })
    const healthy = dueItem({
      itemId: '10000000-0000-4000-8000-000000000003',
      organizationId: 'other-tenant',
    })
    const h = setup([poisoned, healthy])
    h.processItem.mockRejectedValueOnce(new Error('receipt unavailable'))
    await expect(h.reap()).resolves.toMatchObject({ itemFailures: 1, itemsDispatched: 1 })
    expect(h.processItem).toHaveBeenCalledExactlyOnceWith({
      organizationId: poisoned.organizationId,
      itemId: poisoned.itemId,
      retryRevision: 0,
      dispatchEpoch: 3,
      attemptOrdinal: 1,
    })
    expect(h.addImportItemJobs).toHaveBeenCalledExactlyOnceWith([
      expect.objectContaining({ itemId: healthy.itemId }),
    ])
    expect(h.logger.warn).toHaveBeenCalledExactlyOnceWith(
      { itemId: poisoned.itemId, errorName: 'Error' },
      expect.any(String),
    )
  })

  it('never sends a stale reservation after another worker replaces its claim', async () => {
    const h = setup([dueItem({ status: 'processing', claimFence: 'old-fence' })])
    h.releaseClaimForRetry.mockResolvedValueOnce('lost')
    await expect(h.reap()).resolves.toMatchObject({ claimsLost: 1 })
    expect(h.processItem).not.toHaveBeenCalled()
    expect(h.addImportItemJobs).not.toHaveBeenCalled()
  })

  it('continues another tenant after enqueue fails', async () => {
    const h = setup([
      dueItem(),
      dueItem({ itemId: '10000000-0000-4000-8000-000000000004' }),
    ])
    h.addImportItemJobs.mockRejectedValueOnce(new Error('queue unavailable'))
    await expect(h.reap()).resolves.toMatchObject({ itemFailures: 1, itemsDispatched: 1 })
    expect(h.addImportItemJobs).toHaveBeenCalledTimes(2)
  })
})
