// Notification context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { can } from '#/shared/domain/permissions'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { z } from 'zod'

// ── getUnreadNotificationCountFn ──────────────────────────────────

export const getUnreadNotificationCountFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      if (!can(ctx.role, 'inbox.read')) {
        throwContextError(
          'AuthError',
          { code: 'forbidden', message: 'No inbox read permission' },
          403,
        )
      }
      try {
        const { notificationPublicApi } = getContainer()
        const count = await notificationPublicApi.getUnreadCount(ctx.userId)
        return { count }
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'GET',
    'notification.getUnreadCount',
  ),
)

// ── getNotificationsFn ────────────────────────────────────────────

const getNotificationsDto = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  offset: z.coerce.number().min(0).optional().default(0),
})

export const getNotificationsFn = createServerFn({ method: 'GET' })
  .inputValidator(getNotificationsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'inbox.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox read permission' },
            403,
          )
        }
        try {
          const { notificationPublicApi } = getContainer()
          return notificationPublicApi.getNotifications(
            ctx.userId,
            data.limit,
            data.offset,
          )
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'GET',
      'notification.getNotifications',
    ),
  )

// ── markNotificationReadFn ────────────────────────────────────────

const markNotificationReadDto = z.object({
  notificationId: z.string(),
})

export const markNotificationReadFn = createServerFn({ method: 'POST' })
  .inputValidator(markNotificationReadDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        if (!can(ctx.role, 'inbox.read')) {
          throwContextError(
            'AuthError',
            { code: 'forbidden', message: 'No inbox read permission' },
            403,
          )
        }
        try {
          const { notificationPublicApi } = getContainer()
          return notificationPublicApi.markRead(data.notificationId, ctx.organizationId)
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'POST',
      'notification.markRead',
    ),
  )

// ── markAllNotificationsReadFn ────────────────────────────────────

export const markAllNotificationsReadFn = createServerFn({ method: 'POST' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      if (!can(ctx.role, 'inbox.read')) {
        throwContextError(
          'AuthError',
          { code: 'forbidden', message: 'No inbox read permission' },
          403,
        )
      }
      try {
        const { notificationPublicApi } = getContainer()
        return notificationPublicApi.markAllRead(ctx.userId)
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'POST',
    'notification.markAllRead',
  ),
)
