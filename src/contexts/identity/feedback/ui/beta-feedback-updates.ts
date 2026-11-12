// Which of a reporter's reports reached an outcome they have not seen yet.
//
// Why not the notification bell: every non-mandatory notification is
// Property-scoped, and the database enforces it
// (`notifications_mandatory_scope_check`). A beta report belongs to no Property,
// and the only Organization-scoped category is `mandatory`, which forces an
// immediate email that cannot be turned off — wrong for "your report was dealt
// with". So the reporter is told where they already look: the Feedback entry
// point and their own report list.
//
// "Seen" is a per-viewer convenience kept in this browser. Losing it can only
// make a marker reappear once; it can never hide an outcome, and nothing
// server-side depends on it.

import type { MyBetaFeedbackItem } from './beta-feedback-form-context'

/** Outcomes a reporter would want to hear about; intermediate states are not. */
const OUTCOME_STATES: ReadonlySet<MyBetaFeedbackItem['triageState']> = new Set([
  'accepted',
  'declined',
  'resolved',
])

export type SeenOutcomes = Readonly<Record<string, MyBetaFeedbackItem['triageState']>>

const STORAGE_KEY = 'repkey:beta-feedback:seen-outcomes:v1'
const REFERENCE = /^[0-9a-f-]{36}$/u
const STATES: ReadonlySet<string> = new Set([
  'new',
  'screened',
  'reproducing',
  'accepted',
  'declined',
  'resolved',
])

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

/** Tolerates absent storage, blocked storage and anything malformed in it. */
export function readSeenOutcomes(storage: StorageLike | undefined): SeenOutcomes {
  if (!storage) return {}
  try {
    const parsed: unknown = JSON.parse(storage.getItem(STORAGE_KEY) ?? '{}')
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {}
    const seen: Record<string, MyBetaFeedbackItem['triageState']> = {}
    for (const [reference, state] of Object.entries(parsed)) {
      // Only well-formed entries survive, so a hand-edited or stale value
      // cannot suppress a marker it has no business suppressing.
      if (REFERENCE.test(reference) && typeof state === 'string' && STATES.has(state)) {
        seen[reference] = state as MyBetaFeedbackItem['triageState']
      }
    }
    return seen
  } catch {
    return {}
  }
}

export function writeSeenOutcomes(
  storage: StorageLike | undefined,
  seen: SeenOutcomes,
): void {
  if (!storage) return
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(seen))
  } catch {
    // Private mode or a full quota: the marker may reappear, nothing breaks.
  }
}

/** Reports whose current outcome this viewer has not looked at yet. */
export function unseenOutcomes(
  items: ReadonlyArray<MyBetaFeedbackItem>,
  seen: SeenOutcomes,
): ReadonlyArray<MyBetaFeedbackItem> {
  return items.filter(
    (item) =>
      item.deliveryState === 'delivered' &&
      OUTCOME_STATES.has(item.triageState) &&
      seen[item.reference] !== item.triageState,
  )
}

/**
 * Record the reports on screen as seen. Only references still listed are
 * kept, so the stored map cannot grow without bound across months of reports.
 */
export function markSeen(items: ReadonlyArray<MyBetaFeedbackItem>): SeenOutcomes {
  const seen: Record<string, MyBetaFeedbackItem['triageState']> = {}
  for (const item of items) seen[item.reference] = item.triageState
  return seen
}

/** The same browser storage every caller agrees on, or undefined off-browser. */
export function browserStorage(): StorageLike | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

/** "1 report updated" / "3 reports updated", for the entry point's label. */
export function updatesLabel(count: number): string {
  return count === 1 ? '1 report updated' : `${count} reports updated`
}
