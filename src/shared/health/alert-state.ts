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
// Keys and values are content-free (alert names only — no tenant data).

/** State key prefix (process-global, not tenant-scoped). */
export const ALERT_STATE_KEY_PREFIX = 'ops:alert:firing:' as const

/** Re-notify interval for a continuously-firing alert. */
export const ALERT_STATE_TTL_SECONDS = 24 * 60 * 60

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
}>

export function createRedisAlertStateStore(redis: AlertStateRedisPort): AlertStateStore {
  const keyFor = (name: string) => `${ALERT_STATE_KEY_PREFIX}${name}`
  return {
    currentlyFiring: async (names) => {
      const firing = new Set<string>()
      await Promise.all(
        names.map(async (name) => {
          if ((await redis.get(keyFor(name))) !== null) firing.add(name)
        }),
      )
      return firing
    },
    markFiring: async (name) => {
      await redis.set(keyFor(name), 'firing', 'EX', ALERT_STATE_TTL_SECONDS)
    },
    clearFiring: async (name) => {
      await redis.del(keyFor(name))
    },
  }
}
