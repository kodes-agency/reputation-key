import type { GoogleReviewApiError } from '#/contexts/review/application/public-api'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  cursorFailureCode,
  isGoogleReviewApiError,
  reviewApiError,
} from './google-review-api-errors'
import type {
  GoogleReviewCursorStore,
  GoogleReviewCursorUse,
} from '../google-review-cursor-store'

// How the review API adapter spends a review sync page cursor and reports the
// cursor store's refusals. Kept apart from the adapter so the redemption rule
// (take one before the call, give it back only when the call never reached
// Google) reads, and is tested, in one place.

// Cursor-store rejections are the one failure class that used to leave no
// trace: every store code is mapped through `cursorFailureCode` and the sync
// use case collapses the result again into a single `cursor_failure`. A
// closed-beta run applied 6 pages / 256 reviews and then died with that code
// and nothing else on record. Callers therefore report the raw store outcome
// before the mapped error is thrown.
export type CursorRejectionOperation =
  'redeem' | 'release' | 'publish_next' | 'discard_run' | 'discard_cursors'

export type CursorDiagnostic = Readonly<{
  phase: 'main' | 'confirmation'
  pageIndex: number
  runId: string
}>

export type CursorRejection = Readonly<{
  operation: CursorRejectionOperation
  code: string
  phase: 'main' | 'confirmation' | null
  pageIndex: number | null
  runId: string
  /** Publication only: which `binding_mismatch` branch the store took. */
  parentCursorRefPresent?: boolean
  nextPageIndex?: number
}>

/**
 * Stable, bounded, content-free: identifiers and codes only. Never the page
 * token, never the cursor ref, never review content — a diagnostic that leaks
 * the opaque-reference indirection is worse than no diagnostic. `code` is the
 * raw store outcome, not `cursorFailureCode`'s mapping, because `conflict` and
 * `unavailable` both collapse onto `provider_unavailable`.
 */
export function cursorRejectionLogger(
  logger: LoggerPort,
): (entry: CursorRejection) => void {
  return (entry) =>
    logger.warn(
      { event: 'reviews_cursor_rejected', ...entry },
      'Google reviews cursor store rejected the call',
    )
}

/** A store that throws is an outage of the store, reported and retried as one. */
export async function callCursorStore<T>(
  call: () => Promise<T>,
  onFault: () => void,
): Promise<T> {
  try {
    return await call()
  } catch {
    onFault()
    throw reviewApiError('provider_unavailable', true)
  }
}

/**
 * The provider plane's proof that `fetch` was never invoked for this call, so
 * Google never saw the page token. Absent or unrecognised evidence is not that
 * proof (see `GoogleProviderDispatch`).
 */
function neverReachedGoogle(error: unknown): boolean {
  return (
    isGoogleReviewApiError(error) &&
    (error as GoogleReviewApiError).failure?.dispatch === 'not_sent'
  )
}

/**
 * Runs one provider call under a page cursor, or without one for page 0. The
 * redemption is taken before the call because the gateway admits the exact
 * request, page token included, and it is given back when the call never
 * reached Google: a `quota_exhausted` wait used to spend one per refusal and
 * fail the run on its sixth (MAX_CURSOR_REDEMPTIONS in the store). A call
 * that reached Google, or may have, keeps its use.
 */
export function createPageCursorSpender(
  deps: Readonly<{
    cursorStore: Pick<GoogleReviewCursorStore, 'redeem' | 'release'>
    logRejection: (entry: CursorRejection) => void
  }>,
) {
  const redeem = async (
    use: GoogleReviewCursorUse,
    diagnostic: CursorDiagnostic,
  ): Promise<string> => {
    const redeemed = await callCursorStore(
      () => deps.cursorStore.redeem(use),
      () =>
        deps.logRejection({ operation: 'redeem', code: 'store_threw', ...diagnostic }),
    )
    if (!redeemed.ok) {
      deps.logRejection({ operation: 'redeem', code: redeemed.code, ...diagnostic })
      throw reviewApiError(
        cursorFailureCode(redeemed.code),
        redeemed.code === 'conflict' || redeemed.code === 'unavailable',
      )
    }
    return redeemed.value.pageToken
  }

  // Best effort, and never the caller's answer: the provider plane's own error
  // (its code and its wait) is what the snapshot run must act on. A release
  // that fails leaves the one use spent, which is what happened before release
  // existed, and the run keeps its remaining budget.
  const releaseUnsent = async (
    use: GoogleReviewCursorUse,
    diagnostic: CursorDiagnostic,
  ): Promise<void> => {
    let code: string
    try {
      const released = await deps.cursorStore.release(use)
      if (released.ok) return
      code = released.code
    } catch {
      code = 'store_threw'
    }
    deps.logRejection({ operation: 'release', code, ...diagnostic })
  }

  return async <T>(
    use: GoogleReviewCursorUse | null,
    diagnostic: CursorDiagnostic,
    call: (pageToken: string | undefined) => Promise<T>,
  ): Promise<T> => {
    const pageToken = use ? await redeem(use, diagnostic) : undefined
    try {
      return await call(pageToken)
    } catch (error) {
      if (use && neverReachedGoogle(error)) await releaseUnsent(use, diagnostic)
      throw error
    }
  }
}
