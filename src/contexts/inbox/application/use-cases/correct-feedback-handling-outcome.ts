import type { StaffPublicApi } from '#/contexts/staff/application/public-api'
import type { AuthContext } from '#/shared/domain/auth-context'
import type { InboxItemId } from '#/shared/domain/ids'
import { canForContext } from '#/shared/domain/permissions'
import type { PrivateFeedbackHandlingOutcome } from '../../domain/feedback-handling'
import { inboxError } from '../../domain/errors'
import {
  assertExpectedCommandRevision,
  assertInboxSourcePropertyAccessible,
  canHandleInboxSource,
  loadInboxItemOrThrow,
} from '../inbox-access'
import type {
  FeedbackHandlingCorrectionExpectation,
  FeedbackHandlingStore,
} from '../ports/feedback-handling.store'
import type { InboxRepository } from '../ports/inbox.repository'

export type CorrectFeedbackHandlingOutcomeInput = Readonly<{
  inboxItemId: InboxItemId
  expected: FeedbackHandlingCorrectionExpectation
  outcome: PrivateFeedbackHandlingOutcome
  internalNote: string | null
}>

export type CorrectFeedbackHandlingOutcomeDeps = Readonly<{
  repo: InboxRepository
  store: FeedbackHandlingStore
  staffPublicApi: StaffPublicApi
  clock: () => Date
  idGen: () => string
}>

export const correctFeedbackHandlingOutcome =
  (deps: CorrectFeedbackHandlingOutcomeDeps) =>
  async (input: CorrectFeedbackHandlingOutcomeInput, ctx: AuthContext) => {
    if (!canForContext(ctx, 'inbox.write') || !canHandleInboxSource(ctx, 'feedback')) {
      throw inboxError('forbidden', 'No permission to correct private feedback')
    }
    const item = await loadInboxItemOrThrow(
      deps.repo,
      input.inboxItemId,
      ctx.organizationId,
    )
    assertExpectedCommandRevision(item, input.expected.commandRevision)
    if (item.sourceType !== 'feedback') {
      throw inboxError(
        'invalid_input',
        'Handling outcome correction is available only for private feedback',
      )
    }
    await assertInboxSourcePropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'handle',
      'feedback',
      item.propertyId,
    )
    return deps.store.correctOutcome({
      item,
      expected: input.expected,
      outcomeId: deps.idGen(),
      outcome: input.outcome,
      internalNote: input.internalNote,
      actorUserId: ctx.userId,
      recordedAt: deps.clock(),
    })
  }

export type CorrectFeedbackHandlingOutcome = ReturnType<
  typeof correctFeedbackHandlingOutcome
>
