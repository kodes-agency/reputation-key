import { createFileRoute } from '@tanstack/react-router'
import { resolvePublicPortalLink } from '#/contexts/guest/server/guest-scans'
import { isValidExternalUrl } from '#/contexts/portal/application/public-api'
import { getLogger } from '#/shared/observability/logger'

const notFound = () =>
  new Response('Link not found', {
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
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
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
      },
    })
  } catch (error) {
    // Raw public tokens are deliberately absent from logs and every unavailable
    // token/link/lifecycle/policy outcome is externally indistinguishable.
    logger.error(
      { err: error, linkId: params.linkId },
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
