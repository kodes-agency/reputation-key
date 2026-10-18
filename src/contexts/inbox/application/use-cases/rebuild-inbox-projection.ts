// Inbox context — rebuild inbox projection (BQC-3.4).
//
// Bounded, idempotent, report-first repair for the review-sourced inbox
// projection. Derives state from canonical governed data:
// - reviews (existence / sourceDate / platform / propertyId / stable revision)
//   via the review source lookup port;
// - reply milestones (first submitted/published) via the reply lookup port. A
//   reply written on Google has no Reply row: it counts as published while
//   Review's observation head is live, at the time Google reports for it;
// - Review's current Google reply observation head, for missing items.
//
// Reconciles:
// - missing items created in an open Handling Cycle with reply milestones —
//   or created CLOSED when Google already shows a reply answering the
//   review's current revision. That close is decided inside Review's
//   exact-current observation permit, on the predicate
//   `inbox.on-reply-observed` closes on: the review's observed fact gave up
//   waiting for an item long ago and nobody else may close a Review cycle, so
//   an item created open over it would stay open for good. Either way the
//   create records no fact: rebuild is repair, not new information; the
//   durable record is the report;
// - missing reply milestones stamped (no fact — milestones have no event
//   type).
//
// The status of an EXISTING item is deliberately OUT of scope. Missing/expired
// source content and a historical published milestone are not exact-current
// Handling Cycle authority, and an open item over a reply Google shows can be
// right — a manager reopened it, or a guest edited the review after the reply
// (a carried-over reply raises no observed fact) — which a rebuild cannot tell
// from a lost close. Only the source-transition and reply-observation
// consumers close or reopen an existing Review cycle.
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
import type {
  GoogleReplyHead,
  ReplyLookupPort,
  ReplyMilestones,
} from '../ports/reply-lookup.port'
import type {
  ReplyObservationAuthorityPort,
  ReplyObservationExpectation,
} from '../ports/reply-observation-authority.port'
import type { LoggerPort } from '#/shared/domain/logger.port'
import type {
  InboxItemId,
  OrganizationId,
  PropertyId,
  ReviewId,
} from '#/shared/domain/ids'
import type { InboxItem } from '../../domain/types'
import { createInboxItem as buildInboxItem } from '../../domain/constructors'
import { isAnsweringGoogleReply } from '../../domain/rules'

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
  /**
   * Of `created`, the items created closed because Google already shows a
   * reply answering the review. An existing item is never closed.
   */
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
  replyObservationAuthority: ReplyObservationAuthorityPort
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

/** Reply milestones and Google reply heads for one bounded batch of reviews. */
type ReplyTruth = Readonly<{
  milestones: ReadonlyMap<string, ReplyMilestones>
  heads: ReadonlyMap<string, GoogleReplyHead>
}>

/**
 * The expectation to ask Review's exact-current permit for, when the head
 * read for a missing review shows a reply answering the revision its item
 * opens on. A hint only: the permit decides, under Review's fence.
 */
function answeringReplyExpectation(
  organizationId: OrganizationId,
  src: ReviewSourceMeta,
  head: GoogleReplyHead | undefined,
): ReplyObservationExpectation | null {
  if (
    head === undefined ||
    !isAnsweringGoogleReply(head) ||
    head.sourceEpoch !== src.sourceEpoch ||
    head.materialReviewRevision !== src.materialReviewRevision
  ) {
    return null
  }
  return {
    organizationId,
    propertyId: head.propertyId,
    reviewId: head.reviewId,
    observationRevision: head.observationRevision,
    sourceEpoch: head.sourceEpoch,
    materialReviewRevision: head.materialReviewRevision,
    change: head.change,
    resolution: head.resolution,
    provenance: head.provenance,
    matchedReplyId: head.matchedReplyId,
    matchedPublicationCycle: head.matchedPublicationCycle,
    occurredAt: head.observedAt,
  }
}

/**
 * Create the item closed inside Review's permit. Null when the permit is
 * obsolete: Google's reply moved after it was read, and the newer
 * observation's own fact reaches the item once it exists.
 */
async function createAnsweredOnGoogle(
  deps: RebuildInboxProjectionDeps,
  item: InboxItem,
  anchor: Readonly<{ materialReviewRevision: number }>,
  expectation: ReplyObservationExpectation,
): Promise<Readonly<{ created: boolean }> | null> {
  const result = await deps.replyObservationAuthority.withExactCurrent(
    expectation,
    (permit) => deps.commandStore.createReviewItemAnsweredOnGoogle(item, anchor, permit),
  )
  if (result.status === 'current') return result.value
  deps.logger.info(
    {},
    'rebuildInboxProjection: the Google reply changed since it was read; creating the item open',
  )
  return null
}

/**
 * Pass B, one review: materialize metadata plus an initial cycle, closed when
 * Google already answers the review. A review without a stable material
 * revision, or one the constructor rejects, is reported and skipped rather
 * than guessed at.
 */
async function materializeMissingItem(
  deps: RebuildInboxProjectionDeps,
  input: RebuildInboxProjectionInput,
  src: ReviewSourceMeta,
  truth: ReplyTruth,
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

  const reply = truth.milestones.get(src.id as string)
  const item: InboxItem = {
    ...built.value,
    status: 'open',
    closedAt: null,
    firstReplySubmittedAt: reply?.firstSubmittedAt ?? null,
    firstReplyPublishedAt: reply?.firstPublishedAt ?? null,
  }
  const anchor = { materialReviewRevision: src.materialReviewRevision }
  const answered = answeringReplyExpectation(
    input.organizationId,
    src,
    truth.heads.get(src.id as string),
  )

  counters.created += 1
  if (item.firstReplySubmittedAt ?? item.firstReplyPublishedAt) {
    counters.milestones += 1
  }
  if (input.dryRun) {
    if (answered) counters.closed += 1
    return
  }
  if (answered) {
    const result = await createAnsweredOnGoogle(deps, item, anchor, answered)
    if (result?.created) counters.closed += 1
    if (result) return
  }
  // Idempotent create, NO created/status fact — rebuild is repair, not
  // new information; the durable record is this report.
  await deps.commandStore.createItem(item, null, anchor)
}

/**
 * Pass B: canonical reviews with no inbox item. Reply milestones and Google
 * reply heads resolve in bounded chunks. Expiry and historical Reply
 * milestones never decide a handling outcome; only Review's exact-current
 * permit for a reply Google shows does.
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
    const ids = batch.map((source) => source.id)
    const [milestones, heads] = await Promise.all([
      deps.replyLookup.getReplyMilestonesByReviewIds(ids, input.organizationId),
      deps.replyLookup.getGoogleReplyHeadsByReviewIds(ids, input.organizationId),
    ])

    for (const src of batch) {
      await materializeMissingItem(deps, input, src, { milestones, heads }, counters)
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
