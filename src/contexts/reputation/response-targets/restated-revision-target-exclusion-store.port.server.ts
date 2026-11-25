import type { InboxItemId, OrganizationId, PropertyId } from '#/shared/domain/ids'

/**
 * A Material Review Revision Review says Google only restated. Inbox never reads
 * Review tables, so the operator command hands Review's list in.
 */
export type RestatedRevisionRef = Readonly<{
  reviewId: string
  revision: number
}>

/** The Property an exclusion run is about, and the Organization that owns it. */
export type ExclusionScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
}>

export type ExclusionItemStatus = 'open' | 'closed'

/** Where the cycle's Response Target stands: still running, or how it ended. */
export type ExclusionTargetState = 'open' | 'on_time' | 'late' | 'cancelled'

/**
 * One Handling Cycle the command would leave out of reporting: opened as
 * `material_revision_changed` on a restated revision, with a measured Google
 * Response Target and no exclusion yet. Identifiers, numbers and states only.
 */
export type ExclusionCandidate = Readonly<{
  inboxItemId: InboxItemId
  cycleNumber: number
  reviewId: string
  revision: number
  itemStatus: ExclusionItemStatus
  targetState: ExclusionTargetState
  /** Reminder slots of the cycle that have been neither delivered nor cancelled. */
  pendingReminderSlots: number
}>

export type RestatedRevisionExclusionScan = Readonly<{
  scope: ExclusionScope
  candidates: ReadonlyArray<ExclusionCandidate>
}>

/** What the operator trail records beside each exclusion row. */
export type ExclusionAudit = Readonly<{
  operatorId: string
  ticket: string | null
  correlationId: string
  at: Date
}>

export type CandidateExclusionOutcome =
  | 'excluded'
  | 'already_excluded'
  /** The cycle is no longer the one recorded for that revision, or its item is gone. */
  | 'refused_cycle_changed'
  | 'refused_target_not_measured'

export type CandidateExclusionResult = Readonly<{
  inboxItemId: InboxItemId
  cycleNumber: number
  outcome: CandidateExclusionOutcome
  cancelledReminderSlots: number
}>

/**
 * Inbox-owned operator capability: leave the Response Targets of restated
 * revisions out of every count (migration 0069). Each write is one item per
 * transaction in the lock order head, item, target, reminders; it moves no
 * `state_revision` or `command_revision` and touches no cycle, transition,
 * target, item or notification.
 */
export type RestatedRevisionTargetExclusions = Readonly<{
  /** The Organization that owns the Property, or null when no Property has that id. */
  findProperty(propertyId: string): Promise<ExclusionScope | null>
  scan(
    input: Readonly<{
      scope: ExclusionScope
      restated: ReadonlyArray<RestatedRevisionRef>
    }>,
  ): Promise<RestatedRevisionExclusionScan>
  apply(
    input: Readonly<{
      scope: ExclusionScope
      candidates: ReadonlyArray<ExclusionCandidate>
      audit: ExclusionAudit
    }>,
  ): Promise<ReadonlyArray<CandidateExclusionResult>>
}>
