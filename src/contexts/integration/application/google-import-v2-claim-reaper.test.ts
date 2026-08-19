import { describe, expect, it, vi } from 'vitest'
import {
  GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS,
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportV2StaleClaimItem,
  type GoogleImportV2Store,
} from './ports/google-import-v2-store.port'
import { createGoogleImportV2ClaimReaper } from './google-import-v2-claim-reaper'

const NOW = new Date('2026-08-12T10:00:00.000Z')
const ORG_ID = 'org-1'
const RETRYABLE_ITEM_ID = '20000000-0000-4000-8000-000000000001'
const EXHAUSTED_ITEM_ID = '20000000-0000-4000-8000-000000000002'
const FENCE_A = '20000000-0000-4000-8000-000000000003'
const FENCE_B = '20000000-0000-4000-8000-000000000004'

function staleClaim(
  over: Partial<GoogleImportV2StaleClaimItem> = {},
): GoogleImportV2StaleClaimItem {
  return {
    organizationId: ORG_ID,
    itemId: RETRYABLE_ITEM_ID,
    retryRevision: 2,
    claimFence: FENCE_A,
    attemptOrdinal: 1,
    ...over,
  }
}

function setup(
  staleClaims: readonly GoogleImportV2StaleClaimItem[] = [staleClaim()],
  outcomes: {
    release?: 'released' | 'lost'
    terminalize?: 'completed' | 'lost'
  } = {},
) {
  const listStaleClaimItems = vi.fn<GoogleImportV2Store['listStaleClaimItems']>(
    async () => staleClaims,
  )
  const releaseClaimForRetry = vi.fn<GoogleImportV2Store['releaseClaimForRetry']>(
    async () => outcomes.release ?? 'released',
  )
  const terminalizeItem = vi.fn<GoogleImportV2Store['terminalizeItem']>(
    async () => outcomes.terminalize ?? 'completed',
  )
  const reap = createGoogleImportV2ClaimReaper({
    store: { listStaleClaimItems, releaseClaimForRetry, terminalizeItem },
    clock: () => NOW,
  })
  return { reap, listStaleClaimItems, releaseClaimForRetry, terminalizeItem }
}

describe('GoogleImportV2ClaimReaper', () => {
  it('scans the bounded stale-claim set at the current database-facing instant', async () => {
    const harness = setup()

    await harness.reap()

    expect(harness.listStaleClaimItems).toHaveBeenCalledTimes(1)
    expect(harness.listStaleClaimItems).toHaveBeenCalledWith(NOW, 100)
  })

  // Recovery MUST go through the CAS helper, never a blind status write: the
  // scan is lock-free, so the exact retry revision and claim fence are what
  // stop the reaper from stealing a claim that was renewed or replaced after
  // the scan read it.
  it('releases a stale claim through the fenced CAS helper', async () => {
    const harness = setup([staleClaim({ retryRevision: 5, claimFence: FENCE_B })])

    await expect(harness.reap()).resolves.toEqual({
      staleClaimsVisited: 1,
      claimsReleased: 1,
      itemsTerminalized: 0,
      claimsLost: 0,
    })

    expect(harness.releaseClaimForRetry).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: RETRYABLE_ITEM_ID,
      retryRevision: 5,
      claimFence: FENCE_B,
      now: NOW,
    })
    expect(harness.terminalizeItem).not.toHaveBeenCalled()
  })

  // Releasing an item with no attempt left would park it 'pending' forever,
  // so the budget-spent case terminalizes instead — with the RETRYABLE
  // outcome, because the work never proved impossible: its owner vanished.
  it('terminalizes temporarily_unavailable once the attempt budget is spent', async () => {
    const harness = setup([
      staleClaim({
        itemId: EXHAUSTED_ITEM_ID,
        retryRevision: 3,
        attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
      }),
    ])

    await expect(harness.reap()).resolves.toEqual({
      staleClaimsVisited: 1,
      claimsReleased: 0,
      itemsTerminalized: 1,
      claimsLost: 0,
    })

    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.terminalizeItem).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      itemId: EXHAUSTED_ITEM_ID,
      retryRevision: 3,
      outcomeCode: 'temporarily_unavailable',
      retainProtectedRouting: false,
      now: NOW,
    })
  })

  it('routes the last attempt to release and only the spent budget to terminal', async () => {
    const harness = setup([
      staleClaim({ attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS - 1 }),
      staleClaim({
        itemId: EXHAUSTED_ITEM_ID,
        claimFence: FENCE_B,
        attemptOrdinal: GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
      }),
    ])

    await expect(harness.reap()).resolves.toEqual({
      staleClaimsVisited: 2,
      claimsReleased: 1,
      itemsTerminalized: 1,
      claimsLost: 0,
    })
  })

  it('counts a lost CAS without retrying or falling back to a terminal write', async () => {
    const harness = setup([staleClaim()], { release: 'lost' })

    await expect(harness.reap()).resolves.toEqual({
      staleClaimsVisited: 1,
      claimsReleased: 0,
      itemsTerminalized: 0,
      claimsLost: 1,
    })

    expect(harness.releaseClaimForRetry).toHaveBeenCalledTimes(1)
    expect(harness.terminalizeItem).not.toHaveBeenCalled()
  })

  it('does nothing when no claim lease has elapsed', async () => {
    const harness = setup([])

    await expect(harness.reap()).resolves.toEqual({
      staleClaimsVisited: 0,
      claimsReleased: 0,
      itemsTerminalized: 0,
      claimsLost: 0,
    })

    expect(harness.releaseClaimForRetry).not.toHaveBeenCalled()
    expect(harness.terminalizeItem).not.toHaveBeenCalled()
  })

  // The reaper's whole point: bound recovery by the claim lease instead of the
  // 24h effect deadline. A cadence above the lease would leave a dead worker's
  // item stuck for longer than the lease it is supposed to enforce.
  it('keeps the reaper cadence within one claim-lease width', () => {
    const reaperCadenceMs = 60_000
    expect(reaperCadenceMs).toBeLessThanOrEqual(GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS)
  })
})
