// Google import v2 — claim-lease reaper.
//
// The item claim lease (GOOGLE_IMPORT_ITEM_CLAIM_LEASE_MS, 60s) is the only
// bound on how long one attempt may own an item row. Nothing re-dispatched an
// item whose owner died: `listPendingDispatchItems` is driven exclusively by
// the outbox `integration.property_import.requested` event, and the daily
// lifecycle sweep only reacts to the EFFECT DEADLINE — hours later. So a
// killed worker left the row 'processing' and the tenant staring at a spinner
// for the rest of the effect window.
//
// This reaper makes recovery bounded by the lease instead:
//
//   - selects items that are still 'processing' with an elapsed claim lease;
//   - releases the claim through `releaseClaimForRetry` when the item still
//     has attempts left, so the next BullMQ attempt (or the tenant's own
//     retry) can claim it under a fresh fence;
//   - terminalizes it `temporarily_unavailable` through `terminalizeItem`
//     once the attempt budget is spent, so the row reaches an honest,
//     tenant-retryable terminal state instead of a permanent 'processing'.
//
// BOTH transitions go through the existing CAS helpers, which match on the
// exact `(organizationId, itemId, retryRevision, claimFence)` tuple and on the
// current status. There is no raw UPDATE here: a claim that was renewed,
// completed, or replaced between the scan and the write loses the CAS and is
// counted as 'lost', never overwritten. The scan is therefore allowed to be
// lock-free and slightly stale.
//
// Bounded and self-limiting: at most SWEEP_LIMIT rows per run, and a released
// item only becomes reapable again if something actually claims it again.

import {
  GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS,
  type GoogleImportV2Store,
} from './ports/google-import-v2-store.port'

const SWEEP_LIMIT = 100

type ClaimReaperStore = Pick<
  GoogleImportV2Store,
  'listStaleClaimItems' | 'releaseClaimForRetry' | 'terminalizeItem'
>

export type GoogleImportV2ClaimReaperResult = Readonly<{
  staleClaimsVisited: number
  claimsReleased: number
  itemsTerminalized: number
  claimsLost: number
}>

export type GoogleImportV2ClaimReaper = () => Promise<GoogleImportV2ClaimReaperResult>

export function createGoogleImportV2ClaimReaper(
  deps: Readonly<{
    store: ClaimReaperStore
    clock: () => Date
    limit?: number
  }>,
): GoogleImportV2ClaimReaper {
  const limit = deps.limit ?? SWEEP_LIMIT

  return async () => {
    const now = deps.clock()
    const staleClaims = await deps.store.listStaleClaimItems(now, limit)
    let claimsReleased = 0
    let itemsTerminalized = 0
    let claimsLost = 0

    for (const claim of staleClaims) {
      // Attempt budget spent: releasing would return the row to 'pending'
      // with no attempt left to consume it, so terminalize instead. The
      // outcome is the retryable one — the work never proved impossible, its
      // owner just vanished — which keeps the tenant's retry action available.
      if (claim.attemptOrdinal >= GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS) {
        const terminalized = await deps.store.terminalizeItem({
          organizationId: claim.organizationId,
          itemId: claim.itemId,
          retryRevision: claim.retryRevision,
          outcomeCode: 'temporarily_unavailable',
          retainRetryState: false,
          now,
        })
        if (terminalized === 'completed') itemsTerminalized++
        else claimsLost++
        continue
      }
      const released = await deps.store.releaseClaimForRetry({
        organizationId: claim.organizationId,
        itemId: claim.itemId,
        retryRevision: claim.retryRevision,
        claimFence: claim.claimFence,
        now,
      })
      if (released === 'released') claimsReleased++
      else claimsLost++
    }

    return {
      staleClaimsVisited: staleClaims.length,
      claimsReleased,
      itemsTerminalized,
      claimsLost,
    }
  }
}
