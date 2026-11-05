import { createFileRoute } from '@tanstack/react-router'
import {
  createOneClickUnsubscribePostHandler,
  handleOneClickUnsubscribeGet,
} from '#/contexts/feed/server/one-click-unsubscribe'
import { getContainer } from '#/composition'
import { getEnv } from '#/shared/config/env'
import { getLogger } from '#/shared/observability/logger'

export const Route = createFileRoute('/api/notifications/unsubscribe')({
  server: {
    handlers: {
      // A browser opening the header URL gets a confirm page; it never
      // unsubscribes, because link scanners GET every URL in a message.
      GET: ({ request }) => handleOneClickUnsubscribeGet(request),
      POST: ({ request }) =>
        createOneClickUnsubscribePostHandler({
          rawKeys: getEnv().NOTIFICATION_UNSUBSCRIBE_HMAC_KEYS,
          logger: getLogger(),
          oneClickUnsubscribe: (target) =>
            getContainer().feedPublicApi.oneClickUnsubscribe(target),
        })(request),
    },
  },
})
