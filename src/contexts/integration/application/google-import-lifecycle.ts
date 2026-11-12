import type { PropertyGoogleBindingPublicApi } from '#/contexts/property/application/public-api'
import { organizationId } from '#/shared/domain/ids'
import type { GoogleImportReferenceStore } from './ports/google-import-reference-store.port'
import { EXPIRED_ITEM_WRITE } from './google-import-contract'
import type {
  GoogleImportLifecycleScope,
  GoogleImportStore,
} from './ports/google-import-store.port'

const SWEEP_LIMIT = 100

type LifecycleStore = Pick<
  GoogleImportStore,
  | 'listExpiredItems'
  | 'reconcileFromReceipt'
  | 'terminalizeItem'
  | 'listPurgeCandidates'
  | 'purgeParent'
  | 'listLifecycleScopeParents'
  | 'fenceLifecycleParent'
  | 'listLifecycleScopeItems'
  | 'scrubLifecycleItems'
  | 'countLifecycleScopeItems'
  | 'getOperatorProgress'
>

type LifecyclePropertyApi = Pick<
  PropertyGoogleBindingPublicApi,
  'sweepReleasedExpired' | 'countUnreleasedExpired' | 'cleanupOrganization'
>

export type GoogleImportLifecycleSweepResult = Readonly<{
  expiredItemsVisited: number
  receiptsReconciled: number
  itemsTerminalized: number
  parentsPurged: number
  propertyReceiptsSwept: number
  unreleasedExpiredReceipts: number
}>

export type GoogleImportLifecycleCancellationResult = Readonly<{
  parentsFenced: number
  itemsVisited: number
  receiptsReconciled: number
  itemsCancelled: number
  itemIds: readonly string[]
}>

export type GoogleImportLifecycleBacklog = Readonly<{
  expiredItems: number
  purgeCandidates: number
  unreleasedExpiredReceipts: number
}>

export type GoogleImportLifecycleScopeInspection = Readonly<{
  outstandingItems: number
}>

type LifecycleReferences = Pick<
  GoogleImportReferenceStore,
  | 'invalidateOrganization'
  | 'invalidateUser'
  | 'invalidateConnection'
  | 'invalidateProperty'
>

export function createGoogleImportLifecycle(
  deps: Readonly<{
    store: LifecycleStore
    propertyBindingApi: LifecyclePropertyApi
    clock: () => Date
    newEventId: () => string
    references?: LifecycleReferences
  }>,
) {
  const reconcileReceipt = async (
    organizationIdValue: string,
    itemId: string,
    now: Date,
  ): Promise<boolean> =>
    (await deps.store.reconcileFromReceipt({
      organizationId: organizationIdValue,
      itemId,
      now,
    })) === 'completed'

  const fenceScopeParents = async (scope: GoogleImportLifecycleScope, now: Date) => {
    let parentsFenced = 0
    for (;;) {
      const parents = await deps.store.listLifecycleScopeParents(scope, SWEEP_LIMIT)
      if (parents.length === 0) break
      let batchProgress = 0
      for (const parent of parents) {
        const fenced = await deps.store.fenceLifecycleParent({
          organizationId: parent.organizationId,
          importJobId: parent.importJobId,
          now,
        })
        if (fenced === 'fenced') {
          parentsFenced++
          batchProgress++
        }
      }
      if (batchProgress === 0) {
        throw new Error('google import lifecycle parent fence made no progress')
      }
    }

    return parentsFenced
  }

  const scrubScopeItems = async (
    items: Awaited<ReturnType<LifecycleStore['listLifecycleScopeItems']>>,
    now: Date,
  ) => {
    let batchProgress = 0
    const byOrganization = new Map<string, string[]>()
    for (const item of items) {
      const itemIdsForOrganization = byOrganization.get(item.organizationId)
      if (itemIdsForOrganization) itemIdsForOrganization.push(item.itemId)
      else byOrganization.set(item.organizationId, [item.itemId])
    }
    for (const [organizationIdValue, itemIdsForOrganization] of byOrganization) {
      batchProgress += await deps.store.scrubLifecycleItems({
        organizationId: organizationIdValue,
        itemIds: itemIdsForOrganization,
        now,
      })
    }
    return batchProgress
  }

  const cancelScope = async (
    scope: GoogleImportLifecycleScope,
    outcomeCode: 'authorization_changed' | 'property_deleted' | 'user_cancelled',
    invalidate?: () => Promise<boolean>,
  ): Promise<GoogleImportLifecycleCancellationResult> => {
    if (invalidate && !(await invalidate())) {
      throw new Error('google import reference invalidation failed')
    }
    const now = deps.clock()
    const parentsFenced = await fenceScopeParents(scope, now)

    let itemsVisited = 0
    let receiptsReconciled = 0
    let itemsCancelled = 0
    const itemIds = new Set<string>()
    for (;;) {
      const items = await deps.store.listLifecycleScopeItems(scope, SWEEP_LIMIT)
      if (items.length === 0) break
      let batchProgress = 0
      for (const item of items) {
        itemIds.add(item.itemId)
        itemsVisited++
        if (!item.active) continue
        if (await reconcileReceipt(item.organizationId, item.itemId, now)) {
          receiptsReconciled++
          batchProgress++
          continue
        }
        const terminalized = await deps.store.terminalizeItem({
          organizationId: item.organizationId,
          itemId: item.itemId,
          retryRevision: item.retryRevision,
          authority: { kind: 'lifecycle' },
          outcomeCode,
          retainRetryState: false,
          now,
        })
        if (terminalized === 'completed') {
          itemsCancelled++
          batchProgress++
        }
      }
      batchProgress += await scrubScopeItems(items, now)
      if (batchProgress === 0) {
        throw new Error('google import lifecycle item cancellation made no progress')
      }
    }
    return {
      parentsFenced,
      itemsVisited,
      receiptsReconciled,
      itemsCancelled,
      itemIds: [...itemIds],
    }
  }

  const sweep = async (): Promise<GoogleImportLifecycleSweepResult> => {
    const now = deps.clock()
    const expiredItems = await deps.store.listExpiredItems(now, SWEEP_LIMIT)
    let receiptsReconciled = 0
    let itemsTerminalized = 0

    for (const item of expiredItems) {
      if (await reconcileReceipt(item.organizationId, item.itemId, now)) {
        receiptsReconciled++
        continue
      }
      const terminalized = await deps.store.terminalizeItem({
        organizationId: item.organizationId,
        itemId: item.itemId,
        retryRevision: item.retryRevision,
        authority: { kind: 'lifecycle' },
        ...EXPIRED_ITEM_WRITE,
        now,
      })
      if (terminalized === 'completed') itemsTerminalized++
    }

    const purgeCandidates = await deps.store.listPurgeCandidates(now, SWEEP_LIMIT)
    let parentsPurged = 0
    for (const candidate of purgeCandidates) {
      const purged = await deps.store.purgeParent({
        organizationId: candidate.organizationId,
        importJobId: candidate.importJobId,
        expectedDeletionFence: candidate.deletionFence,
        now,
        outboxEventId: deps.newEventId(),
      })
      if (purged === 'purged') parentsPurged++
    }

    const propertyReceiptsSwept = await deps.propertyBindingApi.sweepReleasedExpired({
      now,
      limit: SWEEP_LIMIT,
    })
    const unreleasedExpiredReceipts =
      await deps.propertyBindingApi.countUnreleasedExpired({
        now,
        limit: SWEEP_LIMIT,
      })
    if (unreleasedExpiredReceipts > 0) {
      throw new Error(
        `${unreleasedExpiredReceipts} expired Property import receipts lack retention release`,
      )
    }

    return {
      expiredItemsVisited: expiredItems.length,
      receiptsReconciled,
      itemsTerminalized,
      parentsPurged,
      propertyReceiptsSwept,
      unreleasedExpiredReceipts,
    }
  }

  const inspectBacklog = async (): Promise<GoogleImportLifecycleBacklog> => {
    const now = deps.clock()
    const [expiredItems, purgeCandidates, unreleasedExpiredReceipts] = await Promise.all([
      deps.store.listExpiredItems(now, SWEEP_LIMIT),
      deps.store.listPurgeCandidates(now, SWEEP_LIMIT),
      deps.propertyBindingApi.countUnreleasedExpired({
        now,
        limit: SWEEP_LIMIT,
      }),
    ])
    return {
      expiredItems: expiredItems.length,
      purgeCandidates: purgeCandidates.length,
      unreleasedExpiredReceipts,
    }
  }

  const inspectScope = async (
    scope: GoogleImportLifecycleScope,
  ): Promise<GoogleImportLifecycleScopeInspection> => ({
    outstandingItems: await deps.store.countLifecycleScopeItems(scope, SWEEP_LIMIT),
  })

  return Object.freeze({
    inspectBacklog,
    inspectScope,
    sweep,
    cancelConnection: (organizationIdValue: string, connectionId: string) =>
      cancelScope(
        { kind: 'connection', organizationId: organizationIdValue, connectionId },
        'authorization_changed',
        deps.references
          ? () =>
              deps.references!.invalidateConnection({
                organizationId: organizationIdValue,
                connectionId,
              })
          : undefined,
      ),
    cancelUser: (organizationIdValue: string, userId: string) =>
      cancelScope(
        { kind: 'user', organizationId: organizationIdValue, userId },
        'authorization_changed',
        deps.references
          ? () =>
              deps.references!.invalidateUser({
                organizationId: organizationIdValue,
                userId,
              })
          : undefined,
      ),
    cancelOrganization: async (organizationIdValue: string) => {
      const result = await cancelScope(
        { kind: 'organization', organizationId: organizationIdValue },
        'authorization_changed',
        deps.references
          ? () =>
              deps.references!.invalidateOrganization({
                organizationId: organizationIdValue,
              })
          : undefined,
      )
      await deps.propertyBindingApi.cleanupOrganization(
        organizationId(organizationIdValue),
      )
      return result
    },
    preparePropertyDeletion: (organizationIdValue: string, propertyId: string) =>
      cancelScope(
        { kind: 'property', organizationId: organizationIdValue, propertyId },
        'property_deleted',
        deps.references
          ? () =>
              deps.references!.invalidateProperty({
                organizationId: organizationIdValue,
                propertyId,
              })
          : undefined,
      ),
    finalizePropertyDeletion: async (
      organizationIdValue: string,
      itemIds: readonly string[],
    ): Promise<number> => {
      const now = deps.clock()
      let reconciled = 0
      for (const itemId of itemIds) {
        if (await reconcileReceipt(organizationIdValue, itemId, now)) reconciled++
      }
      return reconciled
    },
    cancelRequest: (organizationIdValue: string, importJobId: string) =>
      cancelScope(
        { kind: 'request', organizationId: organizationIdValue, importJobId },
        'user_cancelled',
      ),
    inspectRequest: (organizationIdValue: string, importJobId: string) =>
      deps.store.getOperatorProgress(organizationIdValue, importJobId),
  })
}
