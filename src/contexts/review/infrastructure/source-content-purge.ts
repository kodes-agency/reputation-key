// Review context — source-content lifecycle erasure (BQC-1.7 / REV-01).
//
// Disconnect and approved tenant/property erasure scrub provider-controlled
// Review fields in bounded transactions. The stable Review, manager Replies,
// Inbox history, and content-free evidence remain. The independently erasable
// review_source_contents row is removed in the same transaction.

import { and, asc, eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { reviews } from '#/shared/db/schema/review.schema'
import {
  DEFAULT_MAX_BATCHES_PER_RUN,
  executeRetentionRule,
  type RetentionRule,
} from '#/shared/db/retention/execute-retention-rule'
import {
  closeRetentionRun,
  failRetentionRun,
  openRetentionRun,
} from '#/shared/db/retention/evidence'
import {
  organizationId,
  propertyId,
  reviewId,
  type OrganizationId,
  type PropertyId,
} from '#/shared/domain/ids'
import type {
  SourceContentPurge,
  SourcePurgeResult,
} from '../application/ports/source-content-purge.port'
import { eraseReviewSourceContent } from './review-source-content-store'

type PurgeDeps = Readonly<{
  db: Database
  clock: () => Date
  batchSize?: number
}>

type ReviewScrubScope =
  | Readonly<{ kind: 'connection'; organizationId: string; connectionId: string }>
  | Readonly<{ kind: 'property'; organizationId: string; propertyId: string }>
  | Readonly<{ kind: 'organization'; organizationId: string }>

function reviewScope(scope: ReviewScrubScope) {
  const tenant = eq(reviews.organizationId, scope.organizationId)
  switch (scope.kind) {
    case 'connection':
      return and(tenant, eq(reviews.googleConnectionId, scope.connectionId))
    case 'property':
      return and(tenant, eq(reviews.propertyId, scope.propertyId))
    case 'organization':
      return tenant
  }
}

export const createSourceContentPurge = (deps: PurgeDeps): SourceContentPurge => {
  const batchSize = deps.batchSize ?? 500

  async function scrubReviews(
    subject: string,
    scope: ReviewScrubScope,
  ): Promise<SourcePurgeResult> {
    const runId = await openRetentionRun(deps.db, subject, batchSize, deps.clock())
    try {
      let batches = 0
      let rowsRedacted = 0
      while (batches < DEFAULT_MAX_BATCHES_PER_RUN) {
        const count = await deps.db.transaction(async (tx) => {
          const rows = await tx
            .select({
              id: reviews.id,
              organizationId: reviews.organizationId,
              propertyId: reviews.propertyId,
              sourceEpoch: reviews.sourceEpoch,
              sourceRevision: reviews.sourceRevision,
            })
            .from(reviews)
            .where(and(eq(reviews.sourceContentState, 'active'), reviewScope(scope)))
            .orderBy(asc(reviews.id))
            .limit(batchSize)
            .for('update', { skipLocked: true })

          for (const row of rows) {
            const erased = await eraseReviewSourceContent(tx, {
              reviewId: reviewId(row.id),
              organizationId: organizationId(row.organizationId),
              propertyId: propertyId(row.propertyId),
              sourceEpoch: row.sourceEpoch,
              expectedSourceRevision: row.sourceRevision,
              state: 'source_expired',
            })
            if (!erased) throw new Error('Review changed during source erasure')
          }
          return rows.length
        })
        if (count === 0) break
        batches += 1
        rowsRedacted += count
        if (count < batchSize) break
      }
      await closeRetentionRun(deps.db, runId, {
        finishedAt: deps.clock(),
        batches,
        rowsDeleted: 0,
        rowsRedacted,
        outcome: 'completed',
      })
      return { subject, batches, rowsDeleted: 0, rowsRedacted }
    } catch (err) {
      await failRetentionRun(deps.db, runId, deps.clock(), err)
      throw err
    }
  }

  async function deleteRows(
    subject: string,
    rule: RetentionRule,
  ): Promise<SourcePurgeResult> {
    const runId = await openRetentionRun(deps.db, subject, batchSize, deps.clock())
    try {
      const result = await executeRetentionRule(deps.db, rule, {
        cutoff: deps.clock(),
        batchSize,
      })
      await closeRetentionRun(deps.db, runId, {
        finishedAt: deps.clock(),
        batches: result.batches,
        rowsDeleted: result.rowsDeleted,
        rowsRedacted: result.rowsRedacted,
        outcome: 'completed',
      })
      return {
        subject,
        batches: result.batches,
        rowsDeleted: result.rowsDeleted,
        rowsRedacted: result.rowsRedacted,
      }
    } catch (err) {
      await failRetentionRun(deps.db, runId, deps.clock(), err)
      throw err
    }
  }

  return {
    forConnection: async (orgId: OrganizationId, connectionId: string) =>
      scrubReviews('reviews.purge.connection', {
        kind: 'connection',
        organizationId: orgId as string,
        connectionId,
      }),

    forProperty: async (orgId: OrganizationId, property: PropertyId) =>
      scrubReviews('reviews.purge.property', {
        kind: 'property',
        organizationId: orgId as string,
        propertyId: property as string,
      }),

    forOrganization: async (orgId: OrganizationId) =>
      scrubReviews('reviews.purge.organization', {
        kind: 'organization',
        organizationId: orgId as string,
      }),

    inboxForProperty: async (orgId: OrganizationId, property: PropertyId) =>
      deleteRows('inbox_items.purge.property', {
        subject: 'inbox_items.purge.property',
        table: 'inbox_items',
        keyColumns: ['id'],
        tsColumn: 'id',
        olderThanMs: 0,
        equalsWhere: [
          { column: 'organization_id', value: orgId as string },
          { column: 'property_id', value: property as string },
        ],
      }),
  }
}
