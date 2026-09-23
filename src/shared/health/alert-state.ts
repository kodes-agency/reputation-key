// BQC-7.4 — alert firing-state store (evaluation hysteresis).
//
// One Redis key per firing alert (`ops:alert:firing:<name>`) holding the
// literal 'firing' with a 24h TTL:
//
//   - ok→firing edge: the health-check job dispatches, then markFiring —
//     the TTL counts from the FIRST dispatch (the key is not refreshed
//     while the alert keeps firing);
//   - still firing: currentlyFiring reports it, no re-dispatch;
//   - firing > 24h: Redis expires the key → the next evaluation sees a new
//     edge → re-notify (a continuously-firing alert re-pages once a day);
//   - recovery: the alert evaluates quiet → clearFiring → the NEXT breach
//     is a fresh edge and dispatches immediately.
//
// A sustained alert (one that pages only on its second consecutive breaching
// evaluation) first holds a pending key (`ops:alert:pending:<name>`) whose
// short TTL spans one evaluation gap: the next breach confirms it, a quiet
// evaluation clears it, a missed evaluation lets it expire.
//
// Keys and values are content-free (alert names only — no tenant data).

/** State key prefix (process-global, not tenant-scoped). */
export const ALERT_STATE_KEY_PREFIX = 'ops:alert:firing:' as const

/** Re-notify interval for a continuously-firing alert. */
export const ALERT_STATE_TTL_SECONDS = 24 * 60 * 60

/** Pending (first-breach) key prefix for sustained alerts. */
export const ALERT_PENDING_KEY_PREFIX = 'ops:alert:pending:' as const

/**
 * How long a first breach waits for its confirmation: two 5-minute evaluation
 * cadences, so the next evaluation always lands inside it and one missed
 * evaluation breaks the streak.
 */
export const ALERT_PENDING_TTL_SECONDS = 10 * 60

export type AlertStateRedisPort = Readonly<{
  get: (key: string) => Promise<string | null>
  set: (key: string, value: string, mode: 'EX', seconds: number) => Promise<unknown>
  del: (key: string) => Promise<unknown>
}>

export type AlertStateStore = Readonly<{
  /** The subset of `names` currently holding firing state. */
  currentlyFiring: (names: readonly string[]) => Promise<ReadonlySet<string>>
  /** Set the firing state with the 24h re-notify TTL (edge only). */
  markFiring: (name: string) => Promise<void>
  /** Clear the firing state (recovery). */
  clearFiring: (name: string) => Promise<void>
  /** The subset of `names` holding an unconfirmed first breach. */
  currentlyPending: (names: readonly string[]) => Promise<ReadonlySet<string>>
  /** Record a sustained alert's first breach (short TTL). */
  markPending: (name: string) => Promise<void>
  /** Drop a first breach (confirmed into firing, or recovered). */
  clearPending: (name: string) => Promise<void>
}>

export function createRedisAlertStateStore(redis: AlertStateRedisPort): AlertStateStore {
  const keyFor = (name: string) => `${ALERT_STATE_KEY_PREFIX}${name}`
  const pendingKeyFor = (name: string) => `${ALERT_PENDING_KEY_PREFIX}${name}`
  const holding = async (names: readonly string[], key: (name: string) => string) => {
    const held = new Set<string>()
    await Promise.all(
      names.map(async (name) => {
        if ((await redis.get(key(name))) !== null) held.add(name)
      }),
    )
    return held
  }
  return {
    currentlyFiring: (names) => holding(names, keyFor),
    markFiring: async (name) => {
      await redis.set(keyFor(name), 'firing', 'EX', ALERT_STATE_TTL_SECONDS)
    },
    clearFiring: async (name) => {
      await redis.del(keyFor(name))
    },
    currentlyPending: (names) => holding(names, pendingKeyFor),
    markPending: async (name) => {
      await redis.set(pendingKeyFor(name), 'pending', 'EX', ALERT_PENDING_TTL_SECONDS)
    },
    clearPending: async (name) => {
      await redis.del(pendingKeyFor(name))
    },
  }
}
