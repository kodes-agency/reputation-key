import { domainError } from '#/shared/domain/errors'
import { and, eq } from 'drizzle-orm'
import type { Tx } from '#/shared/outbox/commit'
import {
  reviewProviderSnapshotRuns,
  reviewProviderSubjects,
} from '#/shared/db/schema/review.schema'

export async function lockSnapshotRun(
  tx: Tx,
  scope: Readonly<{ runId: string; organizationId: string }>,
) {
  const [run] = await tx
    .select()
    .from(reviewProviderSnapshotRuns)
    .where(
      and(
        eq(reviewProviderSnapshotRuns.id, scope.runId),
        eq(reviewProviderSnapshotRuns.organizationId, scope.organizationId),
      ),
    )
    .for('update')
  return run
}

export function snapshotSubjectScope(
  organizationId: string,
  propertyId: string,
  sourceEpoch: number,
) {
  return and(
    eq(reviewProviderSubjects.organizationId, organizationId),
    eq(reviewProviderSubjects.propertyId, propertyId),
    eq(reviewProviderSubjects.sourceEpoch, sourceEpoch),
  )
}

export async function requireSnapshotRun(
  tx: Tx,
  scope: Readonly<{ runId: string; organizationId: string }>,
) {
  const run = await lockSnapshotRun(tx, scope)
  if (!run) throw domainError('snapshot_run_not_found', 'Snapshot run not found')
  return run
}
