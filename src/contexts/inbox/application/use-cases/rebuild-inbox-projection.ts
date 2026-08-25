// Inbox context — rebuild inbox projection (BQC-3.4).
//
// Bounded, idempotent, report-first repair for the review-sourced inbox
// projection. Derives state from canonical governed data:
// - reviews (existence / sourceDate / platform / propertyId / content expiry)
//   via the review source lookup port;
// - reply milestones (first submitted/published) via the reply lookup port.
//
// Reconciles:
// - missing items created directly in their canonical open/closed state with
//   reply milestones (idempotent create — creation-during-rebuild does NOT
//   re-emit created facts: rebuild is repair, not new information; the durable
//   record is the report);
// - expired-but-open items closed (with the status_changed fact — mirrors
//   the review.expired purge end state);
// - missing reply milestones stamped (no fact — milestones have no event
//   type); a published reply newly stamped on an open item auto-closes it
//   (with fact — mirrors the review.reply.published projection).
//
// NEVER touches inbox-owned fields (assignment, escalation, notes) and never
// deletes items. Feedback-sourced items are OUT of scope: the guest context
// is dark for beta (BQC-2.6), so its canonical data is not a rebuild source.

import type { InboxRepository } from '../ports/inbox.repository'
import type { InboxCommandStore } from '../ports/inbox-command-store.port'
import type {
  ReviewSourceLookupPort,
  ReviewSourceMeta,
} from '../ports/review-source-lookup.port'
import type { ReplyLookupPort, ReplyMilestones } from '../ports/reply-lookup.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  InboxItemId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import { createInboxItem as buildInboxItem } from '../../domain/constructors'
import { inboxItemStatusChanged } from '../../domain/events'
import { validateTransition } from '../../domain/rules'

export type RebuildInboxProjectionInput = Readonly<{
  organizationId: OrganizationId
  propertyId?: PropertyId
  dryRun: boolean
  batchSize?: number
}>

export type RebuildInboxProjectionReport = Readonly<{
  /** Review-sourced items examined + canonical reviews examined. */
  scanned: number
  /** Items created for canonical reviews that had none. */
  created: number
  /** Items repaired or initially materialized in the closed state. */
  closed: number
  /** Items that received a missing reply milestone stamp. */
  milestones: number
  dryRun: boolean
}>

export type RebuildInboxProjectionDeps = Readonly<{
  repo: InboxRepository
  commandStore: InboxCommandStore
  reviewSourceLookup: ReviewSourceLookupPort
  replyLookup: ReplyLookupPort
  idGen: () => InboxItemId
  clock: () => Date
  logger: LoggerPort
}>

export type RebuildInboxProjection = (
  input: RebuildInboxProjectionInput,
) => Promise<RebuildInboxProjectionReport>

type Counters = { scanned: number; created: number; closed: number; milestones: number }

/** What reconcile must do for one existing item (all fields independent). */
type ItemRepair = Readonly<{
  /** Close the item (purged/expired source, or newly-stamped publish). */
  close: boolean
  /** closedAt value: publish time for reply closes, rebuild time for expiry. */
  closeAt: Date
  stampSubmittedAt: Date | null
  stampPublishedAt: Date | null
}>

const NO_REPAIR: ItemRepair = {
  close: false,
  closeAt: new Date(0),
  stampSubmittedAt: null,
  stampPublishedAt: null,
}

/** Pure reconcile decision for one item against its canonical source. */
function decideItemRepair(
  item: InboxItem,
  src: ReviewSourceMeta | undefined,
  ms: ReplyMilestones | undefined,
  now: Date,
): ItemRepair {
  const sourceExpired =
    src !== undefined &&
    src.contentExpiresAt !== null &&
    src.contentExpiresAt.getTime() <= now.getTime()
  if (src === undefined || sourceExpired) {
    // Purged (or purge-pending) source — the review.expired consumer's end
    // state is closed. Already-closed items need nothing.
    return item.status === 'open'
      ? { ...NO_REPAIR, close: true, closeAt: now }
      : NO_REPAIR
  }
  const stampSubmittedAt =
    item.firstReplySubmittedAt === null ? (ms?.firstSubmittedAt ?? null) : null
  const stampPublishedAt =
    item.firstReplyPublishedAt === null ? (ms?.firstPublishedAt ?? null) : null
  // Close only when the projection MISSED the publish (milestone not yet
  // stamped): a stamped-but-open item was reopened by a user — inbox-owned
  // state that rebuild must not fight.
  const close =
    item.status === 'open' &&
    stampPublishedAt !== null &&
    validateTransition(item.status, 'closed').isOk()
  return {
    close,
    closeAt: stampPublishedAt ?? now,
    stampSubmittedAt,
    stampPublishedAt,
  }
}

/** Applies one item's repair through the command store (skipped on dryRun). */
async function applyItemRepair(
  deps: RebuildInboxProjectionDeps,
  item: InboxItem,
  repair: ItemRepair,
  counters: Counters,
  dryRun: boolean,
): Promise<void> {
  if (!repair.close && !repair.stampSubmittedAt && !repair.stampPublishedAt) return
  if (repair.close) counters.closed += 1
  if (repair.stampSubmittedAt ?? repair.stampPublishedAt) counters.milestones += 1
  if (dryRun) return
  const timestampFields: Partial<Record<string, Date>> = {}
  if (repair.close) timestampFields.closedAt = repair.closeAt
  if (repair.stampSubmittedAt)
    timestampFields.firstReplySubmittedAt = repair.stampSubmittedAt
  if (repair.stampPublishedAt)
    timestampFields.firstReplyPublishedAt = repair.stampPublishedAt
  await deps.commandStore.updateStatus(
    item,
    { status: repair.close ? 'closed' : item.status, timestampFields },
    repair.close
      ? inboxItemStatusChanged({
          inboxItemId: item.id,
          organizationId: item.organizationId,
          propertyId: item.propertyId,
          oldStatus: item.status,
          newStatus: 'closed',
          occurredAt: repair.closeAt,
        })
      : null,
    repair.closeAt,
  )
}

/** Pass A: reconcile one batch of existing items against canonical sources. */
async function reconcileItemBatch(
  deps: RebuildInboxProjectionDeps,
  batch: ReadonlyArray<InboxItem>,
  sourceById: ReadonlyMap<string, ReviewSourceMeta>,
  seenSourceIds: Set<string>,
  counters: Counters,
  now: Date,
  dryRun: boolean,
): Promise<void> {
  const liveIds: ReviewId[] = []
  for (const item of batch) {
    seenSourceIds.add(item.sourceId as string)
    if (sourceById.has(item.sourceId as string)) liveIds.push(item.sourceId as ReviewId)
  }
  const milestones =
    liveIds.length > 0
      ? await deps.replyLookup.getReplyMilestonesByReviewIds(
          liveIds,
          batch[0]!.organizationId,
        )
      : new Map<string, ReplyMilestones>()
  for (const item of batch) {
    counters.scanned += 1
    const repair = decideItemRepair(
      item,
      sourceById.get(item.sourceId as string),
      milestones.get(item.sourceId as string),
      now,
    )
    await applyItemRepair(deps, item, repair, counters, dryRun)
  }
}

export const rebuildInboxProjection =
  (deps: RebuildInboxProjectionDeps): RebuildInboxProjection =>
  async (input) => {
    const batchSize = Math.max(1, Math.min(input.batchSize ?? 200, 1000))
    const now = deps.clock()
    const counters: Counters = { scanned: 0, created: 0, closed: 0, milestones: 0 }

    const sources = await deps.reviewSourceLookup.listReviewSources(
      input.organizationId,
      input.propertyId,
    )
    const sourceById = new Map(sources.map((s) => [s.id as string, s]))
    const seenSourceIds = new Set<string>()

    // Pass A — existing review-sourced items, keyset-bounded batches.
    let cursor: InboxItemId | undefined
    for (;;) {
      const batch = await deps.repo.scanReviewItems(input.organizationId, {
        propertyId: input.propertyId,
        cursor,
        limit: batchSize,
      })
      if (batch.length === 0) break
      await reconcileItemBatch(
        deps,
        batch,
        sourceById,
        seenSourceIds,
        counters,
        now,
        input.dryRun,
      )
      cursor = batch[batch.length - 1]!.id
      if (batch.length < batchSize) break
    }

    // Pass B — canonical reviews with no inbox item. Resolve reply milestones
    // in bounded chunks, then materialize the FINAL state in one pass. Creating
    // every missing source as open forced expired/published reviews to wait for
    // a second rebuild before the projection converged.
    counters.scanned += sources.length
    const missingSources = sources.filter(
      (source) => !seenSourceIds.has(source.id as string),
    )
    for (let offset = 0; offset < missingSources.length; offset += batchSize) {
      const batch = missingSources.slice(offset, offset + batchSize)
      const liveIds = batch
        .filter(
          (source) => source.contentExpiresAt === null || source.contentExpiresAt > now,
        )
        .map((source) => source.id)
      const milestones =
        liveIds.length > 0
          ? await deps.replyLookup.getReplyMilestonesByReviewIds(
              liveIds,
              input.organizationId,
            )
          : new Map<string, ReplyMilestones>()

      for (const src of batch) {
        const built = buildInboxItem({
          id: deps.idGen(),
          organizationId: input.organizationId,
          propertyId: src.propertyId,
          sourceType: 'review',
          sourceId: src.id,
          sourceDate: src.sourceDate,
          platform: src.platform,
          assignedTo: null,
          clock: deps.clock,
        })
        if (built.isErr()) {
          deps.logger.warn(
            { err: built.error },
            'rebuildInboxProjection: skipping review — item construction failed',
          )
          continue
        }

        const reply = milestones.get(src.id as string)
        const expired = src.contentExpiresAt !== null && src.contentExpiresAt <= now
        const closeAt = expired ? now : (reply?.firstPublishedAt ?? null)
        const item: InboxItem = {
          ...built.value,
          status: closeAt ? 'closed' : 'open',
          closedAt: closeAt,
          firstReplySubmittedAt: reply?.firstSubmittedAt ?? null,
          firstReplyPublishedAt: reply?.firstPublishedAt ?? null,
        }

        counters.created += 1
        if (closeAt) counters.closed += 1
        if (item.firstReplySubmittedAt ?? item.firstReplyPublishedAt) {
          counters.milestones += 1
        }
        if (!input.dryRun) {
          // Idempotent create, NO created/status fact — rebuild is repair, not
          // new information; the durable record is this report.
          await deps.commandStore.createItem(item, null)
        }
      }
    }

    return { ...counters, dryRun: input.dryRun }
  }
