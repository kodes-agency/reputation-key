// Notification context — server functions
// Per architecture: "Server functions are the HTTP entry points into a context."
// Resolves tenant context from authenticated session, NOT from client payload.

import { createServerFn } from '@tanstack/react-start'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { getContainer } from '#/composition'
import { requireExecutionAllowed } from '#/shared/auth/execution-policy'
import { throwContextError, catchUntagged } from '#/shared/auth/server-errors'
import { headersFromContext } from '#/shared/auth/headers'
import { resolveTenantContext } from '#/shared/auth/middleware'
import { z } from 'zod/v4'
import { isNotificationError, NOTIFICATION_LIST_FILTERS } from '../application/public-api'
import { requiredCapabilityForPreferenceChannel } from '../domain/notification-delivery-policy'
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
      await requireExecutionAllowed({ actor: ctx, action: 'notification.read' })
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
  filter: z.enum(NOTIFICATION_LIST_FILTERS).optional().default('all'),
})

export const getNotificationsFn = createServerFn({ method: 'GET' })
  .validator(getNotificationsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveOptionalTenantContext()
        if (!ctx) return []
        await requireExecutionAllowed({ actor: ctx, action: 'notification.read' })
        try {
          const { notificationPublicApi } = getContainer()
          return notificationPublicApi.getNotifications(
            ctx.userId,
            ctx.organizationId,
            data.limit,
            data.offset,
            data.filter,
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
  notificationId: z.uuid(),
})

export const markNotificationReadFn = createServerFn({ method: 'POST' })
  .validator(markNotificationReadDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'notification.update' })
        try {
          const { notificationPublicApi } = getContainer()
          return notificationPublicApi.markRead(
            data.notificationId,
            ctx.organizationId,
            ctx.userId,
          )
        } catch (e) {
          if (isNotificationError(e)) {
            throwContextError('NotificationError', e, e.code === 'not_found' ? 404 : 500)
          }
          throw catchUntagged(e)
        }
      },
      'POST',
      'notification.markRead',
    ),
  )

// ── markNotificationUnreadFn ──────────────────────────────────────

const markNotificationUnreadDto = z.object({
  notificationId: z.uuid(),
})

/**
 * Read -> unread, the inverse of markNotificationReadFn.
 *
 * Resolves to the flipped notification, or `null` when the flip is a no-op
 * because another unread row already covers the same (user, type, resource)
 * under ADR 0046 r.2's partial unique key. Callers refetch either way; this
 * never surfaces a unique-violation as a 500.
 */
export const markNotificationUnreadFn = createServerFn({ method: 'POST' })
  .validator(markNotificationUnreadDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'notification.update' })
        try {
          const { notificationPublicApi } = getContainer()
          return notificationPublicApi.markUnread(
            data.notificationId,
            ctx.organizationId,
            ctx.userId,
          )
        } catch (e) {
          if (isNotificationError(e)) {
            throwContextError('NotificationError', e, e.code === 'not_found' ? 404 : 500)
          }
          throw catchUntagged(e)
        }
      },
      'POST',
      'notification.markUnread',
    ),
  )

// ── markAllNotificationsReadFn ────────────────────────────────────

export const markAllNotificationsReadFn = createServerFn({ method: 'POST' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      await requireExecutionAllowed({ actor: ctx, action: 'notification.update' })
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

// ── dismissAllNotificationsFn ─────────────────────────────────────

export const dismissAllNotificationsFn = createServerFn({ method: 'POST' }).handler(
  tracedHandler(
    async () => {
      const headers = await headersFromContext()
      const ctx = await resolveTenantContext(headers)
      await requireExecutionAllowed({ actor: ctx, action: 'notification.update' })
      try {
        const { notificationPublicApi } = getContainer()
        return notificationPublicApi.dismissAll(ctx.userId, ctx.organizationId)
      } catch (e) {
        throw catchUntagged(e)
      }
    },
    'POST',
    'notification.dismissAll',
  ),
)

// ── dismissNotificationFn ─────────────────────────────────────────

const dismissNotificationDto = z.object({
  notificationId: z.uuid(),
})

export const dismissNotificationFn = createServerFn({ method: 'POST' })
  .validator(dismissNotificationDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({ actor: ctx, action: 'notification.update' })
        try {
          const { notificationPublicApi } = getContainer()
          return notificationPublicApi.dismiss(
            data.notificationId,
            ctx.organizationId,
            ctx.userId,
          )
        } catch (e) {
          if (isNotificationError(e)) {
            throwContextError('NotificationError', e, e.code === 'not_found' ? 404 : 500)
          }
          throw catchUntagged(e)
        }
      },
      'POST',
      'notification.dismiss',
    ),
  )

// ── getNotificationPreferencesFn ──────────────────────────────────

/** @public Consumed by the notification preferences settings route. */
export const getNotificationPreferencesFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const ctx = await resolveOptionalTenantContext()
      if (!ctx) return []
      await requireExecutionAllowed({ actor: ctx, action: 'notification.read' })
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

const quietTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
  .nullable()
const notificationCategory = z.enum([
  'mandatory',
  'urgent_operational',
  'workflow_collaboration',
  'recognition',
])
const notificationChannel = z.enum(['in_app', 'email'])
const updateNotificationPreferenceDto = z.object({
  propertyId: z.uuid(),
  category: notificationCategory,
  channel: notificationChannel,
  enabled: z.boolean(),
  cadence: z.enum(['immediate', 'daily']),
  urgentBypassEnabled: z.boolean(),
  quietHoursStart: quietTime,
  quietHoursEnd: quietTime,
})

/** @public Consumed by the notification preferences settings route. */
export const updateNotificationPreferenceFn = createServerFn({ method: 'POST' })
  .validator(updateNotificationPreferenceDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        const capability = requiredCapabilityForPreferenceChannel(data.channel)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'notification.update',
          propertyId: data.propertyId,
          ...(capability ? { capability } : {}),
        })
        try {
          const { notificationPublicApi } = getContainer()
          return notificationPublicApi.updatePreference(
            ctx.userId,
            ctx.organizationId,
            data.propertyId,
            data.category,
            data.channel,
            data.enabled,
            data.cadence,
            data.urgentBypassEnabled,
            data.quietHoursStart,
            data.quietHoursEnd,
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'notification.updatePreference',
    ),
  )

const muteNotificationCategoryDto = z.object({
  propertyId: z.uuid(),
  category: notificationCategory,
})

/** @public Used by notification rows to disable only their in-app category. */
export const muteNotificationCategoryFn = createServerFn({ method: 'POST' })
  .validator(muteNotificationCategoryDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const headers = await headersFromContext()
        const ctx = await resolveTenantContext(headers)
        await requireExecutionAllowed({
          actor: ctx,
          action: 'notification.update',
          propertyId: data.propertyId,
        })
        try {
          const { notificationPublicApi } = getContainer()
          return notificationPublicApi.mutePreferenceCategory(
            ctx.userId,
            ctx.organizationId,
            data.propertyId,
            data.category,
            'in_app',
          )
        } catch (error) {
          if (isNotificationError(error)) {
            throwContextError('NotificationError', error, 400)
          }
          throw catchUntagged(error)
        }
      },
      'POST',
      'notification.muteCategory',
    ),
  )

const localeLanguagePattern = /^[A-Za-z]{2,3}$/
const localeSubtagPattern = /^[A-Za-z0-9]{2,8}$/

function isSupportedLocaleSyntax(locale: string): boolean {
  const [language, ...subtags] = locale.split('-')
  return (
    localeLanguagePattern.test(language ?? '') &&
    subtags.every((subtag) => localeSubtagPattern.test(subtag))
  )
}

const notificationUserSettingsDto = z.object({
  locale: z.string().max(35).refine(isSupportedLocaleSyntax, 'Invalid locale'),
  timezone: z
    .string()
    .min(1)
    .max(64)
    .refine((timezone) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
        return true
      } catch {
        return false
      }
    }, 'Invalid IANA timezone'),
})

export const getNotificationUserSettingsFn = createServerFn({ method: 'GET' }).handler(
  tracedHandler(
    async () => {
      const ctx = await resolveOptionalTenantContext()
      if (!ctx) return null
      await requireExecutionAllowed({ actor: ctx, action: 'notification.read' })
      try {
        return getContainer().notificationPublicApi.getUserSettings(
          ctx.userId,
          ctx.organizationId,
        )
      } catch (error) {
        throw catchUntagged(error)
      }
    },
    'GET',
    'notification.getUserSettings',
  ),
)

export const updateNotificationUserSettingsFn = createServerFn({ method: 'POST' })
  .validator(notificationUserSettingsDto)
  .handler(
    tracedHandler(
      async ({ data }) => {
        const ctx = await resolveTenantContext(await headersFromContext())
        await requireExecutionAllowed({ actor: ctx, action: 'notification.update' })
        try {
          return getContainer().notificationPublicApi.updateUserSettings(
            ctx.userId,
            ctx.organizationId,
            data.locale,
            data.timezone,
          )
        } catch (error) {
          throw catchUntagged(error)
        }
      },
      'POST',
      'notification.updateUserSettings',
    ),
  )
