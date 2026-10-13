import { createFileRoute } from '@tanstack/react-router'
import { ZodError } from 'zod/v4'
import { resolvePublicPortalLink } from '#/contexts/guest/server/guest-scans'
import { isValidExternalUrl } from '#/contexts/portal/application/public-api'
import { getLogger } from '#/shared/observability/logger'
import { captureObservabilityException } from '#/shared/observability/telemetry'
import { isExpectedRefusal } from '#/shared/security/expected-refusal'

const PRIVATE_RESPONSE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Referrer-Policy': 'no-referrer',
}

const notFound = () =>
  new Response('Link not found', { status: 404, headers: PRIVATE_RESPONSE_HEADERS })

const unavailable = () =>
  new Response('Link temporarily unavailable', {
    status: 503,
    headers: PRIVATE_RESPONSE_HEADERS,
  })

/**
 * What error monitoring is told when the lookup failed: that it happened here,
 * and nothing of the failure itself (see the catch below).
 */
class PublicPortalClickUnavailable extends Error {
  override readonly name = 'PublicPortalClickUnavailable'

  constructor() {
    super('public_portal_click_unavailable')
  }
}

/**
 * A refusal is an answer about the link: the lookup's own 4xx (a Portal that
 * is not found or no longer active, a caller over its limit) or an address its
 * validator will not read. Everything else is a lookup that did not happen.
 */
const isRefusal = (error: unknown): boolean =>
  error instanceof ZodError || isExpectedRefusal(error)

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
      headers: { Location: result.url, ...PRIVATE_RESPONSE_HEADERS },
    })
  } catch (error) {
    // Every refusal gets the one inert answer, so the route never says which
    // tokens exist. The server function has already logged it.
    if (isRefusal(error)) return notFound()
    // The lookup failed (the database, a dependency, a defect). That is not
    // "no such link": the guest is told to come back, and error monitoring is
    // told, because an answered failure never reaches the Nitro error hook.
    // Upstream errors are untrusted at this public capability boundary: their
    // message or metadata may echo the raw token. Log and report only a stable
    // code and the non-secret published link identifier; the server function
    // logged the cause under its own request id.
    logger.error(
      { linkId: params.linkId, errorCode: 'public_portal_click_unavailable' },
      '[handler] public Portal click unavailable',
    )
    captureObservabilityException(new PublicPortalClickUnavailable(), { source: 'nitro' })
    return unavailable()
  }
}

export const Route = createFileRoute('/api/public/p/$token/click/$linkId')({
  server: {
    handlers: {
      GET: async ({ params }) => handlePublicPortalClick(params),
    },
  },
})
