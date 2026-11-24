// Inbox context — status + escalation mutation server functions

import { createServerFn } from '@tanstack/react-start'
import { inboxItemId } from '#/shared/domain/ids'
import { runInboxCommand, runInboxRevisionCommand } from './inbox-command'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import {
  updateStatusDto,
  bulkUpdateStatusDto,
  escalateInboxItemDto,
  resolveEscalationDto,
} from '../inbox/contracts'

// ── updateInboxStatus ──────────────────────────────────────────────

export const updateInboxStatusFn = createServerFn({ method: 'POST' })
  .validator(updateStatusDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxRevisionCommand('inbox.write', (inbox, ctx) =>
          inbox.updateInboxStatus(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              newStatus: data.status,
              expectedCommandRevision: data.expectedCommandRevision,
              reopenReason: data.reopenReason,
              reopenExplanation: data.reopenExplanation,
            },
            ctx,
          ),
        ),
      'POST',
      'inbox.updateInboxStatus',
    ),
  )

// ── bulkUpdateInboxStatus ──────────────────────────────────────────

export const bulkUpdateInboxStatusFn = createServerFn({ method: 'POST' })
  .validator(bulkUpdateStatusDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('inbox.write', (inbox, ctx) =>
          inbox.bulkUpdateInboxStatus(
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
          ),
        ),
      'POST',
      'inbox.bulkUpdateInboxStatus',
    ),
  )

// ── escalateInboxItem ──────────────────────────────────────────────

export const escalateInboxItemFn = createServerFn({ method: 'POST' })
  .validator(escalateInboxItemDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxRevisionCommand('inbox.write', (inbox, ctx) =>
          inbox.escalateInboxItem(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              expectedCommandRevision: data.expectedCommandRevision,
            },
            ctx,
          ),
        ),
      'POST',
      'inbox.escalateInboxItem',
    ),
  )

// ── resolveEscalation ──────────────────────────────────────────────

export const resolveEscalationFn = createServerFn({ method: 'POST' })
  .validator(resolveEscalationDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxRevisionCommand('inbox.write', (inbox, ctx) =>
          inbox.resolveEscalation(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
              expectedCommandRevision: data.expectedCommandRevision,
            },
            ctx,
          ),
        ),
      'POST',
      'inbox.resolveEscalation',
    ),
  )
