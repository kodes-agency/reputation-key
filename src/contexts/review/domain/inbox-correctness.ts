// BETA-1 B1.9: Inbox pagination and command correctness.
//
// Cursor pagination with indexed sorts, max page size, stable tie-breaker.
// Optimistic concurrency for note/status/assignment commands.
// Review state machine separating local draft from provider-published state.

// ── Cursor pagination ──────────────────────────────────────────────

export const MAX_INBOX_PAGE_SIZE = 100
export const DEFAULT_INBOX_PAGE_SIZE = 25

/**
 * Inbox cursor encodes the sort position for resuming pagination.
 * Format: base64(JSON({ field, value, id }))
 *
 * The cursor includes a tie-breaker ID to ensure stable ordering
 * when multiple rows share the same sort value.
 */
export type InboxCursor = Readonly<{
  /** The sort field value at the cursor position. */
  sortValue: string
  /** The review ID at the cursor position (tie-breaker). */
  reviewId: string
}>

/**
 * Encode a cursor to a base64 string for the client.
 */
export function encodeCursor(cursor: InboxCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

/**
 * Decode a client-provided cursor string.
 * Returns null if the cursor is malformed.
 */
export function decodeCursor(encoded: string | null): InboxCursor | null {
  if (!encoded) return null
  try {
    const decoded = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    ) as Partial<InboxCursor>
    if (typeof decoded.sortValue !== 'string' || typeof decoded.reviewId !== 'string') {
      return null
    }
    return { sortValue: decoded.sortValue, reviewId: decoded.reviewId }
  } catch {
    return null
  }
}

/**
 * Clamp the requested page size to the allowed range.
 */
export function clampPageSize(requested: number | undefined): number {
  if (!requested || requested < 1) return DEFAULT_INBOX_PAGE_SIZE
  return Math.min(requested, MAX_INBOX_PAGE_SIZE)
}

// ── Optimistic concurrency ─────────────────────────────────────────

/**
 * Expected version for optimistic concurrency control.
 * When a manager edits a note/status while another manager is also editing,
 * the second update receives a conflict instead of overwriting.
 */
export type ExpectedVersion = number

export type ConcurrencyConflict = {
  code: 'version_conflict'
  expected: ExpectedVersion
  actual: ExpectedVersion
}

/**
 * Check if an update should proceed based on expected version.
 */
export function checkVersionConflict(
  expected: ExpectedVersion,
  actual: ExpectedVersion,
): ConcurrencyConflict | null {
  if (expected !== actual) {
    return { code: 'version_conflict', expected, actual }
  }
  return null
}

// ── Review state machine ───────────────────────────────────────────

/**
 * Review state machine — separates local triage state from
 * provider-published reply state.
 *
 * The review's own lifecycle tracks whether it's been triaged.
 * The reply's publication state (B1.10) is tracked separately.
 */
export type ReviewTriageState = 'new' | 'open' | 'in_progress' | 'resolved' | 'ignored'

export const VALID_TRIAGE_TRANSITIONS: Readonly<
  Record<ReviewTriageState, readonly ReviewTriageState[]>
> = {
  new: ['open', 'ignored'],
  open: ['in_progress', 'resolved', 'ignored'],
  in_progress: ['open', 'resolved', 'ignored'],
  resolved: ['open'], // reopen
  ignored: ['open'], // un-ignore
}

export function isValidTriageTransition(
  from: ReviewTriageState,
  to: ReviewTriageState,
): boolean {
  return VALID_TRIAGE_TRANSITIONS[from]?.includes(to) ?? false
}
