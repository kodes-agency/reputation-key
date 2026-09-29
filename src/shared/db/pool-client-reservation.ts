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
import { getLogger } from '#/shared/observability/logger'

type Release = (error?: Error | boolean) => void

/** A reserved client between loans. */
type Parked = Readonly<{
  client: PoolClient
  /** pg-pool's one-shot release for this checkout. */
  release: Release
  /** Evicts the client if its connection drops while it waits. */
  onError: (error: Error) => void
}>

type Reservation = {
  readonly pool: Pool
  readonly parked: Parked[]
  /** Until the unit settles, a released client returns to `parked`. */
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

/** pg-pool's own message, so a double release reads the same with or without a reservation. */
const ALREADY_RELEASED =
  'Release called on client which has already been released to the pool.'

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

function alreadyReleased(): never {
  throw new Error(ALREADY_RELEASED)
}

/** The check pg-pool makes before it pools a released client again. */
function isUsable(client: PoolClient): boolean {
  const state = client as PoolClient & { _queryable?: boolean; _ending?: boolean }
  return state._queryable !== false && state._ending !== true
}

/**
 * Give a client back to pg-pool, which discards it after an error or a dead
 * connection. Never throws: a failed release is logged, so cleanup releases
 * every other client and never masks the unit's own outcome.
 */
function returnToPool(
  client: PoolClient,
  release: Release,
  error?: Error | boolean,
): void {
  client.release = release
  try {
    release(error)
  } catch (failure) {
    getLogger().error(
      { error: failure instanceof Error ? failure.message : String(failure) },
      '[db] reserved pool client could not be released',
    )
  }
}

/**
 * Hold a client in the reservation until the unit's next checkout. pg emits
 * `error` on a client whose server went away, and pg-pool listens only while
 * the client sits in the pool, so the reservation listens instead: an unheard
 * `error` is an uncaught exception. A dropped client is evicted, never lent.
 */
function park(reservation: Reservation, client: PoolClient, release: Release): void {
  const parked: Parked = {
    client,
    release,
    onError: (error) => {
      const index = reservation.parked.indexOf(parked)
      if (index === -1) return
      reservation.parked.splice(index, 1)
      client.removeListener('error', parked.onError)
      getLogger().warn(
        { error: error.message },
        '[db] reserved pool client lost its connection',
      )
      returnToPool(client, release, error)
    },
  }
  client.on('error', parked.onError)
  client.release = alreadyReleased
  reservation.parked.push(parked)
}

/**
 * Lend a parked client to one checkout of the unit. Its release parks it again
 * while the unit runs. A release with an error, of an unusable connection, or
 * after the unit settled goes to pg-pool instead; so does `pool.query`'s
 * release after a failed read, which leaves the unit's later checkouts to the
 * pool on that failing path. A second release throws, as pg-pool's does.
 */
function lend(reservation: Reservation, parked: Parked): PoolClient {
  const { client, release } = parked
  client.removeListener('error', parked.onError)
  let returned = false
  client.release = (error?: Error | boolean) => {
    if (returned) alreadyReleased()
    returned = true
    if (reservation.open && !error && isUsable(client)) park(reservation, client, release)
    else returnToPool(client, release, error)
  }
  return client
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
    const parked = reservation?.pool === pool ? reservation.parked.shift() : undefined
    if (reservation === undefined || parked === undefined) return checkout(...args)
    const client = lend(reservation, parked)
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
    for (const client of clients) returnToPool(client, client.release)
    throw error
  } finally {
    finish()
  }
}

/**
 * Run `work` with `count` clients of `db`'s pool already checked out for it.
 * The reservation is released when `work` settles; a client still lent then
 * goes to the pool when its user releases it. A database bound to a single
 * client (a test transaction) cannot starve, so `work` runs as is.
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
  const reservation: Reservation = { pool, parked: [], open: true }
  for (const client of await acquireInTurn(reservations, pool, count)) {
    park(reservation, client, client.release)
  }
  try {
    return await reservations.scope.run(reservation, work)
  } finally {
    reservation.open = false
    for (const parked of reservation.parked.splice(0)) {
      parked.client.removeListener('error', parked.onError)
      returnToPool(parked.client, parked.release)
    }
  }
}
