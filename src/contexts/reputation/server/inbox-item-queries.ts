import { storedReplyFrame } from '#/shared/domain/reply-frame'
import { mapReplyLanguageMetadata } from '#/shared/reply-language-catalogue'
import { reviewId } from '#/shared/domain/ids'
import type { InboxItemDetailResult } from '../public-api'
// Inbox context — item detail query server functions

import { getExecutionPolicy } from '#/shared/auth/execution-policy'
import { createServerFn } from '@tanstack/react-start'
import { inboxItemId } from '#/shared/domain/ids'
import { runInboxCommand } from './inbox-command'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import {
  getInboxItemDetailDto,
  getInboxItemHistoryDto,
  getInboxNotesDto,
} from '../inbox/contracts'

// ── getInboxItemDetail ─────────────────────────────────────────────

export const getInboxItemDetailFn = createServerFn({ method: 'GET' })
  .validator(getInboxItemDetailDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('inbox.read', async (inbox, ctx) => {
          const detail = await inbox.getInboxItemDetail(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
            },
            ctx,
          )
          const consent = await getContainer().aiPublicApi.readReplyDraftingConsent(
            {
              organizationId: ctx.organizationId,
              propertyId: detail.item.propertyId,
            },
            ctx,
          )
          const policy =
            consent &&
            (await getExecutionPolicy().decide({
              principal: { kind: 'user', ctx },
              action: 'ai.reply.generate',
              organizationId: ctx.organizationId,
              propertyId: detail.item.propertyId,
              executionKind: 'interactive',
              consent,
              now: getContainer().clock(),
            }))
          return {
            ...detail,
            replyDraftingAvailable: policy?.allowed ?? false,
            replyBodyFrame: await savedReplyBodyFrame(detail, ctx.organizationId),
          }
        }),
      'GET',
      'inbox.getInboxItemDetail',
    ),
  )

// ── getInboxNotes ──────────────────────────────────────────────────

export const getInboxNotesFn = createServerFn({ method: 'GET' })
  .validator(getInboxNotesDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('inbox.read', (inbox, ctx) =>
          inbox.getInboxNotes(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
            },
            ctx,
          ),
        ),
      'GET',
      'inbox.getInboxNotes',
    ),
  )

// ── getInboxItemHistory ────────────────────────────────────────────

export const getInboxItemHistoryFn = createServerFn({ method: 'GET' })
  .validator(getInboxItemHistoryDto)
  .handler(
    tracedHandler(
      ({ data }) =>
        runInboxCommand('inbox.read', (inbox, ctx) =>
          inbox.getInboxItemHistory(
            {
              inboxItemId: inboxItemId(data.inboxItemId),
            },
            ctx,
          ),
        ),
      'GET',
      'inbox.getInboxItemHistory',
    ),
  )

async function savedReplyBodyFrame(
  detail: InboxItemDetailResult,
  organizationId: import('#/shared/domain/ids').OrganizationId,
) {
  const reply = detail.reply
  if (
    !reply ||
    !('aiGenerated' in reply) ||
    !reply.aiGenerated ||
    !reply.voiceChoices ||
    !reply.voiceDigest
  )
    return null
  const stored = storedReplyFrame(reply.text, reply.voiceChoices)
  if (stored) return stored
  const language = mapReplyLanguageMetadata(reply.replyLanguageTag)
  if (language.status !== 'supported' || !language.language) return null
  return (
    getContainer().reviewPublicApi.aiReplyVoice.resolveSavedFrame?.({
      organizationId,
      propertyId: detail.item.propertyId,
      reviewId: reviewId(detail.item.sourceId),
      languageGroup: language.language.templateGroup,
      voiceDigest: reply.voiceDigest,
      choices: reply.voiceChoices,
      text: reply.text,
    }) ?? null
  )
}
