// The batch "Review & publish" of the Property look: reads the review of every
// live portal (only while the dialog is open), lets the manager leave a ready
// portal out, publishes the rest, and keeps what came of it. A portal that
// could not be published stays on the list to try again; one that was is not
// asked twice. The page-level pieces (which portals, who may publish) come in as
// props; this owns the dialog's own state.

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type {
  PortalReview,
  PublishPortalsChangesResult,
} from '#/contexts/portal/application/public-api'
import type { Action } from '#/components/hooks/use-action'
import { portalKeys } from '#/shared/queries/query-keys'
import { mapWithConcurrency, publishInBatches } from './property-look-batch-run'
import {
  batchEntryOf,
  idsToPublish,
  PUBLISH_BATCH_SIZE,
  type BatchEntry,
} from './property-look-batch-rules'
import type { AffectedPortalRow } from './property-look-rules'

/** The review read, as a route hands it in (a server function takes its input as `data`). */
export type PortalReviewReader = (args: {
  data: { portalId: string }
}) => Promise<PortalReview>

/** `publishPortalsChanges`, as a route hands it in. */
export type PublishPortalsAction = Action<
  { data: { portalIds: string[] } },
  PublishPortalsChangesResult
>

type Outcome = PublishPortalsChangesResult[number]

/** How many reviews are read at once: a review reads several tables, and a Property may have fifty portals. */
const REVIEW_CONCURRENCY = 4

export type BatchRow = Readonly<{ row: AffectedPortalRow; entry: BatchEntry }>

export type BatchRun =
  | Readonly<{ status: 'reviewing' }>
  | Readonly<{ status: 'publishing' }>
  | Readonly<{
      status: 'done'
      /** The portals that were sent, in the order shown. */
      attempted: readonly string[]
      outcomes: readonly Outcome[]
      /** A request refused as a whole; the portals after it were not touched. */
      error: unknown
    }>

type Args = Readonly<{
  propertyId: string
  live: readonly AffectedPortalRow[]
  getPortalReview: PortalReviewReader
  publishPortals: PublishPortalsAction
}>

export function usePropertyLookBatch({
  propertyId,
  live,
  getPortalReview,
  publishPortals,
}: Args) {
  const ids = useMemo(() => live.map((row) => row.portalId), [live])
  const reviews = useQuery({
    queryKey: portalKeys.lookReviewOf(propertyId, ids.join(',')),
    queryFn: () =>
      mapWithConcurrency(ids, REVIEW_CONCURRENCY, async (portalId) => {
        try {
          return { portalId, review: await getPortalReview({ data: { portalId } }) }
        } catch {
          // One portal that cannot be read does not hide the others.
          return { portalId, review: null }
        }
      }),
    // A review is a decision about what to publish: read it again every time the
    // dialog opens, and never show the one from the last opening.
    staleTime: 0,
    gcTime: 0,
  })
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(() => new Set())
  const [run, setRun] = useState<BatchRun>({ status: 'reviewing' })

  const rows: readonly BatchRow[] | null = useMemo(() => {
    if (reviews.data === undefined) return null
    const byId = new Map(reviews.data.map((item) => [item.portalId, item.review]))
    return live.map((row) => ({
      row,
      entry: batchEntryOf(byId.get(row.portalId) ?? null),
    }))
  }, [reviews.data, live])

  const toggle = (portalId: string) =>
    setLeftOut((current) => {
      const next = new Set(current)
      if (!next.delete(portalId)) next.add(portalId)
      return next
    })

  const send = async (
    sending: readonly string[],
    before: Readonly<{ attempted: readonly string[]; outcomes: readonly Outcome[] }>,
  ) => {
    setRun({ status: 'publishing' })
    const result = await publishInBatches(
      sending,
      (batch) => publishPortals({ data: { portalIds: [...batch] } }),
      PUBLISH_BATCH_SIZE,
    )
    const sent = new Set(sending)
    const asked = new Set([...before.attempted, ...sending])
    setRun({
      status: 'done',
      attempted: live.map((row) => row.portalId).filter((id) => asked.has(id)),
      outcomes: [
        ...before.outcomes.filter((o) => !sent.has(o.portalId)),
        ...result.outcomes,
      ],
      error: result.error,
    })
  }

  const publishable =
    rows === null
      ? []
      : idsToPublish(
          rows.map((item) => ({ portalId: item.row.portalId, entry: item.entry })),
          leftOut,
        )
  /** After a run: what did not go through (failed, or never reached), to try again. */
  const retryable =
    run.status !== 'done'
      ? []
      : run.attempted.filter((id) => {
          const outcome = run.outcomes.find((o) => o.portalId === id)
          return outcome === undefined || outcome.outcome === 'failed'
        })

  return {
    rows,
    isLoading: reviews.isPending,
    hasReadFailed: reviews.isError,
    reload: () => void reviews.refetch(),
    leftOut,
    toggle,
    run,
    publishable,
    retryable,
    publish: () => send(publishable, { attempted: [], outcomes: [] }),
    retry: () =>
      send(retryable, run.status === 'done' ? run : { attempted: [], outcomes: [] }),
  }
}
