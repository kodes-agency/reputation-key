// Inbox context — the manager Handling History record and its ordering rule
// (IBX-01-T5).
//
// Handling work is written to five append-only tables — cycle openings, cycle
// transitions, assignment decisions, escalation decisions and private-feedback
// outcomes. A manager does not think in five tables; they think in one story.
// This module owns the merged record and, crucially, the ONE total order that
// story is told in. Recent Activity is explicitly never evidence that an Inbox
// command committed (src/contexts/inbox/CONTEXT.md), so nothing here is derived
// from it.
//
// Everything below is pure: no clock, no locale, no I/O.

import type { InboxItemId, UserId } from '#/shared/domain/ids'
import type {
  FeedbackHandlingDeadlineResult,
  PrivateFeedbackHandlingOutcome,
} from './feedback-handling'
import type {
  HandlingCycleActorType,
  HandlingCycleOpenReason,
  HandlingCycleTransitionKind,
  ManualReopenReason,
} from './types'

export const INBOX_HISTORY_KINDS = [
  'cycle_opened',
  'cycle_transition',
  'assignment',
  'escalation',
  'handling_outcome',
] as const

export type InboxHistoryKind = (typeof INBOX_HISTORY_KINDS)[number]

export type InboxAssignmentReason =
  'claim' | 'assign' | 'reassign' | 'release' | 'eligibility_lost' | 'reopen_restore'

export type InboxHistoryCycleOpenedDetail = Readonly<{
  kind: 'cycle_opened'
  openedReason: HandlingCycleOpenReason
  manualReopenReason: ManualReopenReason | null
  /** Manager free text; only ever present on a manual reopen. */
  manualReopenExplanation: string | null
  supersedesCycleNumber: number | null
  sourceRevision: number
}>

export type InboxHistoryCycleTransitionDetail = Readonly<{
  kind: 'cycle_transition'
  transition: HandlingCycleTransitionKind
  transitionReason: string
  actorType: HandlingCycleActorType
}>

export type InboxHistoryAssignmentDetail = Readonly<{
  kind: 'assignment'
  reason: InboxAssignmentReason
  previousAssignee: UserId | null
  nextAssignee: UserId | null
  previousAssigneeDisplayName: string | null
  nextAssigneeDisplayName: string | null
  bulkId: string | null
}>

export type InboxHistoryEscalationDetail = Readonly<{
  kind: 'escalation'
  escalation: 'escalated' | 'resolved'
}>

export type InboxHistoryOutcomeDetail = Readonly<{
  kind: 'handling_outcome'
  outcome: PrivateFeedbackHandlingOutcome
  outcomeRevision: number
  deadlineResult: FeedbackHandlingDeadlineResult
  completionAt: Date
  supersedesOutcomeId: string | null
  /**
   * Manager-internal text. The key is ABSENT — not null, not an empty string —
   * whenever the caller is not currently allowed to read it, so an unauthorized
   * reader cannot infer that a note exists, nor how long it is.
   */
  internalNote?: string
}>

export type InboxHistoryDetail =
  | InboxHistoryCycleOpenedDetail
  | InboxHistoryCycleTransitionDetail
  | InboxHistoryAssignmentDetail
  | InboxHistoryEscalationDetail
  | InboxHistoryOutcomeDetail

export type InboxHistoryEntry = Readonly<{
  /** Stable across replays: derived from the append-only row's own key. */
  id: string
  inboxItemId: InboxItemId
  kind: InboxHistoryKind
  occurredAt: Date
  cycleNumber: number | null
  stateRevision: number | null
  actorUserId: UserId | null
  actorDisplayName: string | null
  /**
   * A pre-cutover row that the cutover backfilled. It proves the episode
   * existed and nothing more: no actor, no outcome and no deadline result may
   * ever be inferred for it.
   */
  legacy: boolean
  detail: InboxHistoryDetail
}>

/**
 * The stable tie-break discriminator. Two rows can legitimately share an
 * instant — a close transition and the outcome it completes are written in one
 * transaction — so the order is pinned by what the rows MEAN, not by whichever
 * query returned first.
 */
const KIND_RANK: Readonly<Record<InboxHistoryKind, number>> = {
  cycle_opened: 0,
  cycle_transition: 1,
  assignment: 2,
  escalation: 3,
  handling_outcome: 4,
}

/**
 * An entry with no cycle number cannot be placed inside a cycle, so it sorts
 * after the cycle-bearing entries that share its instant.
 */
const NO_CYCLE = Number.MAX_SAFE_INTEGER

/**
 * An entry with no state revision is not "later than every transition" — it is
 * a fact recorded alongside the cycle rather than a step in the cycle's state
 * machine. The cycle's own opening row is the clearest case: it must precede
 * the `opened` transition it produced, not trail it. So absent sorts FIRST
 * within its cycle, and the kind discriminator settles the rest.
 */
const NO_STATE_REVISION = Number.MIN_SAFE_INTEGER

function compareText(left: string, right: string): number {
  // Plain code-unit comparison, never `localeCompare`: host locale collation
  // would make two machines disagree about the same history. Entry ids are
  // generated from ASCII row keys, so code-unit order is byte order here.
  if (left === right) return 0
  return left < right ? -1 : 1
}

export function compareInboxHistoryEntries(
  left: InboxHistoryEntry,
  right: InboxHistoryEntry,
): number {
  const byInstant = left.occurredAt.getTime() - right.occurredAt.getTime()
  if (byInstant !== 0) return byInstant
  const byCycle = (left.cycleNumber ?? NO_CYCLE) - (right.cycleNumber ?? NO_CYCLE)
  if (byCycle !== 0) return byCycle
  const byState =
    (left.stateRevision ?? NO_STATE_REVISION) - (right.stateRevision ?? NO_STATE_REVISION)
  if (byState !== 0) return byState
  const byKind = KIND_RANK[left.kind] - KIND_RANK[right.kind]
  if (byKind !== 0) return byKind
  return compareText(left.id, right.id)
}

/** Merge every source into one ordered stream. Returns a new array. */
export function orderInboxHistory(
  entries: readonly InboxHistoryEntry[],
): readonly InboxHistoryEntry[] {
  return [...entries].sort(compareInboxHistoryEntries)
}

/**
 * A legacy row carries no actor and no manager display name. Stripping it here
 * rather than at the edge means no renderer can accidentally invent one.
 */
export function redactLegacyActor(entry: InboxHistoryEntry): InboxHistoryEntry {
  if (!entry.legacy) return entry
  return { ...entry, actorUserId: null, actorDisplayName: null }
}
