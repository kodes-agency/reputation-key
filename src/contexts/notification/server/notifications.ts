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
import type { AuthContext } from '#/shared/domain/auth-context'

// Resolve tenant context, tolerating "no active org" (a new user with no
// org selected). Returns null in that case; re-throws every other error.
const resolveOptionalTenantContext = async (): Promise<AuthContext | null> => {
  const headers = await headersFromContext()
  return resolveTenantContext(headers).catch((e: unknown) => {
    if (
      e instanceof Error &&
      'code' in e &&
      (e as { code: string }).code === 'no_active_org'
    )
      return null
    throw e
  })
}

// ── getUnreadNotificationCountFn ──────────────────────────────────

export const getUnreadNotificationCountFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      // No active org → empty result (new user hasn't selected an org yet).
      const ctx = await resolveOptionalTenantContext()
      if (!ctx) return { count: 0 }
      if (!can(ctx.role, 'inbox.read')) {
        throwContextError(
          'AuthError',
          { code: 'forbidden', message: 'No inbox read permission' },
          403,
        )
      }
      try {
        const { notificationPublicApi } = getContainer()
        const count = await notificationPublicApi.getUnreadCount(
          ctx.userId,
          ctx.organizationId,
        )
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
        const ctx = await resolveOptionalTenantContext()
        if (!ctx) return []
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
            ctx.organizationId,
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
  notificationId: z.string().uuid(),
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
          // R2-H5: Verify notification belongs to current user before marking read
          const notification = await notificationPublicApi.findById(
            data.notificationId,
            ctx.organizationId,
          )
          if (!notification || notification.userId !== ctx.userId) {
            throwContextError(
              'AuthError',
              { code: 'forbidden', message: 'Notification not found or access denied' },
              403,
            )
          }
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
        return notificationPublicApi.markAllRead(ctx.userId, ctx.organizationId)
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'POST',
    'notification.markAllRead',
  ),
)

// ── dismissNotificationFn ─────────────────────────────────────────

const dismissNotificationDto = z.object({
  notificationId: z.string().uuid(),
})

export const dismissNotificationFn = createServerFn({ method: 'POST' })
  .inputValidator(dismissNotificationDto)
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
          // Verify notification belongs to current user before dismissing
          const notification = await notificationPublicApi.findById(
            data.notificationId,
            ctx.organizationId,
          )
          if (!notification || notification.userId !== ctx.userId) {
            throwContextError(
              'AuthError',
              { code: 'forbidden', message: 'Notification not found or access denied' },
              403,
            )
          }
          return notificationPublicApi.dismiss(data.notificationId, ctx.organizationId)
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'POST',
      'notification.dismiss',
    ),
  )

// ── getNotificationPreferencesFn ──────────────────────────────────

/** @public Staged RPC entry point — consumed by the preferences settings UI (not yet wired). */
export const getNotificationPreferencesFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const ctx = await resolveOptionalTenantContext()
      if (!ctx) return []
      if (!can(ctx.role, 'inbox.read')) {
        throwContextError(
          'AuthError',
          { code: 'forbidden', message: 'No inbox read permission' },
          403,
        )
      }
      try {
        const { notificationPublicApi } = getContainer()
        return notificationPublicApi.getPreferences(ctx.userId, ctx.organizationId)
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'GET',
    'notification.getPreferences',
  ),
)

// ── updateNotificationPreferenceFn ────────────────────────────────

const NOTIFICATION_TYPES = [
  'review.created',
  'feedback.created',
  'reply.pending_approval',
  'reply.approved',
  'reply.rejected',
  'reply.published',
  'reply.publish_failed',
  'inbox.escalated',
  'inbox.assigned',
  'inbox_note.added',
  'goal.completed',
  'badge.awarded',
] as const

const updateNotificationPreferenceDto = z.object({
  type: z.enum(NOTIFICATION_TYPES),
  emailEnabled: z.boolean(),
  inAppEnabled: z.boolean(),
})

/** @public Staged RPC entry point — consumed by the preferences settings UI (not yet wired). */
export const updateNotificationPreferenceFn = createServerFn({ method: 'POST' })
  .inputValidator(updateNotificationPreferenceDto)
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
          return notificationPublicApi.updatePreference(
            ctx.userId,
            ctx.organizationId,
            data.type,
            data.emailEnabled,
            data.inAppEnabled,
          )
        } catch (e) {
          throw catchUntagged(e)
        }
      },
      'POST',
      'notification.updatePreference',
    ),
  )
