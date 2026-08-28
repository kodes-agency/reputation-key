import type { InboxItemId, OrganizationId, UserId } from '#/shared/domain/ids'
import type { HandlingCycleCloseReason, InboxItem } from '../../domain/types'
import type {
  FeedbackHandlingOutcomeFact,
  PrivateFeedbackHandlingOutcome,
} from '../../domain/feedback-handling'

export type FeedbackHandlingExpectation = Readonly<{
  commandRevision: number
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
}>

export type FeedbackHandlingCorrectionExpectation = FeedbackHandlingExpectation &
  Readonly<{
    outcomeRevision: number
    outcomeId: string
  }>

export type FeedbackHandlingState = Readonly<{
  cycleNumber: number
  sourceRevision: number
  stateRevision: number
  status: 'open' | 'closed'
  closeReason: HandlingCycleCloseReason | null
  currentOutcome: FeedbackHandlingOutcomeFact | null
  history: ReadonlyArray<FeedbackHandlingOutcomeFact>
}>

export type FeedbackHandlingCommandResult = Readonly<{
  item: InboxItem
  feedbackHandling: FeedbackHandlingState
}>

type OutcomeInput = Readonly<{
  item: InboxItem
  outcomeId: string
  outcome: PrivateFeedbackHandlingOutcome
  internalNote: string | null
  actorUserId: UserId
  recordedAt: Date
}>

export type FeedbackHandlingStore = Readonly<{
  getState(
    inboxItemId: InboxItemId,
    organizationId: OrganizationId,
  ): Promise<FeedbackHandlingState | null>
  markHandled(
    command: OutcomeInput & Readonly<{ expected: FeedbackHandlingExpectation }>,
  ): Promise<FeedbackHandlingCommandResult>
  correctOutcome(
    command: OutcomeInput & Readonly<{ expected: FeedbackHandlingCorrectionExpectation }>,
  ): Promise<FeedbackHandlingCommandResult>
}>
