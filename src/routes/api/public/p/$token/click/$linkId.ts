import { createFileRoute } from '@tanstack/react-router'
import { resolvePublicPortalLink } from '#/contexts/guest/server/guest-scans'
import { isValidExternalUrl } from '#/contexts/portal/application/public-api'
import { getLogger } from '#/shared/observability/logger'

const notFound = () =>
  new Response('Link not found', {
    status: 404,
    headers: {
      'Cache-Control': 'private, no-store',
      'Referrer-Policy': 'no-referrer',
    },
  })

export async function handlePublicPortalClick(
  params: Readonly<{
    token: string
    linkId: string
  }>,
): Promise<Response> {
  const logger = getLogger()
  try {
    const result = await resolvePublicPortalLink({
      data: { token: params.token, linkId: params.linkId },
    })
    if (!result || !isValidExternalUrl(result.url)) {
      if (result) {
        logger.warn({ linkId: params.linkId }, 'Invalid public Portal redirect blocked')
      }
      return notFound()
    }

    return new Response(null, {
      status: 302,
      headers: {
        Location: result.url,
        'Cache-Control': 'private, no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch {
    // Upstream errors are untrusted at this public capability boundary: their
    // message or metadata may echo the raw token. Log only a stable code and the
    // non-secret published link identifier.
    logger.error(
      { linkId: params.linkId, errorCode: 'public_portal_click_unavailable' },
      '[handler] public Portal click unavailable',
    )
    return notFound()
  }
}

export const Route = createFileRoute('/api/public/p/$token/click/$linkId')({
  server: {
    handlers: {
      GET: async ({ params }) => handlePublicPortalClick(params),
    },
  },
})
