import type { Database } from './index'

/**
 * Runs `run` on a connection that holds a session advisory lock on `key`.
 * The lock is a try-lock: when another session holds it, nothing queues and
 * `onBusy` decides the result (return a value, or throw). No transaction
 * stays open around `run`. A connection whose unlock fails or reports the lock
 * as not held is destroyed instead of returned to the pool.
 */
export async function withSessionAdvisoryLock<T, B>(
  db: Database,
  key: string,
  run: () => Promise<T>,
  onBusy: () => B,
): Promise<T | B> {
  const client = await db.$client.connect()
  let acquired = false
  let destroy = false
  try {
    const result = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [key],
    )
    acquired = result.rows[0]?.acquired === true
    if (!acquired) return onBusy()
    return await run()
  } finally {
    if (acquired) {
      try {
        const result = await client.query<{ released: boolean }>(
          'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released',
          [key],
        )
        destroy = result.rows[0]?.released !== true
      } catch {
        destroy = true
      }
    }
    client.release(destroy)
  }
}
