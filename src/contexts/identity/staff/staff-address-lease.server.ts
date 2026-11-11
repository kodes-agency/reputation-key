import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db/index'
import { staffAccountError } from '../domain/staff-account'

type Executor = Pick<Database, 'execute'>
export type StaffAddressLease = Readonly<{ holder: string; size: number }>

const LEASE_MS = 60_000
const RENEW_MS = 20_000
const WAIT_MS = 30_000
const RETRY_MS = 100

/** The same key manager invitations lock, so both serialize on one address. */
const addressKeys = (emails: readonly string[]) =>
  [...new Set(emails)].sort().map((email) => `beta-invitation-email:${email}`)

/**
 * Transaction-scoped address locks, in a stable order. Every invitation write
 * for an address, staff or manager, takes them before reading the address.
 */
export async function lockStaffAddresses(
  tx: Executor,
  emails: readonly string[],
): Promise<void> {
  for (const key of addressKeys(emails))
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`)
}

/** Refuse a write whose command lost its lease; blocks a takeover until commit. */
export async function assertStaffAddressLease(
  tx: Executor,
  lease: StaffAddressLease,
  now: Date,
): Promise<void> {
  const held = await tx.execute(
    sql`SELECT address_key FROM staff_address_leases WHERE holder = ${lease.holder}::uuid AND expires_at > ${now} FOR SHARE`,
  )
  if (held.rows.length < lease.size)
    throw staffAccountError(
      'operation_conflict',
      'This staff change took too long. Refresh Staff and try again',
    )
}

/**
 * Hold the addresses for one staff command without holding a connection.
 * A command waits for another holder to finish, and takes over a lease whose
 * holder stopped renewing it.
 */
export async function holdStaffAddresses<T>(
  db: Pick<Database, 'execute' | 'transaction'>,
  clock: () => Date,
  idGen: () => string,
  emails: readonly string[],
  run: (lease: StaffAddressLease) => Promise<T>,
): Promise<T> {
  const lease = await claim(db, clock, idGen, emails)
  const renewal = setInterval(() => {
    // A failed renewal is caught by the lease check before the next write.
    void renew(db, clock, lease).catch(() => undefined)
  }, RENEW_MS)
  renewal.unref()
  try {
    return await run(lease)
  } finally {
    clearInterval(renewal)
    await db.execute(
      sql`DELETE FROM staff_address_leases WHERE holder = ${lease.holder}::uuid`,
    )
  }
}

async function claim(
  db: Pick<Database, 'transaction'>,
  clock: () => Date,
  idGen: () => string,
  emails: readonly string[],
): Promise<StaffAddressLease> {
  const keys = addressKeys(emails)
  const deadline = performance.now() + WAIT_MS
  for (;;) {
    const holder = idGen()
    const size = await db
      .transaction(async (tx) => {
        await lockStaffAddresses(tx, emails)
        const values = sql.join(
          keys.map((key) => sql`(hashtextextended(${key}::text, 0))`),
          sql`, `,
        )
        const wanted = await tx.execute(
          sql`SELECT count(DISTINCT k) AS n FROM (VALUES ${values}) AS t(k)`,
        )
        const claimed = await tx.execute(sql`
          INSERT INTO staff_address_leases (address_key, holder, expires_at)
          SELECT DISTINCT k, ${holder}::uuid, ${expiry(clock)}::timestamptz FROM (VALUES ${values}) AS t(k)
          ON CONFLICT (address_key) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
          WHERE staff_address_leases.expires_at <= ${clock()}
          RETURNING address_key`)
        const size = Number(wanted.rows[0]?.n)
        // All or nothing: a partial claim would hold one address while waiting for another.
        if (claimed.rows.length < size) throw new AddressHeld()
        return size
      })
      .catch((error: unknown) => {
        if (error instanceof AddressHeld) return null
        throw error
      })
    if (size !== null) return { holder, size }
    if (performance.now() >= deadline)
      throw staffAccountError(
        'rate_limited',
        'Staff changes are busy. Please try again shortly',
      )
    await new Promise((resolve) => setTimeout(resolve, RETRY_MS))
  }
}

async function renew(
  db: Pick<Database, 'execute'>,
  clock: () => Date,
  lease: StaffAddressLease,
): Promise<void> {
  await db.execute(
    sql`UPDATE staff_address_leases SET expires_at = ${expiry(clock)} WHERE holder = ${lease.holder}::uuid`,
  )
}

const expiry = (clock: () => Date) => new Date(clock().getTime() + LEASE_MS)

class AddressHeld extends Error {}
