import { getPool } from '#/shared/db/pool'

const MUTATION_GUARD = 'reply_publication_authorizations_immutable'
const TRUNCATE_GUARD = 'reply_publication_authorizations_truncate_guard'

/**
 * Integration fixtures occasionally need to remove append-only publication
 * authorization evidence from the isolated, disposable test database. Keep
 * that owner-only escape hatch in test code: production runtime paths never
 * disable these ALWAYS triggers.
 *
 * The integration project is deliberately single-worker because its fixtures
 * share one database, so the table-level trigger posture cannot race another
 * test file while this callback runs.
 */
export async function withPublicationAuthorizationFixtureMutation<T>(
  mutation: () => Promise<T>,
): Promise<T> {
  const pool = getPool()
  await pool.query(
    `ALTER TABLE reply_publication_authorizations DISABLE TRIGGER "${MUTATION_GUARD}"`,
  )
  await pool.query(
    `ALTER TABLE reply_publication_authorizations DISABLE TRIGGER "${TRUNCATE_GUARD}"`,
  )
  try {
    return await mutation()
  } finally {
    await pool.query(
      `ALTER TABLE reply_publication_authorizations ENABLE ALWAYS TRIGGER "${MUTATION_GUARD}"`,
    )
    await pool.query(
      `ALTER TABLE reply_publication_authorizations ENABLE ALWAYS TRIGGER "${TRUNCATE_GUARD}"`,
    )
  }
}
