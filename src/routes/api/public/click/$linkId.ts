import { createFileRoute } from '@tanstack/react-router'
import { resolveLinkAndTrack } from '#/contexts/guest/server/public'
import { getLogger } from '#/shared/observability/logger'
import { isValidExternalUrl } from '#/contexts/portal/server/portal-links'

export const Route = createFileRoute('/api/public/click/$linkId')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const logger = getLogger()
        try {
          const result = await resolveLinkAndTrack({ data: { linkId: params.linkId } })

          if (!result) {
            return new Response('Link not found', { status: 404 }) as Response
          }

          if (!isValidExternalUrl(result.url)) {
            logger.warn(
              { linkId: params.linkId, url: result.url },
              'Invalid redirect URL blocked',
            )
            return new Response('Invalid link', { status: 400 }) as Response
          }

          // Redirect to actual review URL
          return new Response(null, {
            status: 302,
            headers: { Location: result.url },
          }) as Response
        } catch (e) {
          logger.error(
            { err: e, linkId: params.linkId },
            '[handler] /api/public/click/:linkId',
          )
          return new Response('Link not found', { status: 404 }) as Response
        }
      },
    },
  },
})
