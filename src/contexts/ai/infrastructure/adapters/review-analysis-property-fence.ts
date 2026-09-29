import { sql } from 'drizzle-orm'
import type { Database } from '#/shared/db'

type Tx = Parameters<Parameters<Database['transaction']>[0]>[0]

/**
 * Lock a Property's source fence the way Review writers do, before any review
 * or enrollment row. Every Review writer locks the Property before its Review,
 * and an authorization change locks the Property before its enrollments, so a
 * pass that allocates analysis sequences for many reviews must too.
 *
 * The row is only read, so `FOR NO KEY UPDATE`: the mode of
 * `lock_review_ai_analysis_head_v1` and of Review's own fence. It excludes the
 * other fence holders and every epoch writer, but not the foreign-key checks of
 * rows that reference the Property (metric readings, AI settlements).
 */
export async function lockReviewAnalysisPropertyFence(
  tx: Tx,
  scope: Readonly<{ organizationId: string; propertyId: string }>,
): Promise<void> {
  await tx.execute(sql`
    SELECT 1 FROM properties
    WHERE organization_id = ${scope.organizationId}
      AND id = ${scope.propertyId}::uuid
    FOR NO KEY UPDATE
  `)
}
