// Take every pool client a unit of work needs before it takes a lock.
//
// A transaction that holds a row lock and then asks the pool for a second
// client can starve the process: once the pool is empty, every other client
// may belong to a transaction queued on that same lock. Nothing is released
// until those waiters hit `lock_timeout`, so they fail and the holder stalls
// for as long. That is how a 244-review import failed on the closed beta
// (2026-09-29): the Inbox projection held the Property fence while it waited
// for the client its own transaction needed.
//
// `withReservedPoolClients` checks the clients out first, while the unit holds
// no lock, and lends them to the unit's own checkouts (`db.transaction`, and
// `pool.query` for a plain read). A lent client the unit releases goes back to
// the reservation, not the pool, so a plain read before a transaction cannot
// give the transaction's client away. Checkouts beyond the reservation, and
// every checkout from other work, go to the pool as usual. Reservations are
// acquired one at a time per pool, so two half-acquired reservations can never
// wait on each other for the last client.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Pool, PoolClient } from 'pg'

type Reservation = {
  readonly pool: Pool
  /** Reserved clients not lent out right now. */
  readonly clients: PoolClient[]
  /** Until the unit settles, a released client returns here. */
  open: boolean
}

type ReservationRuntime = Readonly<{
  scope: AsyncLocalStorage<Reservation>
  /** Tail of each pool's reservation queue. */
  turns: WeakMap<Pool, Promise<void>>
}>

type Checkout = (...args: unknown[]) => unknown

// Process-wide, like the pool itself (see pool.ts): the production build can
// load this module twice, and both copies must share one scope and one queue.
const RUNTIME_KEY = Symbol.for('repkey.shared.db.pool-client-reservation')
const INSTALLED_KEY = Symbol.for('repkey.shared.db.pool-client-reservation.installed')

function runtime(): ReservationRuntime {
  const store = globalThis as { [RUNTIME_KEY]?: ReservationRuntime }
  store[RUNTIME_KEY] ??= Object.freeze({
    scope: new AsyncLocalStorage<Reservation>(),
    turns: new WeakMap<Pool, Promise<void>>(),
  })
  return store[RUNTIME_KEY]
}

/** Drizzle's own test for a pool (node-postgres session). */
function asPool(client: unknown): Pool | null {
  if (typeof client !== 'object' || client === null) return null
  const name = (Object.getPrototypeOf(client) as { constructor?: { name?: unknown } })
    .constructor?.name
  return typeof name === 'string' && name.includes('Pool') ? (client as Pool) : null
}

/**
 * Serve a checkout from the current reservation of this pool, if any. Both of
 * pg's shapes: `connect()` (Drizzle transactions) and `connect(callback)`
 * (`pool.query`, which Drizzle uses outside a transaction).
 */
function serveReservedCheckouts(pool: Pool, scope: AsyncLocalStorage<Reservation>): void {
  const marked = pool as Pool & { [INSTALLED_KEY]?: true }
  if (marked[INSTALLED_KEY]) return
  const checkout = pool.connect.bind(pool) as Checkout
  const reservedCheckout: Checkout = (...args) => {
    const reservation = scope.getStore()
    const reserved = reservation?.pool === pool ? reservation.clients.shift() : undefined
    if (reservation === undefined || reserved === undefined) return checkout(...args)
    const client = lend(reservation, reserved)
    const callback = args[0]
    if (typeof callback !== 'function') return Promise.resolve(client)
    queueMicrotask(() =>
      callback(undefined, client, (error?: Error | boolean) => client.release(error)),
    )
    return undefined
  }
  pool.connect = reservedCheckout as Pool['connect']
  marked[INSTALLED_KEY] = true
}

/**
 * pg-pool gives every checkout its own one-shot `release`. While the unit
 * runs, a release puts the client back in the reservation; one with an error,
 * or after the unit settled, goes to the pool (which discards a broken one).
 */
function lend(reservation: Reservation, client: PoolClient): PoolClient {
  const release = client.release
  client.release = (error?: Error | boolean) => {
    client.release = release
    if (error || !reservation.open) {
      release.call(client, error)
      return
    }
    reservation.clients.push(client)
  }
  return client
}

async function acquireInTurn(
  { scope, turns }: ReservationRuntime,
  pool: Pool,
  count: number,
): Promise<PoolClient[]> {
  const previous = turns.get(pool) ?? Promise.resolve()
  let finish!: () => void
  const turn = new Promise<void>((resolve) => {
    finish = resolve
  })
  turns.set(
    pool,
    previous.then(() => turn),
  )
  await previous
  const clients: PoolClient[] = []
  try {
    while (clients.length < count) {
      // Outside any enclosing reservation: these come from the pool itself.
      clients.push(await scope.exit(() => pool.connect()))
    }
    return clients
  } catch (error) {
    for (const client of clients) client.release()
    throw error
  } finally {
    finish()
  }
}

/**
 * Run `work` with `count` clients of `db`'s pool already checked out for it.
 * The reservation is released when `work` settles; a client still lent then
 * goes to the pool when its user releases it. A database bound
 * to a single client (a test transaction) cannot starve, so `work` runs as is.
 */
export async function withReservedPoolClients<T>(
  db: Readonly<{ $client: Pool }>,
  count: number,
  work: () => Promise<T>,
): Promise<T> {
  const pool = asPool(db.$client)
  if (pool === null || count < 1) return work()
  const reservations = runtime()
  serveReservedCheckouts(pool, reservations.scope)
  const reservation: Reservation = {
    pool,
    clients: await acquireInTurn(reservations, pool, count),
    open: true,
  }
  try {
    return await reservations.scope.run(reservation, work)
  } finally {
    reservation.open = false
    for (const client of reservation.clients.splice(0)) client.release()
  }
}
