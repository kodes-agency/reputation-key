// Inbox context — source-specific private-feedback handling commands.

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  correctFeedbackHandlingOutcomeDto,
  markFeedbackHandledDto,
} from '../application/dto/inbox.dto'
import {
  createServerFn,
  inboxErrorStatus,
  inboxItemId,
  isInboxError,
} from './inbox-shared'

export const markFeedbackHandledFn = createServerFn({ method: 'POST' })
  .validator(markFeedbackHandledDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.markFeedbackHandled(
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
          )
        } catch (error) {
          if (isInboxError(error)) {
            throwContextError('InboxError', error, inboxErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'inbox.markFeedbackHandled',
    ),
  )

export const correctFeedbackHandlingOutcomeFn = createServerFn({ method: 'POST' })
  .validator(correctFeedbackHandlingOutcomeDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.correctFeedbackHandlingOutcome(
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
          )
        } catch (error) {
          if (isInboxError(error)) {
            throwContextError('InboxError', error, inboxErrorStatus(error.code))
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'inbox.correctFeedbackHandlingOutcome',
    ),
  )
