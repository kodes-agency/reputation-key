import { createFileRoute } from '@tanstack/react-router'
import { handleOneClickUnsubscribePost } from '#/contexts/notification/server/one-click-unsubscribe'

export const Route = createFileRoute('/api/notifications/unsubscribe')({
  server: {
    handlers: {
      POST: ({ request }) => handleOneClickUnsubscribePost(request),
    },
  },
})
