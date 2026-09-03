// Inbox detail reads: the detail + notes queries, their result shaping, and the
// refetch used to rebuild an optimistic-concurrency token after a
// `revision_conflict`. Kept beside useInboxDetail (which owns the mutations and
// the assembled state) so the read path has one authority.
import { queryOptions, useQuery, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { inboxKeys } from '#/shared/queries/query-keys'
import { replyRefetchInterval } from './inbox-cache-policy'
import { useTargetDeadlineRefresh } from './response-target-deadline-refresh'
import type { InboxServerFns } from './types'
import {
  REVISION_CONFLICT_MESSAGE,
  type InboxItem,
} from '#/contexts/inbox/application/public-api'

/**
 * A rejected server function reaches the client as a rebuilt Error: the wire
 * payload carries `code`, but TanStack Start's deserialization does not put it
 * back on the object, so the message is the field that survives intact — the
 * same reason `google-import-error-messages.ts` falls back to parsing text.
 * Both are matched so this keeps working if that changes.
 */
const isRevisionConflict = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) return false
  if ('code' in error && error.code === 'revision_conflict') return true
  return (
    'message' in error &&
    typeof error.message === 'string' &&
    error.message === REVISION_CONFLICT_MESSAGE
  )
}

export const inboxDetailQueryOptions = (
  id: string,
  getInboxItemDetail: InboxServerFns['getInboxItemDetail'],
) =>
  queryOptions({
    queryKey: inboxKeys.detail(id),
    queryFn: () => getInboxItemDetail({ data: { inboxItemId: id } }),
    // The router default is staleTime 30s, which would make the
    // revision-conflict refetch below return the same stale commandRevision it
    // is trying to replace — and the retry would conflict again. The detail
    // pane already read this query at staleTime 0.
    staleTime: 0,
  })

/**
 * How long a conflict recovery waits for the Inbox read model to catch up.
 *
 * The command store is authoritative for `commandRevision`; the projection the
 * detail pane reads is converged by the outbox relay on its tick
 * (`relay.start(5_000)` in src/worker/index.ts). A refetch issued immediately
 * after a `revision_conflict` therefore returns the SAME stale revision that
 * was just rejected, and retrying with it conflicts again. Recovery has to wait
 * for the projection to actually advance — bounded, so a genuinely wedged
 * projection surfaces the conflict to the manager instead of hanging.
 */
const READ_MODEL_CATCH_UP_TIMEOUT_MS = 7_000
const READ_MODEL_POLL_INTERVAL_MS = 400

/**
 * `recover` for any Inbox mutation whose only optimistic token is the item's
 * command revision.
 *
 * Recovers ONLY a `revision_conflict`: waits for the read model to move past
 * the rejected revision, then resubmits the same payload with the fresh one.
 * Returns null — letting the rejection stand — for every other error, and for a
 * conflict whose projection never advances; that give-up path is what tells the
 * manager the item really did change under them.
 */
export const withFreshCommandRevision =
  (
    qc: QueryClient,
    id: string,
    getInboxItemDetail: InboxServerFns['getInboxItemDetail'],
  ) =>
  async <TInput extends { data: { expectedCommandRevision: number } }>(
    input: TInput,
    error: unknown,
  ): Promise<TInput | null> => {
    if (!isRevisionConflict(error)) return null
    const rejected = input.data.expectedCommandRevision
    const deadline = Date.now() + READ_MODEL_CATCH_UP_TIMEOUT_MS
    for (;;) {
      const fresh = await qc.fetchQuery(inboxDetailQueryOptions(id, getInboxItemDetail))
      if (fresh.item.commandRevision !== rejected) {
        return {
          ...input,
          data: { ...input.data, expectedCommandRevision: fresh.item.commandRevision },
        }
      }
      if (Date.now() >= deadline) {
        toast.error(
          'This item changed while you were working. It has been refreshed — please try again.',
        )
        return null
      }
      const tick = Promise.withResolvers<void>()
      setTimeout(tick.resolve, READ_MODEL_POLL_INTERVAL_MS)
      await tick.promise
    }
  }

/** Detail + notes queries and their result shaping (loading/error/refetch). */
export function useInboxDetailQueries(
  inboxFns: Pick<InboxServerFns, 'getInboxItemDetail' | 'getInboxNotes'>,
  id: string,
  enabled: boolean,
  fallbackItem: InboxItem | null,
) {
  const detailQuery = useQuery({
    ...inboxDetailQueryOptions(id, inboxFns.getInboxItemDetail),
    enabled,
    staleTime: 0,
    // Poll while a reply publish is pending (approved → published happens
    // asynchronously via BullMQ) — the predicate lives in the cache policy.
    refetchInterval: (query) => replyRefetchInterval(query.state.data?.reply),
  })
  const notesQuery = useQuery({
    queryKey: inboxKeys.notes(id),
    queryFn: () => inboxFns.getInboxNotes({ data: { inboxItemId: id } }),
    enabled,
    staleTime: 0,
  })
  useTargetDeadlineRefresh(enabled, detailQuery.data?.responseTarget, detailQuery.refetch)

  const detail = detailQuery.data ?? null
  return {
    detail,
    notes: notesQuery.data ?? [],
    isLoading: detailQuery.isLoading || notesQuery.isLoading,
    currentItem: detail?.item ?? fallbackItem,
    error: detailQuery.error ? 'Failed to load detail. Try again.' : null,
    refetch: () => {
      void detailQuery.refetch()
      void notesQuery.refetch()
    },
    /** Live item status — feeds auto-close detection while polling. */
    polledStatus: detailQuery.data?.item.status,
  }
}
