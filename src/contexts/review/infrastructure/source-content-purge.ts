// Review context — source-content lifecycle purges (BQC-1.7).
//
// Bounded, retryable erasure of Google source content for disconnect and
// approved property/organization purge. Reviews (and their replies via FK
// cascade per batch) are deleted in bounded batches through the retention
// executor; every purge records content-free evidence in retention_runs.
//
// Replies die with their parent review rows (replies.review_id FK cascade),
// so no unbounded cascade transaction is ever issued. Audit evidence
// required by policy (disconnect/property events, activity log, the
// evidence rows themselves) is never deleted here.

import type { Database } from '#/shared/db'
import {
  executeRetentionRule,
  type RetentionRule,
} from '#/shared/db/retention/execute-retention-rule'
import { closeRetentionRun, openRetentionRun } from '#/shared/db/retention/evidence'
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  SourceContentPurge,
  SourcePurgeResult,
} from '../application/ports/source-content-purge.port'

type PurgeDeps = Readonly<{
  db: Database
  clock: () => Date
  batchSize?: number
}>

function reviewsRule(
  subject: string,
  equals: { column: string; value: string },
  orgId: string,
): RetentionRule {
  return {
    subject,
    table: 'reviews',
    keyColumns: ['id'],
    tsColumn: 'id',
    olderThanMs: 0,
    extraWhere: `organization_id = '${orgId}'`,
    equalsWhere: equals,
  }
}

export const createSourceContentPurge = (deps: PurgeDeps): SourceContentPurge => {
  const batchSize = deps.batchSize ?? 500

  async function run(subject: string, rule: RetentionRule): Promise<SourcePurgeResult> {
    const runId = await openRetentionRun(deps.db, subject, batchSize, deps.clock())
    try {
      const result = await executeRetentionRule(deps.db, rule, {
        cutoff: deps.clock(), // unused for equality purges
        batchSize,
      })
      await closeRetentionRun(deps.db, runId, {
        finishedAt: deps.clock(),
        batches: result.batches,
        rowsDeleted: result.rowsDeleted,
        outcome: 'completed',
      })
      return { subject, ...result }
    } catch (err) {
      await closeRetentionRun(deps.db, runId, {
        finishedAt: deps.clock(),
        outcome: 'failed',
        errorCode: (err instanceof Error ? err.message : String(err)).slice(0, 200),
      }).catch(() => {})
      throw err
    }
  }

  return {
    /** Disconnect: every review sourced through the revoked connection. */
    forConnection: async (
      orgId: OrganizationId,
      connectionId: string,
    ): Promise<SourcePurgeResult> =>
      run(
        'reviews.purge.connection',
        reviewsRule(
          'reviews.purge.connection',
          { column: 'google_connection_id', value: connectionId },
          orgId as string,
        ),
      ),

    /** Approved property purge: every review for the property. */
    forProperty: async (
      orgId: OrganizationId,
      propertyId: PropertyId,
    ): Promise<SourcePurgeResult> =>
      run(
        'reviews.purge.property',
        reviewsRule(
          'reviews.purge.property',
          { column: 'property_id', value: propertyId as string },
          orgId as string,
        ),
      ),

    /** Approved organization purge: every review across the organization. */
    forOrganization: async (orgId: OrganizationId): Promise<SourcePurgeResult> =>
      run('reviews.purge.organization', {
        subject: 'reviews.purge.organization',
        table: 'reviews',
        keyColumns: ['id'],
        tsColumn: 'id',
        olderThanMs: 0,
        equalsWhere: { column: 'organization_id', value: orgId as string },
      }),

    /** Property purge companion: inbox workflow rows for the property
     *  (content-free since BQC-1.2; rows must not orphan on property delete). */
    inboxForProperty: async (
      orgId: OrganizationId,
      propertyId: PropertyId,
    ): Promise<SourcePurgeResult> =>
      run('inbox_items.purge.property', {
        subject: 'inbox_items.purge.property',
        table: 'inbox_items',
        keyColumns: ['id'],
        tsColumn: 'id',
        olderThanMs: 0,
        extraWhere: `organization_id = '${orgId}'`,
        equalsWhere: { column: 'property_id', value: propertyId as string },
      }),
  }
}
