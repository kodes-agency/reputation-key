// Shared bump CTE for policy mutations (BQC-2.2).
//
// Appended to every policy-state mutation so the global policy_version bump
// commits in the SAME statement as the mutation — a committed mutation is
// never visible without its version bump, which is what makes the snapshot
// store's version-gated refresh a correct cache-invalidation contract.

import { sql } from 'drizzle-orm'

export const BUMP_POLICY_VERSION_SQL = sql`
  bump AS (
    INSERT INTO policy_version (scope, version, updated_at)
    VALUES ('global', 1, now())
    ON CONFLICT (scope) DO UPDATE
      SET version = policy_version.version + 1, updated_at = now()
    RETURNING version
  )
`
