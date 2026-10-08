// Guest context — the language of the unavailable page.

import { createServerFn } from '@tanstack/react-start'
import { setResponseHeader } from '@tanstack/react-start/server'
import { z } from 'zod/v4'
import { headersFromContext } from '#/shared/auth/headers'
import { tracedHandler } from '#/shared/observability/traced-server-fn'
import { preferredGuestLocale } from '../application/preferred-guest-locale'
import {
  applyGuestPublicResponsePrivacy,
  guestPublicResponseValidator,
} from './public-response-privacy.server'

/**
 * The guest language the visitor's own browser asks for, from `Accept-Language`
 * alone. The unavailable page has no portal and no token to take a language
 * from, and must not: it says the same thing for every reason a page is not
 * there. The browser's preference says nothing about the portal, so this reads
 * only the request, never the token.
 */
export const getUnavailableGuestLocale = createServerFn({ method: 'GET' })
  .validator(guestPublicResponseValidator(z.object({}).optional(), { varyCookie: false }))
  .handler(
    tracedHandler(
      async () => {
        applyGuestPublicResponsePrivacy({ varyCookie: false })
        setResponseHeader('Vary', 'Accept-Language')
        const headers = await headersFromContext()
        return { locale: preferredGuestLocale(headers.get('accept-language')) }
      },
      'GET',
      'guest.getUnavailableLocale',
    ),
  )
