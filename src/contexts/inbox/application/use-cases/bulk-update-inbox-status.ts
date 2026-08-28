// Inbox context — bulk update inbox status use case
// Initial-beta bulk reopen for multiple inbox items. Bulk Close is intentionally
// absent until it has cycle compatibility preview and settled closure outcomes.
// Each candidate is checked against its owning source permission; escalation
// remains orthogonal and is handled separately.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import { reviewId, type InboxItemId } from '#/shared/domain/ids'
import type { InboxItem, ManualReopenReason } from '../../domain/types'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import { validateTransition } from '../../domain/rules'
import { inboxError } from '../../domain/errors'
import {
  inboxItemBulkStatusChanged,
  type InboxItemBulkStatusChanged,
} from '../../domain/events'
import { canForContext } from '#/shared/domain/permissions'
import type { LoggerPort } from '#/shared/domain/logger.port'
import {
  canHandleInboxSource,
  isInboxSourcePropertyWithinScopes,
  resolveInboxSourceScopes,
} from '../inbox-access'
import type { InboxSourceScope } from '../ports/inbox.repository'
import { INBOX_BULK_LIMIT } from '../dto/inbox.dto'
import type { ReviewSourceLookupPort } from '../ports/review-source-lookup.port'
import type { ReviewResponseTargetAuthorityPort } from '../ports/review-response-target-authority.port'

export type BulkReopenItemInput = Readonly<{
  inboxItemId: InboxItemId
  expectedCommandRevision: number
}>

export type BulkReopenItemOutcome =
  'reopened' | 'already_open' | 'revision_conflict' | 'unavailable'

export type BulkReopenItemResult = Readonly<{
  inboxItemId: InboxItemId
  outcome: BulkReopenItemOutcome
}>

export type BulkUpdateInboxStatusInput = Readonly<{
  items: ReadonlyArray<BulkReopenItemInput>
  newStatus: 'open'
  reopenReason: ManualReopenReason
  reopenExplanation?: string | null
}>

export type BulkUpdateInboxStatusResult = Readonly<{
  updated: number
  results: ReadonlyArray<BulkReopenItemResult>
}>

export type BulkUpdateInboxStatusDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  clock: () => Date
  idGen: () => string
  staffPublicApi: StaffPublicApi
  reviewSourceLookup: ReviewSourceLookupPort
  responseTargetAuthority: ReviewResponseTargetAuthorityPort
  logger: LoggerPort
}>

export type BulkUpdateInboxStatus = (
  input: BulkUpdateInboxStatusInput,
  ctx: AuthContext,
) => Promise<BulkUpdateInboxStatusResult>

// `accessible` is null for an org-wide caller (no filtering); an explicit list
// for an assigned-scope caller (PM/Staff). `ok: false` means access resolution
// failed and the whole operation must no-op. (PM holds inbox.manage but is NOT
// org-wide — CONTEXT.md L72.)
type AccessResolution = Readonly<
  { ok: true; sourceScopes: ReadonlyArray<InboxSourceScope> } | { ok: false }
>

/** Resolves the accessible-property filter once for the whole batch. On lookup
 *  failure, fails safe (`ok: false`) so the caller updates nothing. */
const resolveAccessiblePropertyIds = async (
  deps: BulkUpdateInboxStatusDeps,
  ctx: AuthContext,
): Promise<AccessResolution> => {
  try {
    return {
      ok: true,
      sourceScopes: await resolveInboxSourceScopes(deps.staffPublicApi, ctx, 'handle'),
    }
  } catch (err) {
    deps.logger.warn(
      { err },
      'Access check for property IDs failed, treating as no access',
    )
    return { ok: false }
  }
}

type BulkSelection = Readonly<{
  validItems: ReadonlyArray<InboxItem>
  preflightResults: ReadonlyArray<BulkReopenItemResult>
}>

/** Classifies every requested item without disclosing whether unavailable
 * means absent, another tenant, or outside the caller's current authority. */
const selectValidBulkItems = (
  items: ReadonlyArray<InboxItem>,
  commands: ReadonlyArray<BulkReopenItemInput>,
  newStatus: BulkUpdateInboxStatusInput['newStatus'],
  sourceScopes: ReadonlyArray<InboxSourceScope>,
  ctx: AuthContext,
): BulkSelection => {
  const itemMap = new Map(items.map((item) => [item.id as string, item]))
  const valid: InboxItem[] = []
  const results: BulkReopenItemResult[] = []
  for (const command of commands) {
    const item = itemMap.get(command.inboxItemId as string)
    if (!item || !canHandleInboxSource(ctx, item.sourceType)) {
      results.push({ inboxItemId: command.inboxItemId, outcome: 'unavailable' })
      continue
    }
    if (
      !isInboxSourcePropertyWithinScopes(sourceScopes, item.sourceType, item.propertyId)
    ) {
      results.push({ inboxItemId: command.inboxItemId, outcome: 'unavailable' })
      continue
    }
    if (item.commandRevision !== command.expectedCommandRevision) {
      results.push({
        inboxItemId: command.inboxItemId,
        outcome: 'revision_conflict',
      })
      continue
    }
    if (validateTransition(item.status, newStatus).isErr()) {
      results.push({ inboxItemId: command.inboxItemId, outcome: 'already_open' })
      continue
    }
    valid.push(item)
  }
  return { validItems: valid, preflightResults: results }
}

/** Builds the per-item bulk_status_changed facts (one per item, shared bulkId).
 *  propertyId comes from the batch-fetched item — it is always present. */
const buildBulkStatusEvents = (
  validItems: ReadonlyArray<InboxItem>,
  input: BulkUpdateInboxStatusInput,
  ctx: AuthContext,
  bulkId: string,
  now: Date,
): InboxItemBulkStatusChanged[] =>
  validItems.map((item) =>
    inboxItemBulkStatusChanged({
      inboxItemId: item.id,
      organizationId: ctx.organizationId,
      propertyId: item.propertyId,
      oldStatus: item.status,
      newStatus: input.newStatus,
      bulkId,
      userId: ctx.userId,
      occurredAt: now,
    }),
  )

export const bulkUpdateInboxStatus =
  (deps: BulkUpdateInboxStatusDeps): BulkUpdateInboxStatus =>
  async (input, ctx) => {
    if (!canForContext(ctx, 'inbox.write'))
      throw inboxError('forbidden', 'No inbox write permission')
    if (
      input.items.length === 0 ||
      input.items.length > INBOX_BULK_LIMIT ||
      new Set(input.items.map((item) => item.inboxItemId as string)).size !==
        input.items.length
    ) {
      throw inboxError('invalid_input', 'Inbox bulk reopen selection is invalid')
    }
    const now = deps.clock()
    const bulkId = deps.idGen()

    // 1. Resolve accessible-property filter once for the whole batch
    const access = await resolveAccessiblePropertyIds(deps, ctx)
    if (!access.ok) {
      return {
        updated: 0,
        results: input.items.map((item) => ({
          inboxItemId: item.inboxItemId,
          outcome: 'unavailable' as const,
        })),
      }
    }

    // 2. Batch-fetch all items (eliminates N+1) and select valid candidates
    const ids = input.items.map((item) => item.inboxItemId)
    const items = await deps.repo.findByIds(ids, ctx.organizationId)
    const selection = selectValidBulkItems(
      items,
      input.items,
      input.newStatus,
      access.sourceScopes,
      ctx,
    )
    if (selection.validItems.length === 0) {
      const resultById = new Map(
        selection.preflightResults.map((result) => [result.inboxItemId, result]),
      )
      return {
        updated: 0,
        results: input.items.map((item) => resultById.get(item.inboxItemId)!),
      }
    }

    // 3. One transaction authorizes the complete candidate set, applies each
    // revision CAS, and records facts only for rows whose CAS lands.
    const events = buildBulkStatusEvents(selection.validItems, input, ctx, bulkId, now)
    const governance = {
      reason: input.reopenReason,
      explanation: input.reopenExplanation ?? null,
    }
    const reviewItems = selection.validItems.filter(
      (item): item is InboxItem & Readonly<{ sourceType: 'review' }> =>
        item.sourceType === 'review',
    )
    let stored: Awaited<ReturnType<InboxCommandStore['bulkUpdateStatus']>>
    if (reviewItems.length === 0) {
      stored = await deps.commandStore.bulkUpdateStatus(
        selection.validItems,
        events,
        governance,
      )
    } else {
      const sourceRows = await deps.reviewSourceLookup.getReviewSourceMetaByIds(
        reviewItems.map((item) => reviewId(item.sourceId)),
        ctx.organizationId,
      )
      const sourceByReviewId = new Map(sourceRows.map((source) => [source.id, source]))
      if (sourceByReviewId.size !== reviewItems.length) {
        throw inboxError('revision_conflict', 'A Review source changed; reload and retry')
      }
      const authority = await deps.responseTargetAuthority.withExactCurrentBatch(
        reviewItems.map((item) => {
          const source = sourceByReviewId.get(reviewId(item.sourceId))!
          return {
            organizationId: item.organizationId,
            propertyId: item.propertyId,
            reviewId: item.sourceId,
            sourceEpoch: source.sourceEpoch,
          }
        }),
        (permits) => {
          const byItemId = new Map(
            permits.map((permit) => {
              const item = reviewItems.find(
                (candidate) => candidate.sourceId === permit.reviewId,
              )
              if (!item) {
                throw inboxError(
                  'revision_conflict',
                  'Review target authority did not match the bulk selection',
                )
              }
              return [
                item.id as string,
                {
                  reviewAuthority: permit,
                  targetStart: { basis: 'operational_reopen' as const, at: now },
                },
              ] as const
            }),
          )
          return deps.commandStore.bulkUpdateStatus(
            selection.validItems,
            events,
            governance,
            byItemId,
          )
        },
      )
      if (authority.status === 'obsolete') {
        throw inboxError('revision_conflict', 'A Review source changed; reload and retry')
      }
      stored = authority.value
    }
    const resultById = new Map(
      [...selection.preflightResults, ...stored.results].map((result) => [
        result.inboxItemId,
        result,
      ]),
    )
    return {
      updated: stored.updated,
      results: input.items.map((item) => resultById.get(item.inboxItemId)!),
    }
  }
