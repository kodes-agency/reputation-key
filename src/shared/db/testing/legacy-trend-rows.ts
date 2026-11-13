// A database that held trend operations before the branch CHECK was tightened
// keeps them as history, and the code still has to read them. A fresh database
// can no longer hold one, so a test that needs the legacy shape lifts the CHECK
// for the length of its body and puts it back, validated, once `cleanup` has
// removed what the body wrote. Integration tests run one at a time against the
// shared database, so the CHECK is never missing while another test writes.

import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

const BRANCH_CHECK = 'ai_operations_branch_valid'

export async function withLegacyTrendRowsAllowed(
  db: Database,
  cleanup: () => Promise<void>,
  body: () => Promise<void>,
): Promise<void> {
  const found = await db.execute<{ definition: string }>(sql`
    SELECT pg_catalog.pg_get_constraintdef(oid) AS definition
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.ai_operations'::regclass AND conname = ${BRANCH_CHECK}
  `)
  const definition = found.rows[0]?.definition
  if (!definition) throw new Error(`${BRANCH_CHECK} is missing`)

  await db.execute(
    sql.raw(`ALTER TABLE public.ai_operations DROP CONSTRAINT ${BRANCH_CHECK}`),
  )
  try {
    await body()
  } finally {
    await cleanup()
    await db.execute(
      sql.raw(
        `ALTER TABLE public.ai_operations ADD CONSTRAINT ${BRANCH_CHECK} ${definition}`,
      ),
    )
  }
}
