import { and, eq, sql } from 'drizzle-orm'
import {
  gbpImportRequestItems,
  gbpImportRequests,
} from '#/shared/db/schema/google-import-v2.schema'
import { organizationId } from '#/shared/domain/ids'
import type { Tx } from '#/shared/outbox/commit'
import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import type { PrepareGoogleImportSync } from '#/contexts/review/application/public-api'
import {
  getImportOutcomePresentation,
  isImportProfileField,
  retainsRetryState,
  reconciledOutcomeCode,
  type GbpImportItemStatus,
  type ImportOutcomeCode,
} from '../application/google-import-v2-contract'
import { reduceGoogleImportParent } from '../application/google-import-v2-reducer'
import type {
  GoogleImportV2OutcomeDetail,
  GoogleImportV2TerminalAuthority,
} from '../application/ports/google-import-v2-store.port'

export type GoogleImportCompletionDeps = Readonly<{
  readReceipt: PropertyGoogleBindingPublicApi['readReceipt']
  ensureImportFollowUps: PropertyGoogleBindingPublicApi['ensureImportFollowUps']
  prepareImportSync: PrepareGoogleImportSync
}>

export type GoogleImportCompletionInput = Readonly<{
  organizationId: string
  itemId: string
  now: Date
}> &
  (
    | Readonly<{ authority: { kind: 'receipt' } }>
    | Readonly<{
        authority: GoogleImportV2TerminalAuthority
        retryRevision: number
        outcomeCode: ImportOutcomeCode
        retainRetryState: boolean
        detail?: GoogleImportV2OutcomeDetail
      }>
  )

function parentPatch(reduction: ReturnType<typeof reduceGoogleImportParent>) {
  return {
    status: reduction.status,
    processedCount: reduction.processedCount,
    pendingCount: reduction.counts.pending,
    processingCount: reduction.counts.processing,
    importedCount: reduction.counts.imported,
    relinkedCount: reduction.counts.relinked,
    alreadyExistsCount: reduction.counts.already_exists,
    failedCount: reduction.counts.failed,
    cancelledCount: reduction.counts.cancelled,
    firstTerminalAt: reduction.firstTerminalAt,
    // Match the CHECK's calendar-day interval, including session-zone DST changes.
    purgeAt:
      reduction.firstTerminalAt === null
        ? null
        : sql`${reduction.firstTerminalAt.toISOString()}::timestamptz + interval '30 days'`,
  }
}

type ParentReduction = Parameters<typeof reduceGoogleImportParent>[0]

/**
 * Re-derives the parent row from its current item rows. Every item transition
 * ends here, so the parent's counts, status and purge window are never written
 * independently of the items they summarise.
 */
export async function reduceParentFromItems(
  tx: Tx,
  input: Readonly<{
    organizationId: string
    importJobId: string
    firstTerminalAt: ParentReduction['firstTerminalAt']
    now: ParentReduction['now']
  }>,
): Promise<void> {
  const rows = await tx
    .select({
      status: gbpImportRequestItems.status,
      outcomeCode: gbpImportRequestItems.outcomeCode,
      highestAttemptForRevision: gbpImportRequestItems.highestAttemptForRevision,
    })
    .from(gbpImportRequestItems)
    .where(
      and(
        eq(gbpImportRequestItems.organizationId, input.organizationId),
        eq(gbpImportRequestItems.importJobId, input.importJobId),
      ),
    )
  const reduction = reduceGoogleImportParent({
    items: rows,
    firstTerminalAt: input.firstTerminalAt,
    now: input.now,
  })
  await tx
    .update(gbpImportRequests)
    .set({ ...parentPatch(reduction), updatedAt: input.now })
    .where(
      and(
        eq(gbpImportRequests.organizationId, input.organizationId),
        eq(gbpImportRequests.id, input.importJobId),
      ),
    )
}

/**
 * The detail a terminal outcome is allowed to carry. `tenant_profile_invalid`
 * must name its field; an existing Property is recorded only for
 * `already_exists`. Anything else is a programming error, refused before the
 * write rather than left to the CHECK constraint.
 */
function assertOutcomeDetail(
  outcomeCode: ImportOutcomeCode,
  detail: GoogleImportV2OutcomeDetail | undefined,
): void {
  if (outcomeCode === 'tenant_profile_invalid') {
    if (detail?.kind !== 'invalid_profile_field' || !isImportProfileField(detail.field)) {
      throw new Error('tenant_profile_invalid requires the rejected profile field')
    }
    return
  }
  if (detail?.kind === 'existing_property' && outcomeCode === 'already_exists') return
  if (detail !== undefined) {
    throw new Error(`google import outcome ${outcomeCode} cannot carry this detail`)
  }
}

/**
 * The items table accepts a `temporarily_unavailable` row only with its retry
 * state kept and a row of any other outcome only without it
 * (`gbp_import_request_items_profile_valid`). Refusing a mismatch here names the
 * caller's mistake before the write, instead of as a CHECK violation that aborts
 * the sweep or reaper pass holding the transaction.
 */
function assertRetryStateMatchesOutcome(
  input: Readonly<{ outcomeCode: ImportOutcomeCode; retainRetryState: boolean }>,
): void {
  if (input.retainRetryState === retainsRetryState(input.outcomeCode)) return
  throw new Error(
    `protected google import state ${input.retainRetryState ? 'may only' : 'must'} survive retryable failure`,
  )
}

/**
 * The terminal patch for an import item. `retainRetryState` leaves the protected
 * intent and expectation columns untouched; callers only set it for a retryable
 * failure.
 */
function terminalItemPatch(
  input: Readonly<{
    status: GbpImportItemStatus
    outcomeCode: ImportOutcomeCode
    retainRetryState: boolean
    now: Date
    detail?: GoogleImportV2OutcomeDetail
  }>,
) {
  const protectedState = input.retainRetryState ? undefined : null
  // The Property an `imported`/`relinked` item produced is an internal
  // reference the import flow hands the merchant to; it outlives the terminal
  // scrub of provider identifiers and fences (see the schema comment). An
  // `already_exists` item instead records the Property that holds its location.
  const producedProperty =
    input.status === 'imported' || input.status === 'relinked'
      ? undefined
      : input.detail?.kind === 'existing_property'
        ? input.detail.propertyId
        : null
  return {
    status: input.status,
    outcomeCode: input.outcomeCode,
    invalidProfileField:
      input.detail?.kind === 'invalid_profile_field' ? input.detail.field : null,
    connectionId: protectedState,
    existingPropertyId: protectedState,
    destinationPropertyId: input.retainRetryState ? undefined : producedProperty,
    expectedConnectionLifecycleVersion: protectedState,
    expectedConnectionAccessVersion: protectedState,
    expectedCredentialGeneration: protectedState,
    providerAccountSuffix: protectedState,
    providerLocationSuffix: protectedState,
    googleReviewUri: protectedState,
    googlePrimaryCategory: protectedState,
    expectedExecutionPolicyVersion: protectedState,
    expectedActorRole: protectedState,
    expectedPermissionDigest: protectedState,
    expectedPrincipalKind: protectedState,
    expectedPermissionVersion: protectedState,
    expectedSourceEpoch: protectedState,
    expectedProfileVersion: protectedState,
    claimFence: null,
    claimLeaseExpiresAt: null,
    nextDispatchAt: null,
    firstTerminalAt: sql`coalesce(${gbpImportRequestItems.firstTerminalAt}, ${input.now})`,
    updatedAt: input.now,
  }
}

type ImportItemRow = typeof gbpImportRequestItems.$inferSelect
type PropertyReceipt = NonNullable<
  Awaited<ReturnType<GoogleImportCompletionDeps['readReceipt']>>
>

function completionAuthorityMatches(
  item: ImportItemRow,
  input: GoogleImportCompletionInput,
): boolean {
  const authority = input.authority
  if (!('retryRevision' in input)) return true
  if (item.retryRevision !== input.retryRevision) return false
  if (
    item.status !== 'pending' &&
    item.status !== 'processing' &&
    item.outcomeCode !== 'temporarily_unavailable'
  )
    return false
  if (authority.kind === 'lifecycle' || authority.kind === 'receipt') return true
  if (item.dispatchEpoch !== authority.dispatchEpoch) return false
  if (authority.kind === 'pending') return item.status === 'pending'
  if (item.status !== 'processing' || item.claimFence !== authority.claimFence)
    return false
  if (
    authority.kind === 'expired_claim' &&
    (!item.claimLeaseExpiresAt || item.claimLeaseExpiresAt > input.now)
  )
    return false
  return true
}

function receiptMatchesItem(
  item: ImportItemRow,
  receipt: PropertyReceipt,
  outcomeCode: ImportOutcomeCode,
): boolean {
  const scrubbed =
    item.destinationPropertyId === null &&
    (item.status === 'cancelled' || item.status === 'failed')
  if (
    receipt.destinationPropertyId !== null &&
    !scrubbed &&
    receipt.destinationPropertyId !== item.destinationPropertyId
  )
    return false
  if (outcomeCode === 'imported' && item.action !== 'create') return false
  if (outcomeCode === 'relinked' && item.action !== 'relink') return false
  return true
}

const isSuccessfulBinding = (outcomeCode: ImportOutcomeCode) =>
  outcomeCode === 'imported' || outcomeCode === 'relinked'

function completionOutcome(
  receipt: PropertyReceipt | null,
  input: GoogleImportCompletionInput,
): ImportOutcomeCode | undefined {
  if (receipt) return reconciledOutcomeCode(receipt)
  if (!('outcomeCode' in input) || isSuccessfulBinding(input.outcomeCode))
    return undefined
  return input.outcomeCode
}

async function prepareReceiptSync(
  tx: Tx,
  deps: GoogleImportCompletionDeps,
  input: GoogleImportCompletionInput,
  receipt: PropertyReceipt,
  outcomeCode: ImportOutcomeCode,
) {
  if (
    !receipt.tombstone &&
    receipt.destinationPropertyId !== null &&
    isSuccessfulBinding(outcomeCode)
  ) {
    await deps.prepareImportSync(tx, {
      organizationId: input.organizationId,
      propertyId: receipt.destinationPropertyId,
      sourceEpoch: receipt.destinationSourceEpoch,
    })
  }
}

export function googleImportItemScope(organizationId: string, itemId: string) {
  return and(
    eq(gbpImportRequestItems.organizationId, organizationId),
    eq(gbpImportRequestItems.id, itemId),
  )
}

/** The item lock serializes completion with the Property effect. Read its
 * receipt only after that lock: an effect may commit while we wait for it. */
export async function completeGoogleImportItem(
  tx: Tx,
  deps: GoogleImportCompletionDeps,
  input: GoogleImportCompletionInput,
): Promise<'completed' | 'lost'> {
  const [item] = await tx
    .select()
    .from(gbpImportRequestItems)
    .where(googleImportItemScope(input.organizationId, input.itemId))
    .for('update')
    .limit(1)
  if (!item) return 'lost'
  if (!completionAuthorityMatches(item, input)) return 'lost'
  const receipt = await deps.readReceipt(
    organizationId(input.organizationId),
    input.itemId,
    input.now,
    tx,
  )
  const outcomeCode = completionOutcome(receipt, input)
  if (!outcomeCode) return 'lost'
  if (receipt) {
    if (!receiptMatchesItem(item, receipt, outcomeCode)) return 'lost'
    await prepareReceiptSync(tx, deps, input, receipt, outcomeCode)
    if (
      item.status === 'pending' ||
      item.status === 'processing' ||
      item.outcomeCode === 'temporarily_unavailable'
    )
      await deps.ensureImportFollowUps(tx, receipt, input.now)
  }
  const retainRetryState =
    !receipt && 'retainRetryState' in input && input.retainRetryState
  const detail = !receipt && 'detail' in input ? input.detail : undefined
  assertRetryStateMatchesOutcome({ outcomeCode, retainRetryState })
  assertOutcomeDetail(outcomeCode, detail)
  const presentation = getImportOutcomePresentation(outcomeCode)
  if (!presentation) throw new Error('unknown google import outcome')
  const [parent] = await tx
    .select({ firstTerminalAt: gbpImportRequests.firstTerminalAt })
    .from(gbpImportRequests)
    .where(
      and(
        eq(gbpImportRequests.organizationId, input.organizationId),
        eq(gbpImportRequests.id, item.importJobId),
      ),
    )
    .for('update')
    .limit(1)
  if (!parent) return 'lost'
  await tx
    .update(gbpImportRequestItems)
    .set({
      ...terminalItemPatch({
        status: presentation.status,
        outcomeCode,
        retainRetryState,
        now: input.now,
        ...(detail ? { detail } : {}),
      }),
      ...(receipt && isSuccessfulBinding(outcomeCode)
        ? { destinationPropertyId: receipt.destinationPropertyId }
        : {}),
    })
    .where(googleImportItemScope(input.organizationId, input.itemId))
  await reduceParentFromItems(tx, {
    organizationId: input.organizationId,
    importJobId: item.importJobId,
    firstTerminalAt: parent.firstTerminalAt,
    now: input.now,
  })
  return 'completed'
}

/** Isolated restore calls the same completion policy inside its fence transaction. */
export async function completeGoogleImportsForRestore(
  tx: Tx,
  deps: GoogleImportCompletionDeps,
  now: Date,
) {
  const candidates = await tx
    .select({
      organizationId: gbpImportRequestItems.organizationId,
      itemId: gbpImportRequestItems.id,
      retryRevision: gbpImportRequestItems.retryRevision,
      importJobId: gbpImportRequestItems.importJobId,
    })
    .from(gbpImportRequestItems)
    .where(
      sql`${gbpImportRequestItems.status} IN ('pending', 'processing') OR ${gbpImportRequestItems.outcomeCode} = 'temporarily_unavailable'`,
    )
  let items = 0
  const parents = new Set<string>()
  for (const item of candidates) {
    if (
      (await completeGoogleImportItem(tx, deps, {
        ...item,
        now,
        authority: { kind: 'lifecycle' },
        outcomeCode: 'authorization_changed',
        retainRetryState: false,
      })) === 'completed'
    ) {
      items++
      parents.add(item.importJobId)
    }
  }
  // A restored parent can still carry active counters while all its item
  // checkpoints are terminal. Repair those through the same reducer too.
  const unfinishedParents = await tx
    .select({
      id: gbpImportRequests.id,
      organizationId: gbpImportRequests.organizationId,
      firstTerminalAt: gbpImportRequests.firstTerminalAt,
    })
    .from(gbpImportRequests)
    .where(sql`${gbpImportRequests.status} IN ('queued', 'processing')`)
    .for('update')
  for (const parent of unfinishedParents) {
    await reduceParentFromItems(tx, {
      organizationId: parent.organizationId,
      importJobId: parent.id,
      firstTerminalAt: parent.firstTerminalAt,
      now,
    })
    parents.add(parent.id)
  }
  return { items, parents: parents.size }
}
