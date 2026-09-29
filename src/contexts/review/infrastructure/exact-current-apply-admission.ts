import type { Database } from '#/shared/db'
import { POOL_MAX_CONNECTIONS } from '#/shared/db/pool'
import { withReservedPoolClients } from '#/shared/db/pool-client-reservation'

/**
 * Review exact-current callbacks hold one Review transaction while opening a
 * consumer-owned transaction. Reply-observation and source-transition
 * authorities must share one process-wide budget: independent budgets could
 * collectively consume the pool while every outer transaction waits for a
 * second client.
 *
 * Both clients are checked out before the Review transaction takes its fence
 * (the Property row or the Reply-truth lock). Holding the fence while waiting
 * for the consumer's client let an exhausted pool stall every transaction
 * queued on that fence until `lock_timeout` (closed beta, 2026-09-29).
 */
export const REVIEW_EXACT_CURRENT_APPLY_CLIENTS = 2
const REVIEW_EXACT_CURRENT_POOL_HEADROOM = 2
export const REVIEW_EXACT_CURRENT_MAX_CONCURRENT_APPLIES = Math.max(
  1,
  Math.floor(
    (POOL_MAX_CONNECTIONS - REVIEW_EXACT_CURRENT_POOL_HEADROOM) /
      REVIEW_EXACT_CURRENT_APPLY_CLIENTS,
  ),
)

type ApplyAdmission = Readonly<{
  run<T>(apply: () => Promise<T>): Promise<T>
}>

const REVIEW_EXACT_CURRENT_APPLY_ADMISSION_KEY = Symbol.for(
  'repkey.review.exact-current-apply-admission',
)

const createBoundedApplyAdmission = (limit: number): ApplyAdmission => {
  let active = 0
  const waiters: Array<() => void> = []
  const acquire = (): Promise<void> => {
    if (active < limit) {
      active += 1
      return Promise.resolve()
    }
    return new Promise<void>((resolve) => {
      waiters.push(() => {
        active += 1
        resolve()
      })
    })
  }
  const release = (): void => {
    active -= 1
    waiters.shift()?.()
  }
  return {
    run: async <T>(apply: () => Promise<T>): Promise<T> => {
      await acquire()
      try {
        return await apply()
      } finally {
        release()
      }
    },
  }
}

const getReviewExactCurrentApplyAdmission = (): ApplyAdmission => {
  // Process-lifetime, matching the process-owned pool. Symbol.for plus
  // globalThis also makes duplicate module instances share the same budget.
  const processStore = globalThis as unknown as {
    [key: symbol]: ApplyAdmission | undefined
  }
  const existing = processStore[REVIEW_EXACT_CURRENT_APPLY_ADMISSION_KEY]
  if (existing) return existing
  const created = createBoundedApplyAdmission(REVIEW_EXACT_CURRENT_MAX_CONCURRENT_APPLIES)
  processStore[REVIEW_EXACT_CURRENT_APPLY_ADMISSION_KEY] = created
  return created
}

/**
 * Admit one exact-current apply, then reserve both of its pool clients before
 * `apply` opens the Review transaction on `db`.
 */
export const runWithReviewExactCurrentApplyAdmission = <T>(
  db: Pick<Database, '$client'>,
  apply: () => Promise<T>,
): Promise<T> =>
  getReviewExactCurrentApplyAdmission().run(() =>
    withReservedPoolClients(db, REVIEW_EXACT_CURRENT_APPLY_CLIENTS, apply),
  )
