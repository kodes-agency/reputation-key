// Inbox context — source-specific private-feedback handling commands.

import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  correctFeedbackHandlingOutcomeDto,
  markFeedbackHandledDto,
} from '../inbox/contracts'
import { runInboxRevisionCommand } from './inbox-command'
import { createServerFn } from '@tanstack/react-start'
import { inboxItemId } from '#/shared/domain/ids'

export const markFeedbackHandledFn = createServerFn({ method: 'POST' })
  .validator(markFeedbackHandledDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxRevisionCommand('inbox.write', (inbox, ctx) =>
          inbox.markFeedbackHandled(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              expected: {
                commandRevision: data.expectedCommandRevision,
                cycleNumber: data.expectedCycleNumber,
                sourceRevision: data.expectedSourceRevision,
                stateRevision: data.expectedStateRevision,
              },
              outcome: data.outcome,
              internalNote: data.internalNote ?? null,
            },
            ctx,
          ),
        ),
      'POST',
      'inbox.markFeedbackHandled',
    ),
  )

export const correctFeedbackHandlingOutcomeFn = createServerFn({ method: 'POST' })
  .validator(correctFeedbackHandlingOutcomeDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxRevisionCommand('inbox.write', (inbox, ctx) =>
          inbox.correctFeedbackHandlingOutcome(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              expected: {
                commandRevision: data.expectedCommandRevision,
                cycleNumber: data.expectedCycleNumber,
                sourceRevision: data.expectedSourceRevision,
                stateRevision: data.expectedStateRevision,
                outcomeId: data.expectedOutcomeId,
                outcomeRevision: data.expectedOutcomeRevision,
              },
              outcome: data.outcome,
              internalNote: data.internalNote ?? null,
            },
            ctx,
          ),
        ),
      'POST',
      'inbox.correctFeedbackHandlingOutcome',
    ),
  )
