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
  FeedbackHandlingExpectation,
  FeedbackHandlingStore,
} from '../ports/feedback-handling.store'
import type { InboxRepository } from '../ports/inbox.repository'

export type MarkFeedbackHandledInput = Readonly<{
  inboxItemId: InboxItemId
  expected: FeedbackHandlingExpectation
  outcome: PrivateFeedbackHandlingOutcome
  internalNote: string | null
}>

export type MarkFeedbackHandledDeps = Readonly<{
  repo: InboxRepository
  store: FeedbackHandlingStore
  staffPublicApi: StaffPublicApi
  clock: () => Date
  idGen: () => string
}>

export const markFeedbackHandled =
  (deps: MarkFeedbackHandledDeps) =>
  async (input: MarkFeedbackHandledInput, ctx: AuthContext) => {
    if (!canForContext(ctx, 'inbox.write') || !canHandleInboxSource(ctx, 'feedback')) {
      throw inboxError('forbidden', 'No permission to handle private feedback')
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
        'Mark as handled is available only for private feedback',
      )
    }
    await assertInboxSourcePropertyAccessible(
      deps.staffPublicApi,
      ctx,
      'handle',
      'feedback',
      item.propertyId,
    )
    return deps.store.markHandled({
      item,
      expected: input.expected,
      outcomeId: deps.idGen(),
      outcome: input.outcome,
      internalNote: input.internalNote,
      actorUserId: ctx.userId,
      recordedAt: deps.clock(),
    })
  }

export type MarkFeedbackHandled = ReturnType<typeof markFeedbackHandled>
