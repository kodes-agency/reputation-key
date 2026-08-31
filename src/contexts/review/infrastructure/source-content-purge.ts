// Review context — source-content lifecycle compatibility adapter (BQC-1.7 / REV-01).
//
// Ordinary composition reports connection/Property/Organization scopes through
// the checkpointed Review authority. A separately constructed, approved
// executor can apply bounded pages; stable identity and manager history remain.

import type { Database } from '#/shared/db'
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
import type { OrganizationId, PropertyId } from '#/shared/domain/ids'
import type {
  SourceContentPurge,
  SourcePurgeContinuation,
  SourcePurgeResult,
} from '../application/ports/source-content-purge.port'
import type { ReviewSourceContentLifecycleScope } from '../application/ports/source-content-lifecycle-store.port'
import { createReviewSourceContentLifecycleStore } from './repositories/source-content-lifecycle-store.repository'
import {
  REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION,
  createRunReviewSourceContentLifecycle,
  type AuthorizeReviewSourceContentLifecycleApply,
  type RunReviewSourceContentLifecycle,
} from '../application/use-cases/run-source-content-lifecycle'

type PurgeDeps = Readonly<{
  db: Database
  clock: () => Date
  batchSize?: number
  maxBatches?: number
  /** Test/adapter seam; normal wiring constructs the Review authority locally. */
  runLifecycle?: RunReviewSourceContentLifecycle
  /**
   * Deliberately absent from ordinary composition. Both fields are required
   * before the compatibility adapter can request apply from the authority.
   */
  applyAdmission?: Readonly<{
    confirmation: typeof REVIEW_SOURCE_CONTENT_LIFECYCLE_APPLY_CONFIRMATION
    authorizeApply: AuthorizeReviewSourceContentLifecycleApply
  }>
}>

export const createSourceContentPurge = (deps: PurgeDeps): SourceContentPurge => {
  const batchSize = deps.batchSize ?? 100
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new TypeError('Review source-content purge batchSize must be between 1 and 100')
  }
  const maxBatches = deps.maxBatches ?? DEFAULT_MAX_BATCHES_PER_RUN
  if (
    !Number.isInteger(maxBatches) ||
    maxBatches < 1 ||
    maxBatches > DEFAULT_MAX_BATCHES_PER_RUN
  ) {
    throw new TypeError(
      `Review source-content purge maxBatches must be between 1 and ${DEFAULT_MAX_BATCHES_PER_RUN}`,
    )
  }
  const runLifecycle =
    deps.runLifecycle ??
    createRunReviewSourceContentLifecycle({
      store: createReviewSourceContentLifecycleStore(deps.db),
      clock: deps.clock,
      ...(deps.applyAdmission == null
        ? {}
        : { authorizeApply: deps.applyAdmission.authorizeApply }),
    })
  const mode = deps.applyAdmission == null ? ('report' as const) : ('apply' as const)

  async function scrubReviews(
    subject: string,
    scope: ReviewSourceContentLifecycleScope,
    continuation?: SourcePurgeContinuation,
  ): Promise<SourcePurgeResult> {
    let checkpoint = continuation?.checkpoint
    let batches = 0
    let rowsRedacted = 0
    do {
      const result = await runLifecycle({
        mode,
        scope,
        batchSize,
        ...(checkpoint == null ? {} : { checkpoint }),
        ...(deps.applyAdmission == null
          ? {}
          : { applyConfirmation: deps.applyAdmission.confirmation }),
      })
      if (result.scanned > 0) batches += 1
      if (result.apply.enabled) rowsRedacted += result.apply.rowsRedacted
      checkpoint = result.nextCheckpoint ?? undefined
      if (checkpoint != null && result.scanned === 0) {
        throw new Error('Review lifecycle returned a continuation without progress')
      }
    } while (checkpoint != null && batches < maxBatches)

    return {
      subject,
      batches,
      rowsDeleted: 0,
      rowsRedacted,
      nextCheckpoint: checkpoint ?? null,
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
    forConnection: async (
      orgId: OrganizationId,
      connectionId: string,
      continuation?: SourcePurgeContinuation,
    ) =>
      scrubReviews(
        'reviews.purge.connection',
        {
          kind: 'connection',
          organizationId: orgId,
          connectionId,
        },
        continuation,
      ),

    forProperty: async (
      orgId: OrganizationId,
      property: PropertyId,
      continuation?: SourcePurgeContinuation,
    ) =>
      scrubReviews(
        'reviews.purge.property',
        {
          kind: 'property',
          organizationId: orgId,
          propertyId: property,
        },
        continuation,
      ),

    forOrganization: async (
      orgId: OrganizationId,
      continuation?: SourcePurgeContinuation,
    ) =>
      scrubReviews(
        'reviews.purge.organization',
        {
          kind: 'organization',
          organizationId: orgId,
        },
        continuation,
      ),

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
