import { GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS } from './ports/google-import-v2-store.port'

/**
 * Whether an attempt may claim an import item whose highest claimed attempt of
 * this retry revision is `lastAttempt`: the next attempt, or the last one
 * again, within the attempt budget.
 *
 * BullMQ re-runs a stalled job with the same `attemptsMade`, so the attempt
 * that returns after a worker died carries the dead attempt's ordinal. It must
 * be able to take the row whether the dead claim is still on it (expired) or
 * the claim-lease reaper has already released it to `pending`: refused, it
 * would complete as a no-op and leave the item pending with no job. Every
 * effect is fenced by the claim's own fence, so the dead attempt owns nothing
 * once the row is claimed again. A row nobody has claimed yet (`lastAttempt`
 * 0) admits only attempt 1.
 */
export function importItemAdmitsAttempt(
  lastAttempt: number,
  attemptOrdinal: number,
): boolean {
  if (attemptOrdinal > GOOGLE_IMPORT_ITEM_MAX_ATTEMPTS) return false
  return (
    attemptOrdinal === lastAttempt + 1 ||
    (lastAttempt > 0 && attemptOrdinal === lastAttempt)
  )
}
