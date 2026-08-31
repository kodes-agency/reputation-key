import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type {
  HandlingCycleHead,
  ManualReopenReason,
  ReviewHandlingCycle,
  ReviewHandlingCycleHead,
} from '../../domain/types'
import type { ReviewCycleTargetAnchor } from './review-response-target-authority.port'

export type ReviewHandlingCycleExpectation = Readonly<{
  cycleNumber: number
  materialReviewRevision: number
  stateRevision: number
}>

export type HandlingCycleExpectation = Readonly<{
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
}>

export type StartNextReviewHandlingCycleCommand = Readonly<{
  inboxItemId: InboxItemId
  organizationId: OrganizationId
  expected: ReviewHandlingCycleExpectation
  materialReviewRevision: number
  openedReason:
    | 'material_revision_changed'
    | 'manual_reopen'
    | 'provider_reply_deleted'
    | 'provider_reply_diverged'
  manualReopenReason?: ManualReopenReason
  manualReopenExplanation?: string | null
  openedBy: UserId | null
  openedAt: Date
  responseTarget: ReviewCycleTargetAnchor
}>

export type ReviewHandlingCycleResult = Readonly<{
  cycle: ReviewHandlingCycle
  head: ReviewHandlingCycleHead
}>

export type ReviewHandlingCycleStore = Readonly<{
  findSourceHead?(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<HandlingCycleHead | null>
  findHead(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<ReviewHandlingCycleHead | null>
  listCycles(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<ReadonlyArray<ReviewHandlingCycle>>
  startNext(
    command: StartNextReviewHandlingCycleCommand,
  ): Promise<ReviewHandlingCycleResult>
}>
