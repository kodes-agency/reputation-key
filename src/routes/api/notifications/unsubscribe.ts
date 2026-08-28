import { createFileRoute } from '@tanstack/react-router'
import { createOneClickUnsubscribePostHandler } from '#/contexts/notification/server/one-click-unsubscribe'
import { getContainer } from '#/composition'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

export const Route = createFileRoute('/api/notifications/unsubscribe')({
  server: {
    handlers: {
      POST: ({ request }) =>
        createOneClickUnsubscribePostHandler({
          rawKeys: getEnv().NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS,
          logger: getLogger(),
          oneClickUnsubscribe: (target) =>
            getContainer().notificationPublicApi.oneClickUnsubscribe(target),
        })(request),
    },
  },
})
