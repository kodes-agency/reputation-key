import { useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { inboxKeys } from '#/shared/queries/query-keys'
import type { requestReviewAnalysisNowFn } from '#/contexts/ai/server/review-analysis'
import type {
  InboxItem,
  InboxItemDetailResult,
} from '#/contexts/inbox/application/public-api'

/** A glance is not a read: only a review left open this long is hurried. */
export const ON_DEMAND_ANALYSIS_DWELL_MILLIS = 1_500
const POLL_INTERVAL_MILLIS = 5_000
const POLL_LIMIT_MILLIS = 90_000

type Input = Readonly<{
  /** The item open in the pane. Only a review item has an analysis to hurry. */
  item: Pick<InboxItem, 'id' | 'sourceType' | 'sourceId'>
  /** Its loaded detail; analysis status `none` means enabled but not analysed yet. */
  detail: Pick<InboxItemDetailResult, 'analysis'> | null
  request?: typeof requestReviewAnalysisNowFn
}>

/**
 * A review the manager is reading whose analysis still waits in the backlog
 * is analysed ahead of the queue (ADR 0058). Asked once per review per pane;
 * while the worker runs it, the detail is refetched until the topic chips
 * arrive or the wait gives up and leaves the review to the backlog.
 */
export function useOnDemandReviewAnalysis(input: Input): void {
  const queryClient = useQueryClient()
  const requested = useRef(new Set<string>())
  const { item, detail, request } = input
  const inboxItemId = item.id
  const reviewId = item.sourceType === 'review' ? item.sourceId : null
  const analysisStatus = detail?.analysis?.status ?? null

  useEffect(() => {
    if (!request || reviewId === null || analysisStatus !== 'none') return
    if (requested.current.has(reviewId)) return
    let cancelled = false
    let poll: number | undefined
    const dwell = window.setTimeout(() => {
      requested.current.add(reviewId)
      void request({ data: { reviewId } })
        .then((result) => {
          if (cancelled || result.status !== 'queued') return
          const startedAt = Date.now()
          poll = window.setInterval(() => {
            if (Date.now() - startedAt > POLL_LIMIT_MILLIS) {
              window.clearInterval(poll)
              return
            }
            void queryClient.invalidateQueries({
              queryKey: inboxKeys.detail(inboxItemId),
            })
          }, POLL_INTERVAL_MILLIS)
        })
        .catch(() => {
          // Nothing to show: the analysis still arrives with the backlog.
        })
    }, ON_DEMAND_ANALYSIS_DWELL_MILLIS)
    return () => {
      cancelled = true
      window.clearTimeout(dwell)
      if (poll !== undefined) window.clearInterval(poll)
    }
  }, [analysisStatus, inboxItemId, queryClient, request, reviewId])
}
