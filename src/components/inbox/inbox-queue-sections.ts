// Who sees which queues, in which order, and where a viewer lands. The rail and
// the phone's queue sheet draw the same sections from here (ADR 0057, amended
// 2026-10-28), so a section can never be on one and missing from the other.
import type {
  InboxQueue,
  InboxQueueCounts,
} from '#/contexts/inbox/application/public-api'
import {
  queueCount,
  queueItem,
  queueKind,
  type InboxKind,
  type InboxQueueItem,
} from './inbox-queues'

/**
 * What decides the rail. `canManageReplies` is whether reply stages are
 * available here, as the server answers for the scope in view
 * (`resolveReplyStages`): they need `reply.manage` and the reply publication
 * capability. Each kind needs its own read permission, so a viewer who may not
 * read private feedback is never shown a section for it.
 */
export type InboxQueueViewer = Readonly<{
  canManageReplies: boolean
  canReadReviews: boolean
  canReadFeedback: boolean
}>

export type InboxQueueSection = Readonly<{
  id: 'reviews' | 'feedback' | 'shared'
  /** Null for the shared views: they sit apart, below a separator, with no heading. */
  heading: string | null
  /** The kind the section holds; its glyph leads the heading. Null for the shared views. */
  kind: InboxKind | null
  queues: ReadonlyArray<InboxQueueItem>
}>

const items = (viewer: InboxQueueViewer, keys: ReadonlyArray<InboxQueue>) =>
  keys.map((key) => queueItem(key, viewer.canManageReplies))

function reviewQueues(viewer: InboxQueueViewer): ReadonlyArray<InboxQueue> {
  // Without reply stages the three stages collapse into the one row of open Reviews.
  return viewer.canManageReplies
    ? ['reply', 'approval', 'waiting', 'replied']
    : ['reply', 'replied']
}

/**
 * The rail, top to bottom: Reviews, Private feedback, then the shared views.
 * A section appears only for a kind the viewer can read, and "All open" only
 * when both are visible (with one kind it would repeat that kind's open queue).
 */
export function railSections(viewer: InboxQueueViewer): ReadonlyArray<InboxQueueSection> {
  const bothKinds = viewer.canReadReviews && viewer.canReadFeedback
  const sections: InboxQueueSection[] = []
  if (viewer.canReadReviews) {
    sections.push({
      id: 'reviews',
      heading: 'Reviews',
      kind: 'review',
      queues: items(viewer, reviewQueues(viewer)),
    })
  }
  if (viewer.canReadFeedback) {
    sections.push({
      id: 'feedback',
      heading: 'Private feedback',
      kind: 'feedback',
      queues: items(viewer, ['feedback', 'handled']),
    })
  }
  sections.push({
    id: 'shared',
    heading: null,
    kind: null,
    queues: items(
      viewer,
      bothKinds ? ['mine', 'escalated', 'open'] : ['mine', 'escalated'],
    ),
  })
  return sections
}

/** Every queue the viewer's rail lists. */
function availableQueues(viewer: InboxQueueViewer): ReadonlySet<InboxQueue> {
  return new Set(
    railSections(viewer).flatMap((section) => section.queues.map((queue) => queue.key)),
  )
}

/** The first row of the first section: Needs reply for a manager, "Open" without stages. */
export function defaultInboxQueue(viewer: InboxQueueViewer): InboxQueue {
  return railSections(viewer)[0]?.queues[0]?.key ?? 'mine'
}

/**
 * The queue to show for an address: the one it names if the viewer's rail lists
 * it, else the default. The retired `closed` key is read as `replied`; the URL
 * boundary does that for an address, this keeps a caller that holds the key honest.
 */
export function resolveInboxQueue(
  requested: InboxQueue | undefined,
  viewer: InboxQueueViewer,
): InboxQueue {
  const queue = requested === 'closed' ? 'replied' : requested
  return queue !== undefined && availableQueues(viewer).has(queue)
    ? queue
    : defaultInboxQueue(viewer)
}

type InboxQueueShortcut = Readonly<{ item: InboxQueueItem; count: number }>

/**
 * The phone's chip beside the queue button: the other kind's open queue, with
 * its count. "To handle" from a Reviews queue; "Needs reply" ("Open" without
 * stages) from a feedback queue. Only when that queue has items and its section
 * is visible; never from the shared views, which already hold both kinds.
 */
export function otherKindShortcut(
  queue: InboxQueue,
  viewer: InboxQueueViewer,
  counts: InboxQueueCounts | undefined,
): InboxQueueShortcut | null {
  const kind = queueKind(queue)
  if (kind === null) return null
  const target: InboxQueue = kind === 'review' ? 'feedback' : 'reply'
  const targetVisible = kind === 'review' ? viewer.canReadFeedback : viewer.canReadReviews
  const count = queueCount(counts, target)
  if (!targetVisible || count === null || count <= 0) return null
  return { item: queueItem(target, viewer.canManageReplies), count }
}
