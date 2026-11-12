import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportDueItem,
  type GoogleImportStore,
} from './ports/google-import-store.port'
import { createGoogleImportClaimReaper } from './google-import-claim-reaper'

const NOW = new Date('2026-08-12T10:00:00.000Z')
const ITEM_ID = '20000000-0000-4000-8000-000000000001'
const FENCE = '20000000-0000-4000-8000-000000000003'

function staleClaim(over: Partial<GoogleImportDueItem> = {}): GoogleImportDueItem {
  return {
    organizationId: 'org-1',
    importJobId: '20000000-0000-4000-8000-000000000009',
    itemId: ITEM_ID,
    retryRevision: 2,
    dispatchEpoch: 4,
    claimFence: FENCE,
    status: 'processing',
    attemptOrdinal: 1,
    expectedConnectionLifecycleVersion: 1,
    expectedSourceEpoch: null,
    effectDeadlineAt: new Date(NOW.getTime() + 60 * 60 * 1_000),
    ...over,
  }
}

function setup(items: readonly GoogleImportDueItem[] = [staleClaim()]) {
  const reserveDueItems = vi.fn<GoogleImportStore['reserveDueItems']>(async () => items)
  const releaseClaimForRetry = vi.fn<GoogleImportStore['releaseClaimForRetry']>(
    async () => 'released',
  )
  const processItem = vi.fn(async () => {})
  const addImportItemJobs = vi.fn(async () => {})
  const reap = createGoogleImportClaimReaper({
    store: { reserveDueItems, releaseClaimForRetry },
    queue: { addImportItemJobs },
    processItem,
    logger: { warn: vi.fn() },
    clock: () => NOW,
    newDeliveryId: () => '20000000-0000-4000-8000-000000000008',
  })
  return { reap, reserveDueItems, releaseClaimForRetry, processItem, addImportItemJobs }
}

describe('GoogleImportClaimReaper', () => {
  it('reserves the bounded due set at the current database-facing instant', async () => {
    const h = setup()
    await h.reap()
    expect(h.reserveDueItems).toHaveBeenCalledExactlyOnceWith(NOW, 100)
  })

  it('releases a stale claim through the revision, epoch and fence CAS before redispatch', async () => {
    const h = setup()
    await expect(h.reap()).resolves.toEqual({
      dueItemsVisited: 1,
      claimsReleased: 1,
      itemsDispatched: 1,
      completionChecks: 0,
      claimsLost: 0,
      itemFailures: 0,
    })
    expect(h.releaseClaimForRetry).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      itemId: ITEM_ID,
      retryRevision: 2,
      dispatchEpoch: 4,
      claimFence: FENCE,
      expiredOnly: true,
      now: NOW,
    })
    expect(h.processItem).not.toHaveBeenCalled()
    expect(h.releaseClaimForRetry.mock.invocationCallOrder[0]).toBeLessThan(
      h.addImportItemJobs.mock.invocationCallOrder[0]!,
    )
  })

  it('hands exhausted work to the receipt-aware processor after fencing its dead owner', async () => {
    const h = setup([staleClaim({ attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS })])
    await expect(h.reap()).resolves.toMatchObject({
      completionChecks: 1,
      claimsReleased: 1,
    })
    expect(h.processItem).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org-1',
      itemId: ITEM_ID,
      retryRevision: 2,
      dispatchEpoch: 5,
      attemptOrdinal: 1,
    })
    expect(h.addImportItemJobs).not.toHaveBeenCalled()
  })

  it('also checks receipts through the processor after the effect deadline', async () => {
    const h = setup([staleClaim({ effectDeadlineAt: new Date(NOW.getTime() - 1) })])
    await h.reap()
    expect(h.processItem).toHaveBeenCalledOnce()
    expect(h.addImportItemJobs).not.toHaveBeenCalled()
  })

  it('dispatches the last allowed attempt and reconciles only the spent budget', async () => {
    const h = setup([
      staleClaim({ attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS - 1 }),
      staleClaim({ attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS }),
    ])
    await expect(h.reap()).resolves.toMatchObject({
      dueItemsVisited: 2,
      claimsReleased: 2,
      itemsDispatched: 1,
      completionChecks: 1,
    })
  })

  it('counts a lost CAS without a second write or dispatch', async () => {
    const h = setup()
    h.releaseClaimForRetry.mockResolvedValueOnce('lost')
    await expect(h.reap()).resolves.toMatchObject({ claimsLost: 1, claimsReleased: 0 })
    expect(h.releaseClaimForRetry).toHaveBeenCalledOnce()
    expect(h.processItem).not.toHaveBeenCalled()
    expect(h.addImportItemJobs).not.toHaveBeenCalled()
  })

  it('does nothing when there is no due work', async () => {
    const h = setup([])
    await expect(h.reap()).resolves.toEqual({
      dueItemsVisited: 0,
      claimsReleased: 0,
      itemsDispatched: 0,
      completionChecks: 0,
      claimsLost: 0,
      itemFailures: 0,
    })
    expect(h.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(h.processItem).not.toHaveBeenCalled()
    expect(h.addImportItemJobs).not.toHaveBeenCalled()
  })
})
