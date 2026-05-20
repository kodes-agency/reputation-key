// Inbox context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { match } from 'ts-pattern'
import { getContainer } from '#/composition'
import { throwContextError } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import {
  getInboxItemsDto,
  updateStatusDto,
  bulkUpdateStatusDto,
  assignInboxItemDto,
  addInboxNoteDto,
  getUnreadCountDto,
  getInboxItemDetailDto,
  getInboxNotesDto,
} from '../application/dto/inbox.dto'
import { isInboxError } from '../domain/errors'
import type { InboxErrorCode } from '../domain/errors'
import { inboxItemId, propertyId } from '#/shared/domain/ids'
import { userId as toUserId } from '#/shared/domain/ids'

// ── Error → HTTP status mapping (exhaustive) ──────────────────────

const inboxErrorStatus = (code: InboxErrorCode): number =>
  match(code)
    .with('invalid_transition', 'invalid_input', 'assignment_not_allowed', () => 400)
    .with('not_found', () => 404)
    .with('forbidden', () => 403)
    .with('already_exists', () => 409)
    .with('bulk_partial_failure', () => 207)
    .exhaustive()

// ── getInboxItems ──────────────────────────────────────────────────

export const getInboxItemsFn = createServerFn({ method: 'GET' })
  .inputValidator(getInboxItemsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.getInboxItems({
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
            filters: {
              propertyId: data.propertyId ? propertyId(data.propertyId) : undefined,
              status: data.status,
              sourceType: data.sourceType,
              platform: data.platform,
              ratingMin: data.ratingMin,
              ratingMax: data.ratingMax,
              sourceDateFrom: data.sourceDateFrom,
              sourceDateTo: data.sourceDateTo,
            },
            cursor: data.cursor
              ? (() => {
                  try {
                    return JSON.parse(
                      Buffer.from(data.cursor, 'base64').toString('utf-8'),
                    )
                  } catch {
                    return undefined // ignore malformed cursor — treat as first page
                  }
                })()
              : undefined,
            limit: data.limit,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'inbox.getInboxItems',
    ),
  )

// ── updateInboxStatus ──────────────────────────────────────────────

export const updateInboxStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(updateStatusDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.updateInboxStatus({
            inboxItemId: inboxItemId(data.inboxItemId),
            organizationId: ctx.organizationId,
            newStatus: data.status,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'inbox.updateInboxStatus',
    ),
  )

// ── bulkUpdateInboxStatus ──────────────────────────────────────────

export const bulkUpdateInboxStatusFn = createServerFn({ method: 'POST' })
  .inputValidator(bulkUpdateStatusDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.bulkUpdateInboxStatus({
            inboxItemIds: data.inboxItemIds.map((id) => inboxItemId(id)),
            organizationId: ctx.organizationId,
            newStatus: data.status,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'inbox.bulkUpdateInboxStatus',
    ),
  )

// ── assignInboxItem ────────────────────────────────────────────────

export const assignInboxItemFn = createServerFn({ method: 'POST' })
  .inputValidator(assignInboxItemDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.assignInboxItem({
            inboxItemId: inboxItemId(data.inboxItemId),
            organizationId: ctx.organizationId,
            assignedToUserId: data.assignedToUserId
              ? toUserId(data.assignedToUserId)
              : null,
            role: ctx.role,
            userId: ctx.userId,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'inbox.assignInboxItem',
    ),
  )

// ── addInboxNote ───────────────────────────────────────────────────

export const addInboxNoteFn = createServerFn({ method: 'POST' })
  .inputValidator(addInboxNoteDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.addInboxNote({
            inboxItemId: inboxItemId(data.inboxItemId),
            organizationId: ctx.organizationId,
            authorUserId: ctx.userId,
            text: data.text,
            role: ctx.role,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw e
        }
      },
      'POST',
      'inbox.addInboxNote',
    ),
  )

// ── getUnreadCount ─────────────────────────────────────────────────

export const getUnreadCountFn = createServerFn({ method: 'GET' })
  .inputValidator(getUnreadCountDto)
  .handler(
    tracedHandler(
      async ({ data: _data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.getUnreadCount({
            organizationId: ctx.organizationId,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'inbox.getUnreadCount',
    ),
  )

// ── getInboxItemDetail ─────────────────────────────────────────────

export const getInboxItemDetailFn = createServerFn({ method: 'GET' })
  .inputValidator(getInboxItemDetailDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.getInboxItemDetail({
            inboxItemId: inboxItemId(data.inboxItemId),
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'inbox.getInboxItemDetail',
    ),
  )

// ── getInboxNotes ──────────────────────────────────────────────────

export const getInboxNotesFn = createServerFn({ method: 'GET' })
  .inputValidator(getInboxNotesDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const { useCases } = getContainer()
        try {
          return await useCases.getInboxNotes({
            inboxItemId: inboxItemId(data.inboxItemId),
            organizationId: ctx.organizationId,
            userId: ctx.userId,
            role: ctx.role,
          })
        } catch (e) {
          if (isInboxError(e))
            throwContextError('InboxError', e, inboxErrorStatus(e.code))
          throw e
        }
      },
      'GET',
      'inbox.getInboxNotes',
    ),
  )
