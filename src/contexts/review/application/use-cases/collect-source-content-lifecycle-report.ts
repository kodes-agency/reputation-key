import type {
  ReviewSourceContentLifecycleInspectionMode,
  ReviewSourceContentLifecycleScope,
  ReviewSourceContentShadowFinding,
} from '../ports/source-content-lifecycle-store.port'
import type {
  ReviewSourceContentLifecycleCheckpoint,
  RunReviewSourceContentLifecycle,
} from './run-source-content-lifecycle'

export type ReviewSourceContentLifecycleReportSummary = Readonly<{
  mode: ReviewSourceContentLifecycleInspectionMode
  scope: ReviewSourceContentLifecycleScope
  evaluatedAt: string
  pages: number
  scanned: number
  lifecycle: Readonly<{
    eligible: number
    expired: number
    tombstone: number
    unverifiable: number
  }>
  /** Aggregate-only so a full-dataset inspection stays memory bounded. */
  shadow: Readonly<{
    matched: number
    drifted: number
    findingCounts: Partial<Record<ReviewSourceContentShadowFinding, number>>
  }> | null
}>

export type CollectReviewSourceContentLifecycleReportInput = Readonly<{
  mode: ReviewSourceContentLifecycleInspectionMode
  batchSize: number
  scope?: ReviewSourceContentLifecycleScope
}>

const cursorKey = (checkpoint: ReviewSourceContentLifecycleCheckpoint): string =>
  `${checkpoint.evaluatedAt}\0${checkpoint.after.createdAt}\0${checkpoint.after.reviewId}`

/**
 * Drain one frozen, checkpointed inspection window without exposing provider
 * content or retaining an unbounded list of Review identifiers in memory.
 */
export const collectReviewSourceContentLifecycleReport = async (
  runLifecycle: RunReviewSourceContentLifecycle,
  input: CollectReviewSourceContentLifecycleReportInput,
): Promise<ReviewSourceContentLifecycleReportSummary> => {
  let checkpoint: ReviewSourceContentLifecycleCheckpoint | undefined
  let priorCursor: string | null = null
  let evaluatedAt: string | null = null
  let scope: ReviewSourceContentLifecycleScope | null = null
  let pages = 0
  let scanned = 0
  const lifecycle = { eligible: 0, expired: 0, tombstone: 0, unverifiable: 0 }
  const shadow =
    input.mode === 'shadow'
      ? {
          matched: 0,
          drifted: 0,
          findingCounts: {} as Partial<Record<ReviewSourceContentShadowFinding, number>>,
        }
      : null

  do {
    const result = await runLifecycle({
      mode: input.mode,
      batchSize: input.batchSize,
      ...(input.scope == null ? {} : { scope: input.scope }),
      ...(checkpoint == null ? {} : { checkpoint }),
    })
    if (result.mode !== input.mode) {
      throw new Error('Review lifecycle report mode changed during collection')
    }
    if (evaluatedAt == null) {
      evaluatedAt = result.evaluatedAt
      scope = result.scope
    } else if (
      result.evaluatedAt !== evaluatedAt ||
      JSON.stringify(result.scope) !== JSON.stringify(scope)
    ) {
      throw new Error('Review lifecycle report window changed during collection')
    }

    pages += 1
    scanned += result.scanned
    lifecycle.eligible += result.lifecycle.eligible
    lifecycle.expired += result.lifecycle.expired
    lifecycle.tombstone += result.lifecycle.tombstone
    lifecycle.unverifiable += result.lifecycle.unverifiable

    if (shadow != null) {
      if (result.shadow == null) {
        throw new Error('Review lifecycle shadow report omitted comparison evidence')
      }
      shadow.matched += result.shadow.matched
      shadow.drifted += result.shadow.drifted
      for (const [finding, count] of Object.entries(result.shadow.findingCounts)) {
        const key = finding as ReviewSourceContentShadowFinding
        shadow.findingCounts[key] = (shadow.findingCounts[key] ?? 0) + (count ?? 0)
      }
    }

    checkpoint = result.nextCheckpoint ?? undefined
    if (checkpoint != null) {
      const nextCursor = cursorKey(checkpoint)
      if (nextCursor === priorCursor) {
        throw new Error('Review lifecycle report checkpoint did not advance')
      }
      priorCursor = nextCursor
    }
  } while (checkpoint != null)

  if (evaluatedAt == null || scope == null) {
    throw new Error('Review lifecycle report produced no window')
  }

  return {
    mode: input.mode,
    scope,
    evaluatedAt,
    pages,
    scanned,
    lifecycle,
    shadow,
  }
}
