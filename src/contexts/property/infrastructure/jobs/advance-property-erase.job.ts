// LIF-01-T19 — the asynchronous purge that carries a confirmed Property Erase
// across the irreversible boundary.
//
// Three properties matter more than throughput here:
//
//   BOUNDED. One Property per pass. An unbounded sweep would turn one reviewed
//   authorization into many erasures, and the blast radius of a bug in this job
//   is permanent data loss.
//
//   ALL OR NOTHING PER PASS. A pass is one transaction: every context's deletes
//   and receipt, the move to `purged` and the ledger entry commit together or
//   not at all. An interruption — a redeploy, a crash, a lost connection — or
//   one context that fails rolls the whole pass back, the receipts of the
//   contexts that had already answered included, and the next pass asks every
//   context again. Nothing is left half erased and nothing is resumed. A pass
//   still reads the receipts first, so that a context is never asked twice
//   should a pass ever commit short of `purged`.
//
//   A `purging` authority is always the next one picked (`nextAdvanceable`), so
//   a context that keeps failing holds every other erasure behind this one
//   until its cause is repaired. No authority yields.
//
//   LEDGERED. Completion appends a backup-erasure ledger entry (LIF-01-T15), so
//   a later restore from a backup taken before this purge re-applies it instead
//   of resurrecting the Property.

import {
  assertValidPropertyEraseTransition,
  isPropertyEraseError,
  PROPERTY_ERASE_NOT_ARCHIVED_CANCEL_REASON,
  type PropertyEraseState,
} from '../../domain/property-erase'
import type {
  PropertyEraseAuthority,
  PropertyEraseCommandStore,
} from '../../application/ports/property-erase-command-store.port'
import type { PropertyEraseContributor } from '../../application/ports/property-erase-contributor.port'
import type { BackupErasureLedgerAppend } from '#/shared/db/lifecycle/backup-erasure-ledger'
import type { Tx } from '#/shared/outbox/commit'

export type AdvancePropertyEraseDeps = Readonly<{
  store: PropertyEraseCommandStore
  /** Rebinds the store to the pass's transaction. */
  storeIn: (tx: Tx) => PropertyEraseCommandStore
  contributors: readonly PropertyEraseContributor[]
  /** One transaction per pass; a throw leaves no partial receipt. */
  runInTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T>
  appendLedgerEntry(tx: Tx, entry: BackupErasureLedgerAppend): Promise<string>
  now: () => Date
}>

export type AdvancePropertyEraseResult = Readonly<{
  /** Null when nothing was ready — the ordinary idle outcome. */
  authorityId: string | null
  fromState: PropertyEraseState | null
  toState: PropertyEraseState | null
  contextsErased: number
  contextsSkippedAsReplayed: number
  rowsErased: number
  ledgerEntryId: string | null
}>

const IDLE: AdvancePropertyEraseResult = Object.freeze({
  authorityId: null,
  fromState: null,
  toState: null,
  contextsErased: 0,
  contextsSkippedAsReplayed: 0,
  rowsErased: 0,
  ledgerEntryId: null,
})

/**
 * Advance at most ONE Property Erase by one pass.
 *
 * A `purge_pending` authority whose grace period has expired crosses into
 * `purging`; a `purging` authority runs the contexts that have no receipt yet
 * and, when all of them have answered, completes into `purged`.
 */
export async function advancePropertyErase(
  deps: AdvancePropertyEraseDeps,
): Promise<AdvancePropertyEraseResult> {
  const now = deps.now()
  return deps.runInTransaction(async (tx) => {
    const store = deps.storeIn(tx)
    const authority = await store.nextAdvanceable(now)
    if (!authority) return IDLE

    if (authority.state === 'confirmed') {
      return startGracePeriod(store, authority, now)
    }

    if (authority.state === 'purge_pending') {
      // The irreversible boundary. Asserted here, guarded by the store's
      // `from` predicate, and re-checked by the database trigger.
      assertValidPropertyEraseTransition(authority.state, 'purging')
      await store.transition({
        authorityId: authority.id,
        from: 'purge_pending',
        to: 'purging',
        occurredAt: now,
      })
      return {
        ...IDLE,
        authorityId: authority.id,
        fromState: 'purge_pending',
        toState: 'purging',
      }
    }

    return purgeContexts(deps, store, tx, authority, now)
  })
}

/**
 * Scheduling only. The grace period runs on `purge_pending`, so this pass
 * never destroys anything and a cancel is still possible after it.
 *
 * Gate 1 is settled here. The Property stayed restorable while its erase was
 * requested, previewed and confirmed, and the store moves it only from
 * `archived`, under the row lock Restore takes. A Property restored since is in
 * use again: its authorization is void, so the erase is called off in this
 * pass. Leaving it `confirmed` would fail every later pass at the same place,
 * ahead of every other erasure.
 */
async function startGracePeriod(
  store: PropertyEraseCommandStore,
  authority: PropertyEraseAuthority,
  now: Date,
): Promise<AdvancePropertyEraseResult> {
  assertValidPropertyEraseTransition(authority.state, 'purge_pending')
  const pass = { ...IDLE, authorityId: authority.id, fromState: 'confirmed' } as const
  try {
    await store.transition({
      authorityId: authority.id,
      from: 'confirmed',
      to: 'purge_pending',
      occurredAt: now,
    })
    return { ...pass, toState: 'purge_pending' }
  } catch (error) {
    if (!isPropertyEraseError(error) || error.code !== 'property_not_archived') {
      throw error
    }
  }
  assertValidPropertyEraseTransition(authority.state, 'cancelled')
  await store.transition({
    authorityId: authority.id,
    from: 'confirmed',
    to: 'cancelled',
    reasonCode: PROPERTY_ERASE_NOT_ARCHIVED_CANCEL_REASON,
    occurredAt: now,
  })
  return { ...pass, toState: 'cancelled' }
}

async function purgeContexts(
  deps: AdvancePropertyEraseDeps,
  store: PropertyEraseCommandStore,
  tx: Tx,
  authority: PropertyEraseAuthority,
  now: Date,
): Promise<AdvancePropertyEraseResult> {
  const done = new Set(await store.completedContexts(authority.id, 'purge'))
  const scope = {
    organizationId: authority.organizationId,
    propertyId: authority.propertyId,
  }

  let rowsErased = 0
  let contextsErased = 0
  for (const contributor of deps.contributors) {
    if (done.has(contributor.context)) continue
    const erased = await contributor.erase(tx, scope)
    await store.recordContextReceipt({
      authorityId: authority.id,
      organizationId: authority.organizationId,
      context: contributor.context,
      phase: 'purge',
      // `no_data` is still an answer: a context with nothing to erase must be
      // distinguishable from a context that was never asked.
      outcome: erased === 0 ? 'no_data' : 'complete',
      erasedRowCount: erased,
      evidenceRef: `property-erase:${contributor.context}:purge:${authority.id}`,
      occurredAt: now,
    })
    rowsErased += erased
    contextsErased += 1
  }

  const answered = new Set(await store.completedContexts(authority.id, 'purge'))
  const outstanding = deps.contributors.filter(
    (contributor) => !answered.has(contributor.context),
  )
  if (outstanding.length > 0) {
    // A context has no receipt, which the loop above does not leave behind by
    // itself. Stay in `purging` rather than declare an erasure that did not
    // run: what this pass did commits with it, and the next pass asks only the
    // contexts still without a receipt.
    return {
      authorityId: authority.id,
      fromState: 'purging',
      toState: 'purging',
      contextsErased,
      contextsSkippedAsReplayed: done.size,
      rowsErased,
      ledgerEntryId: null,
    }
  }

  assertValidPropertyEraseTransition('purging', 'purged')
  await store.transition({
    authorityId: authority.id,
    from: 'purging',
    to: 'purged',
    occurredAt: now,
  })
  // The ledger entry is the control that stops a later restore from bringing
  // this Property back. It commits with the erasure or not at all.
  const ledgerEntryId = await deps.appendLedgerEntry(tx, {
    subjectClass: 'property',
    organizationId: authority.organizationId,
    propertyId: authority.propertyId,
    context: 'property',
    closureLineageId: authority.id,
    lifecycleRevision: 1,
    effectiveErasureAt: now,
    erasedRowCount: rowsErased,
    evidenceRef: `property-erase:complete:${authority.id}`,
  })

  return {
    authorityId: authority.id,
    fromState: 'purging',
    toState: 'purged',
    contextsErased,
    contextsSkippedAsReplayed: done.size,
    rowsErased,
    ledgerEntryId,
  }
}
