// Review context — start-time spread for the discovery sweep (pure).
//
// The discover-new-reviews sweep FIRES every 15 minutes and hands the queue
// every property that is due, all at the same instant. Every one of those
// snapshot runs reads Google's reviews.list within seconds of the others, and
// that route's quota is a per-minute bucket per Google credential
// (quota-coordinator.ts, `google-reviews-v1`): a connection with a couple of
// dozen properties drained it in the first minute of every sweep, and the
// runs that came after were refused.
//
// The fix is to give each sweep-initiated sync job a START DELAY, so the
// properties of one sweep begin over a window instead of together:
//
//   - the delay is a pure function of the property id (a stable hash), so a
//     property starts at the same offset into every sweep. Consecutive polls
//     of a property stay exactly one due-interval apart, which is what the
//     backoff ladder (discovery-backoff.ts) prices, and the delay needs no
//     state;
//   - the delay moves when a job STARTS, never when the property is next DUE.
//     review_sync_state.next_incremental_at is still written from the sweep
//     time, so a delayed start can never push a property past the next sweep;
//   - the window is strictly shorter than both the sweep cadence and the
//     property's base interval, so the job has always started before the
//     earliest instant a later sweep could enqueue the same property again:
//     a property is never waiting twice.
//
// Pure: no clock, no randomness, no I/O.

/**
 * How often the discover-new-reviews sweep fires. The schedule itself lives
 * in the job catalogue (`every:900000`, shared/governance/event-job-catalogue.ts),
 * which the domain does not import; the value is mirrored here and
 * discovery-spread.test.ts fails if the two ever differ.
 */
export const DISCOVERY_SWEEP_CADENCE_MS = 15 * 60 * 1000

/**
 * Width of the window a sweep's sync jobs are spread over: the sweep cadence
 * minus the sweep's own execution timeout (5 minutes in the job catalogue).
 * The delay is counted from the moment a job is enqueued, and a sweep may take
 * up to its timeout to reach its last property, so the last job of the slowest
 * possible sweep still starts before the next sweep can enqueue that property
 * again. Ten minutes is also wide enough that a connection with dozens of
 * properties averages a few starts a minute instead of all of them in one.
 * discovery-spread.test.ts fails if the three numbers stop adding up.
 *
 * Raising it is safe only while it stays under that sum; the handler clamps
 * whatever it is given to strictly below the cadence and the base interval
 * (see discoverySpreadWindowMs).
 */
export const DISCOVERY_SPREAD_WINDOW_MS = 10 * 60 * 1000

/**
 * The window actually used: the requested width, clamped to be STRICTLY
 * shorter than both the sweep cadence and the base interval. Offsets are
 * drawn from [0, window), so a window equal to the cap would already be safe;
 * the explicit minus one keeps the property obvious to the next reader.
 *
 * An operator who shortens REVIEW_DISCOVERY_INTERVAL_MINUTES gets a shorter
 * window rather than a job that could still be waiting when its property is
 * due again.
 */
export const discoverySpreadWindowMs = (
  baseIntervalMs: number,
  requestedMs: number = DISCOVERY_SPREAD_WINDOW_MS,
): number =>
  Math.max(0, Math.min(requestedMs, DISCOVERY_SWEEP_CADENCE_MS - 1, baseIntervalMs - 1))

const FNV_OFFSET_BASIS = 0x811c9dc5
const FNV_PRIME = 0x01000193

/** 32-bit FNV-1a: small, dependency-free, and uniform on uuid-shaped input. */
const fnv1a32 = (text: string): number => {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, FNV_PRIME)
  }
  return hash >>> 0
}

/**
 * Milliseconds this property's sweep job waits before it starts: a stable
 * offset in [0, windowMs). Zero when there is no window.
 */
export const discoverySpreadDelayMs = (propertyId: string, windowMs: number): number => {
  const width = Math.floor(windowMs)
  return width > 0 ? fnv1a32(propertyId) % width : 0
}
