// Feed writes as the reader sees them before the server answers.
//
// A write never edits the cached server reads while it is in flight. Each
// pending write is a mutation in the query client's mutation cache, keyed
// under the feed, and every surface shows the server's rows and counts with
// the pending writes applied in the order they were made. A write stays
// pending until the head read its success starts has landed, then simply
// stops applying: there is no snapshot to restore, so a failed write cannot
// bring back what a sibling that succeeded meanwhile changed, and a poll
// answered from before the write cannot undo it on screen.
//
// Once settled, a confirmed write is applied to the never-polled older lists
// of the Organization, and an unknown outcome (a failure, or an Undo whose
// rows nobody can patch) marks them for the next head read to re-read.

import type { MutationKey, QueryClient, QueryKey } from '@tanstack/react-query'
import type {
  NotificationFeedHead,
  NotificationListFilter,
  NotificationView,
} from '#/contexts/feed/application/public-api'
import { createKeys } from '#/shared/queries/query-keys'
import type { TenantScope } from '#/shared/queries/tenant-scope'
import { matchesNotificationFilter } from './notification-filters'
import {
  holdsEveryUnread,
  patchedCounts,
  uniqueRows,
  unreadDeltaWithin,
  type ClearedUnread,
  type FeedCounts,
  type RowPatch,
} from './notification-feed-counts'
import {
  markOlderNotificationsStale,
  patchOlderNotifications,
  type OlderNotifications,
} from './notification-feed-older'

export type FeedWriteKind =
  | 'markRead'
  | 'markUnread'
  | 'dismiss'
  | 'markAllRead'
  | 'dismissAll'
  | 'muteCategory'
  | 'restore'
  | 'undoMuteCategory'

/** A write still in flight: what was asked, as submitted. */
export type PendingFeedWrite = Readonly<{ kind: FeedWriteKind; input: unknown }>

/** Where every feed write of the Organization sits in the mutation cache. */
export const feedWritesKey = (scope: TenantScope, organizationId: string) =>
  [...createKeys(scope).notificationKeys.feed(organizationId), 'write'] as const

export const feedWriteKey = (
  scope: TenantScope,
  organizationId: string,
  kind: FeedWriteKind,
): MutationKey => [...feedWritesKey(scope, organizationId), kind]

/** The pending write a mutation in the cache stands for, from its key. */
export const pendingFeedWrite = (mutation: {
  options: { mutationKey?: MutationKey }
  state: { variables: unknown }
}): PendingFeedWrite => ({
  kind: mutation.options.mutationKey?.at(-1) as FeedWriteKind,
  input: mutation.state.variables,
})

/** The Organization's writes in flight, oldest first. */
export const pendingFeedWrites = (
  qc: QueryClient,
  scope: TenantScope,
  organizationId: string,
): ReadonlyArray<PendingFeedWrite> =>
  qc
    .getMutationCache()
    .findAll({ mutationKey: feedWritesKey(scope, organizationId), status: 'pending' })
    .map(pendingFeedWrite)

export const readNow = (row: NotificationView): NotificationView => ({
  ...row,
  status: 'read',
  readAt: new Date(),
})

/** Whether a row is inside the page's Property filter; no filter holds every row. */
const inProperty = (row: NotificationView, propertyId: string | undefined) =>
  propertyId === undefined || row.propertyId === propertyId

type WriteEffect = Readonly<{
  patch: RowPatch
  /** The filter whose every unread row the write reaches, loaded or not. */
  clears?: NotificationListFilter
  /** Nothing is left below the loaded rows. */
  endsFeed?: boolean
}>

type RowInput = { data: { notificationId: string } }
type MarkAllInput = { data?: { filter?: NotificationListFilter; propertyId?: string } }
type DismissAllInput = { data?: { propertyId?: string } }
type MuteInput = { data: { propertyId: string; category: string } }

const onRow = (input: unknown, change: RowPatch): RowPatch => {
  const id = (input as RowInput).data.notificationId
  return (row) => (row.id === id ? change(row) : row)
}

/**
 * What a write does to the rows it reaches. An Undo has none: the server
 * decides whether a restored row is unread (another row may have taken its
 * place meanwhile), so it comes back through the next read.
 */
function effectOf({ kind, input }: PendingFeedWrite): WriteEffect | undefined {
  switch (kind) {
    case 'markRead':
      return { patch: onRow(input, readNow) }
    case 'markUnread':
      return {
        patch: onRow(input, (row) => ({ ...row, status: 'unread', readAt: null })),
      }
    case 'dismiss':
      return { patch: onRow(input, () => null) }
    case 'markAllRead': {
      const filter = (input as MarkAllInput | undefined)?.data?.filter ?? 'all'
      const propertyId = (input as MarkAllInput | undefined)?.data?.propertyId
      return {
        patch: (row) =>
          row.status === 'unread' &&
          matchesNotificationFilter(row, filter) &&
          inProperty(row, propertyId)
            ? readNow(row)
            : row,
        // One Property's share is not the filter's: the loaded rows say what
        // moved, and the next head read says the rest.
        ...(propertyId ? {} : { clears: filter }),
      }
    }
    case 'dismissAll': {
      const propertyId = (input as DismissAllInput | undefined)?.data?.propertyId
      if (propertyId)
        return { patch: (row) => (inProperty(row, propertyId) ? null : row) }
      return { patch: () => null, clears: 'all', endsFeed: true }
    }
    case 'muteCategory': {
      // The server hides every row of the category for that Property, read or
      // unread, from the next read on.
      const { propertyId, category } = (input as MuteInput).data
      return {
        patch: (row) =>
          row.propertyId === propertyId && row.category === category ? null : row,
      }
    }
    case 'restore':
    case 'undoMuteCategory':
      return undefined
  }
}

type FeedIdentity = Readonly<{ filter: NotificationListFilter; propertyId?: string }>

const identityOf = (queryKey: QueryKey): FeedIdentity =>
  queryKey.find(
    (part): part is FeedIdentity =>
      typeof part === 'object' && part !== null && 'filter' in part,
  ) ?? { filter: 'all' }

/** The patch as one list sees it: a changed row that left its filter leaves it. */
function patchWithin(filter: NotificationListFilter, patch: RowPatch): RowPatch {
  return (row) => {
    const patched = patch(row)
    if (patched === null || patched === row) return patched
    return matchesNotificationFilter(patched, filter) ? patched : null
  }
}

const applyPatch = (rows: ReadonlyArray<NotificationView>, patch: RowPatch) =>
  rows.flatMap((row) => {
    const patched = patch(row)
    return patched ? [patched] : []
  })

const isHead = (data: unknown): data is NotificationFeedHead =>
  typeof data === 'object' && data !== null && 'unreadCount' in data

/**
 * Every row of the Organization loaded on any surface, each once and the
 * heads' copy first (the freshest read). A row action moves the counts by the
 * rows it changes, and the row may be loaded only on the other surface.
 */
function loadedRows(qc: QueryClient, listsKey: QueryKey) {
  const cached = qc.getQueriesData<unknown>({ queryKey: listsKey })
  const heads = cached.flatMap(([, data]) =>
    isHead(data) ? data.page.notifications : [],
  )
  const older = cached.flatMap(([, data]) =>
    data && !isHead(data) ? (data as OlderNotifications).rows : [],
  )
  return uniqueRows([...heads, ...older])
}

/** How many unread rows `filter` holds, from its own head for the whole feed, if cached. */
function heldBy(qc: QueryClient, listsKey: QueryKey, filter: NotificationListFilter) {
  const held = qc
    .getQueriesData<unknown>({ queryKey: listsKey })
    .flatMap(([key, data]) => {
      const identity = identityOf(key)
      return isHead(data) &&
        identity.filter === filter &&
        identity.propertyId === undefined
        ? [data.filterUnreadCount]
        : []
    })
  return held.length > 0 ? Math.max(...held) : undefined
}

export type FeedView = Readonly<
  FeedCounts & { rows: ReadonlyArray<NotificationView>; hasMore: boolean }
>

/**
 * One surface's rows and counts with the pending writes applied, oldest
 * first. A head filtered to one Property moves by that Property's rows only,
 * and takes a filter-wide write's reach only when every unread row went.
 */
export function withPendingWrites(
  qc: QueryClient,
  scope: TenantScope,
  organizationId: string,
  surface: FeedIdentity,
  view: FeedView,
  writes: ReadonlyArray<PendingFeedWrite>,
): FeedView {
  const effects = writes.flatMap((write) => effectOf(write) ?? [])
  if (effects.length === 0) return view
  const listsKey = createKeys(scope).notificationKeys.lists(organizationId)
  const { filter, propertyId } = surface
  let loaded = loadedRows(qc, listsKey)
  let current = view
  for (const effect of effects) {
    const before = loaded
    const deltaWithin = (rows: typeof loaded) => (within: NotificationListFilter) =>
      unreadDeltaWithin(rows, effect.patch, within)
    const delta = deltaWithin(
      propertyId === undefined
        ? before
        : before.filter((row) => row.propertyId === propertyId),
    )
    const cleared: ClearedUnread | undefined =
      effect.clears !== undefined &&
      (propertyId === undefined || holdsEveryUnread(effect.clears))
        ? {
            filter: effect.clears,
            held:
              heldBy(qc, listsKey, effect.clears) ?? -deltaWithin(before)(effect.clears),
          }
        : undefined
    current = {
      ...patchedCounts(current, filter, delta, cleared),
      rows: applyPatch(current.rows, patchWithin(filter, effect.patch)),
      hasMore: effect.endsFeed ? false : current.hasMore,
    }
    loaded = applyPatch(before, effect.patch)
  }
  return current
}

/**
 * Mutation options every feed write shares: its place in the mutation cache,
 * and the re-read when it settles however it ended. The write keeps applying
 * until that re-read is on screen.
 */
export const feedWriteOptions = (
  qc: QueryClient,
  scope: TenantScope,
  organizationId: string,
  kind: FeedWriteKind,
) => ({
  mutationKey: feedWriteKey(scope, organizationId, kind),
  onSuccess: (_: unknown, input: unknown) =>
    settleFeedWrite(qc, scope, organizationId, { kind, input }, true),
  onError: (_: unknown, input: unknown) =>
    settleFeedWrite(qc, scope, organizationId, { kind, input }, false),
})

/**
 * After a write settles: a confirmed one is applied to every older list (they
 * are never polled), anything else marks them for re-reading, and every feed
 * head is read again. Resolves once the shown heads (and the older lists under
 * them) have been read, so the write stops applying only when the server's
 * answer is on screen.
 */
export async function settleFeedWrite(
  qc: QueryClient,
  scope: TenantScope,
  organizationId: string,
  write: PendingFeedWrite,
  confirmed: boolean,
): Promise<void> {
  const { notificationKeys } = createKeys(scope)
  const listsKey = notificationKeys.lists(organizationId)
  const effect = confirmed ? effectOf(write) : undefined
  if (effect) {
    patchOlderNotifications(qc, listsKey, (key) =>
      patchWithin(identityOf(key).filter, effect.patch),
    )
  } else {
    markOlderNotificationsStale(qc, listsKey)
  }
  await qc.invalidateQueries({ queryKey: notificationKeys.feed(organizationId) })
}
