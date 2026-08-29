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

type LifecycleTotals = {
  eligible: number
  expired: number
  tombstone: number
  unverifiable: number
}
type ShadowTotals = {
  matched: number
  drifted: number
  findingCounts: Partial<Record<ReviewSourceContentShadowFinding, number>>
}
type LifecyclePage = Awaited<ReturnType<RunReviewSourceContentLifecycle>>

function accumulateLifecycle(totals: LifecycleTotals, page: LifecyclePage['lifecycle']) {
  totals.eligible += page.eligible
  totals.expired += page.expired
  totals.tombstone += page.tombstone
  totals.unverifiable += page.unverifiable
}

/** Fold one page's shadow comparison into the running aggregate. Only the
 * counts survive — the per-page Review identifiers are deliberately dropped so
 * a full-dataset inspection stays memory bounded. */
function accumulateShadow(totals: ShadowTotals, page: LifecyclePage['shadow']): void {
  if (page == null) {
    throw new Error('Review lifecycle shadow report omitted comparison evidence')
  }
  totals.matched += page.matched
  totals.drifted += page.drifted
  for (const [finding, count] of Object.entries(page.findingCounts)) {
    const key = finding as ReviewSourceContentShadowFinding
    totals.findingCounts[key] = (totals.findingCounts[key] ?? 0) + (count ?? 0)
  }
}

/** A continuation that repeats the previous cursor would drain forever, so it
 * is refused rather than followed. Returns the cursor to compare next against. */
function advanceCursor(
  checkpoint: ReviewSourceContentLifecycleCheckpoint | undefined,
  priorCursor: string | null,
): string | null {
  if (checkpoint == null) return priorCursor
  const nextCursor = cursorKey(checkpoint)
  if (nextCursor === priorCursor) {
    throw new Error('Review lifecycle report checkpoint did not advance')
  }
  return nextCursor
}

/** Every page must describe the same frozen window; otherwise the report would
 * silently mix two datasets. */
const sameWindow = (
  page: LifecyclePage,
  evaluatedAt: string,
  scope: ReviewSourceContentLifecycleScope | null,
): boolean =>
  page.evaluatedAt === evaluatedAt && JSON.stringify(page.scope) === JSON.stringify(scope)

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
    } else if (!sameWindow(result, evaluatedAt, scope)) {
      throw new Error('Review lifecycle report window changed during collection')
    }

    pages += 1
    scanned += result.scanned
    accumulateLifecycle(lifecycle, result.lifecycle)
    if (shadow != null) accumulateShadow(shadow, result.shadow)

    checkpoint = result.nextCheckpoint ?? undefined
    priorCursor = advanceCursor(checkpoint, priorCursor)
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
