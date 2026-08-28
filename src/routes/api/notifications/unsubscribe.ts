import { createFileRoute } from '@tanstack/react-router'
import { createOneClickUnsubscribePostHandler } from '#/contexts/notification/server/one-click-unsubscribe'
import { getContainer } from '#/composition'
import { requestRuntimeConfig } from '#/shared/config/request-runtime-config'
import { getLogger } from '#/shared/observability/logger'

export const Route = createFileRoute('/api/notifications/unsubscribe')({
  server: {
    handlers: {
      POST: ({ request }) =>
        createOneClickUnsubscribePostHandler({
          rawKeys: requestRuntimeConfig().notificationUnsubscribeHmacKeys,
          logger: getLogger(),
          oneClickUnsubscribe: (target) =>
            getContainer().notificationPublicApi.oneClickUnsubscribe(target),
        })(request),
    },
  },
})
