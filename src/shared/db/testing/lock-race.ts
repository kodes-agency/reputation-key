import { getPool } from '#/shared/db/pool'

const LOCK_WAIT_DEADLINE_MS = 5_000
const LOCK_WAIT_POLL_MS = 10

/** Resolves once exactly one session with this application name is blocked on a lock. */
export async function waitForSessionLock(applicationName: string): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_DEADLINE_MS
  while (Date.now() < deadline) {
    const waiting = await getPool().query(
      `SELECT 1
       FROM pg_stat_activity
       WHERE application_name = $1
         AND wait_event_type = 'Lock'`,
      [applicationName],
    )
    if (waiting.rowCount === 1) return
    await new Promise((resolve) => setTimeout(resolve, LOCK_WAIT_POLL_MS))
  }
  throw new Error(`session ${applicationName} did not reach its lock wait`)
}

type GrantRevocationRace<T> = Readonly<{
  organizationId: string
  propertyId: string
  userId: string
  revokedAt: Date
  /** The application_name the command's transaction sets, so its lock wait can be seen. */
  applicationName: string
  /** Starts the command while the grant row is locked; it must not be awaited here. */
  start: () => Promise<T>
  /** Runs after the revocation committed, with the command's pending promise. */
  afterRevocation: (command: Promise<T>) => Promise<void>
}>

/**
 * Locks the user's current grant for a Property, starts the command, waits until it
 * is blocked on that lock, then revokes the grant and commits. The lock is released
 * and the command settled even when an assertion in `afterRevocation` throws.
 */
export async function raceAgainstGrantRevocation<T>(
  race: GrantRevocationRace<T>,
): Promise<void> {
  const revoker = await getPool().connect()
  const grantKey = [race.organizationId, race.propertyId, race.userId]
  let revocationOpen = false
  let command: Promise<T> | null = null

  try {
    await revoker.query('BEGIN')
    revocationOpen = true
    await revoker.query(
      `SELECT id FROM property_access_grant
       WHERE organization_id = $1 AND property_id = $2::uuid
         AND user_id = $3 AND revoked_at IS NULL
       FOR UPDATE`,
      grantKey,
    )
    command = race.start()
    void command.catch(() => undefined)
    await waitForSessionLock(race.applicationName)
    await revoker.query(
      `UPDATE property_access_grant SET revoked_at = $4
       WHERE organization_id = $1 AND property_id = $2::uuid
         AND user_id = $3 AND revoked_at IS NULL`,
      [...grantKey, race.revokedAt],
    )
    await revoker.query('COMMIT')
    revocationOpen = false

    await race.afterRevocation(command)
  } finally {
    if (revocationOpen) await revoker.query('ROLLBACK').catch(() => undefined)
    revoker.release()
    await command?.catch(() => undefined)
  }
}
