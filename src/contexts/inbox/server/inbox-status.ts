// Inbox context — status + escalation mutation server functions

import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import {
  createServerFn,
  isInboxError,
  inboxErrorStatus,
  inboxItemId,
} from './inbox-shared'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import {
  updateStatusDto,
  bulkUpdateStatusDto,
  escalateInboxItemDto,
  resolveEscalationDto,
} from '../application/dto/inbox.dto'

// ── updateInboxStatus ──────────────────────────────────────────────

export const updateInboxStatusFn = createServerFn({ method: 'POST' })
  .validator(updateStatusDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.updateInboxStatus(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              newStatus: data.status,
              expectedCommandRevision: data.expectedCommandRevision,
              reopenReason: data.reopenReason,
              reopenExplanation: data.reopenExplanation,
            },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.updateInboxStatus',
    ),
  )

// ── bulkUpdateInboxStatus ──────────────────────────────────────────

export const bulkUpdateInboxStatusFn = createServerFn({ method: 'POST' })
  .validator(bulkUpdateStatusDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.bulkUpdateInboxStatus(
            {
              items: data.items.map((item) => ({
                inboxItemId: inboxItemId(item.inboxItemId),
                expectedCommandRevision: item.expectedCommandRevision,
              })),
              newStatus: data.status,
              reopenReason: data.reopenReason,
              reopenExplanation: data.reopenExplanation,
            },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.bulkUpdateInboxStatus',
    ),
  )

// ── escalateInboxItem ──────────────────────────────────────────────

export const escalateInboxItemFn = createServerFn({ method: 'POST' })
  .validator(escalateInboxItemDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.escalateInboxItem(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              expectedCommandRevision: data.expectedCommandRevision,
            },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.escalateInboxItem',
    ),
  )

// ── resolveEscalation ──────────────────────────────────────────────

export const resolveEscalationFn = createServerFn({ method: 'POST' })
  .validator(resolveEscalationDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'inbox.write' })
        const { inboxPublicApi } = getContainer()
        try {
          return await inboxPublicApi.resolveEscalation(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              expectedCommandRevision: data.expectedCommandRevision,
            },
            ctx,
          )
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw catchUntagged(e)
        }
      },
      'POST',
      'inbox.resolveEscalation',
    ),
  )
