// Inbox context — rebuild inbox projection (BQC-3.4).
//
// Bounded, idempotent, report-first repair for the review-sourced inbox
// projection. Derives state from canonical governed data:
// - reviews (existence / sourceDate / platform / propertyId / stable revision)
//   via the review source lookup port;
// - reply milestones (first submitted/published) via the reply lookup port.
//
// Reconciles:
// - missing items created in an open Handling Cycle with
//   reply milestones (idempotent create — creation-during-rebuild does NOT
//   record another created fact: rebuild is repair, not new information; the
//   durable record is the report);
// - missing reply milestones stamped (no fact — milestones have no event
//   type).
//
// Status is deliberately OUT of scope. Missing/expired source content and a
// historical published milestone are not exact-current Handling Cycle
// authority. Only the source-transition and reply-observation consumers may
// close a Review cycle while holding Review's current-state permit.
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
  /** Retained for report compatibility; rebuild never infers a close. */
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
  stampSubmittedAt: Date | null
  stampPublishedAt: Date | null
}>

const NO_REPAIR: ItemRepair = {
  stampSubmittedAt: null,
  stampPublishedAt: null,
}

/** Pure reconcile decision for one item against its canonical source. */
function decideItemRepair(
  item: InboxItem,
  src: ReviewSourceMeta | undefined,
  ms: ReplyMilestones | undefined,
): ItemRepair {
  if (src === undefined) return NO_REPAIR
  const stampSubmittedAt =
    item.firstReplySubmittedAt === null ? (ms?.firstSubmittedAt ?? null) : null
  const stampPublishedAt =
    item.firstReplyPublishedAt === null ? (ms?.firstPublishedAt ?? null) : null
  return { stampSubmittedAt, stampPublishedAt }
}

/** Applies one item's repair through the command store (skipped on dryRun). */
async function applyItemRepair(
  deps: RebuildInboxProjectionDeps,
  item: InboxItem,
  repair: ItemRepair,
  counters: Counters,
  dryRun: boolean,
  now: Date,
): Promise<void> {
  if (!repair.stampSubmittedAt && !repair.stampPublishedAt) return
  if (repair.stampSubmittedAt ?? repair.stampPublishedAt) counters.milestones += 1
  if (dryRun) return
  // Rebuild repairs MILESTONES, never workflow status. Routing this through
  // the status seam (passing `item.status` straight back) made the rebuild an
  // unfenced writer of the `inbox_items.status` compatibility mirror, which is
  // exactly the desynchronisation a rebuild is supposed to detect.
  await deps.repo.stampReplyMilestones(
    item.id,
    item.organizationId,
    {
      ...(repair.stampSubmittedAt
        ? { firstReplySubmittedAt: repair.stampSubmittedAt }
        : {}),
      ...(repair.stampPublishedAt
        ? { firstReplyPublishedAt: repair.stampPublishedAt }
        : {}),
    },
    now,
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
    )
    await applyItemRepair(deps, item, repair, counters, dryRun, now)
  }
}

/** Pass A: walk every existing review-sourced item in keyset-bounded batches. */
async function reconcileExistingItems(
  deps: RebuildInboxProjectionDeps,
  input: RebuildInboxProjectionInput,
  sourceById: ReadonlyMap<string, ReviewSourceMeta>,
  seenSourceIds: Set<string>,
  counters: Counters,
  now: Date,
  batchSize: number,
): Promise<void> {
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
}

/**
 * Pass B, one review: materialize metadata plus an OPEN initial cycle. A review
 * without a stable material revision, or one the constructor rejects, is
 * reported and skipped rather than guessed at.
 */
async function materializeMissingItem(
  deps: RebuildInboxProjectionDeps,
  input: RebuildInboxProjectionInput,
  src: ReviewSourceMeta,
  milestones: ReadonlyMap<string, ReplyMilestones>,
  counters: Counters,
): Promise<void> {
  if (src.materialReviewRevision === null) {
    deps.logger.warn(
      {},
      'rebuildInboxProjection: skipping review without a stable material revision',
    )
    return
  }
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
    return
  }

  const reply = milestones.get(src.id as string)
  const item: InboxItem = {
    ...built.value,
    status: 'open',
    closedAt: null,
    firstReplySubmittedAt: reply?.firstSubmittedAt ?? null,
    firstReplyPublishedAt: reply?.firstPublishedAt ?? null,
  }

  counters.created += 1
  if (item.firstReplySubmittedAt ?? item.firstReplyPublishedAt) {
    counters.milestones += 1
  }
  if (input.dryRun) return
  // Idempotent create, NO created/status fact — rebuild is repair, not
  // new information; the durable record is this report.
  await deps.commandStore.createItem(item, null, {
    materialReviewRevision: src.materialReviewRevision,
  })
}

/**
 * Pass B: canonical reviews with no inbox item. Reply milestones resolve in
 * bounded chunks. This repair path cannot infer a current handling outcome from
 * expiry or historical Reply milestones.
 */
async function materializeMissingItems(
  deps: RebuildInboxProjectionDeps,
  input: RebuildInboxProjectionInput,
  missingSources: ReadonlyArray<ReviewSourceMeta>,
  counters: Counters,
  batchSize: number,
): Promise<void> {
  for (let offset = 0; offset < missingSources.length; offset += batchSize) {
    const batch = missingSources.slice(offset, offset + batchSize)
    const liveIds = batch.map((source) => source.id)
    const milestones =
      liveIds.length > 0
        ? await deps.replyLookup.getReplyMilestonesByReviewIds(
            liveIds,
            input.organizationId,
          )
        : new Map<string, ReplyMilestones>()

    for (const src of batch) {
      await materializeMissingItem(deps, input, src, milestones, counters)
    }
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

    await reconcileExistingItems(
      deps,
      input,
      sourceById,
      seenSourceIds,
      counters,
      now,
      batchSize,
    )

    counters.scanned += sources.length
    const missingSources = sources.filter(
      (source) => !seenSourceIds.has(source.id as string),
    )
    await materializeMissingItems(deps, input, missingSources, counters, batchSize)

    return { ...counters, dryRun: input.dryRun }
  }
