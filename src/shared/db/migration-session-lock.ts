type Session = Readonly<{ query: (text: string) => Promise<unknown> }>

export const MIGRATION_LOCK_SQL =
  "SELECT pg_advisory_lock(hashtextextended('repkey-migration-journal', 0))"
export const MIGRATION_UNLOCK_SQL =
  "SELECT pg_advisory_unlock(hashtextextended('repkey-migration-journal', 0))"

/** Both local and deploy entry points serialize the complete journal. */
export async function withMigrationSessionLock<T>(
  session: Session,
  run: () => Promise<T>,
): Promise<T> {
  await session.query(MIGRATION_LOCK_SQL)
  try {
    return await run()
  } finally {
    // Closing a failed connection also releases the session lock.
    await session.query(MIGRATION_UNLOCK_SQL).catch(() => {})
  }
}
