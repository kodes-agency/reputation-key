import { queryOptions } from '@tanstack/react-query'
import type { GuestPortalCopy } from '#/components/features/guest'
import type { PublicPortalLoaderData } from '#/contexts/guest/server/public'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { guestKeys } from '#/shared/queries/query-keys'

const STALE_TIME_MS = 5 * 60 * 1000

/**
 * Statuses `getPublicPortal` uses for the deliberate "there is no portal here"
 * posture: 404 `portal_not_found` (bad or rotated token, denied capability), 410
 * `portal_inactive` (unpublished portal, suspended property) and 403 `forbidden`.
 * All of them must stay externally indistinguishable to a guest, so they collapse
 * to the same `null`. Every other failure (500 from a DB blip, a network fault) is
 * rethrown: swallowing it cached a successful `null` for the whole 5-minute
 * staleTime, so a sub-second outage pinned the unavailable page for five minutes.
 */
const unavailablePostureStatus: Readonly<Record<number, true>> = {
  403: true,
  404: true,
  410: true,
}

/**
 * `ServerFunctionError` carries `.status` across the server/client boundary
 * (`serverFunctionErrorAdapter`); narrowing structurally keeps this module
 * independent of the class.
 */
function isUnavailablePosture(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('status' in error)) return false
  const { status } = error
  return typeof status === 'number' && unavailablePostureStatus[status] === true
}

/**
 * What the page renders from: the server's loader data and, for a schema
 * version 3 portal, the one copy pack of the page's language. The pack is loaded
 * with the data (one language, one dynamic import), so the server render and the
 * hydration read the same copy and no client request fetches it afterwards. A
 * pack that cannot be loaded fails the whole read, never to another language.
 */
export type GuestPageData = PublicPortalLoaderData &
  Readonly<{ pack: GuestPortalCopy | null }>

/** The route's own binding of the public read: the server function stays in the route. */
export type ReadPublicPortal = (input: {
  data: { token: string; locale?: GuestLocale }
}) => Promise<PublicPortalLoaderData>

export const publicPortalQuery = (
  readPublicPortal: ReadPublicPortal,
  token: string,
  locale?: GuestLocale,
) =>
  queryOptions({
    queryKey: guestKeys.publicPortal({ token, locale: locale ?? 'auto' }),
    queryFn: async (): Promise<GuestPageData | null> => {
      try {
        const data = await readPublicPortal({ data: { token, locale } })
        // A dynamic import of the loader's own module, not the guest barrel: the
        // loader belongs to the route's critical chunk, and a static edge to the
        // barrel would put the whole guest page in every page's first paint.
        const pack = data.immersive
          ? await (
              await import('#/components/features/guest/public-portal/language-packs/load-guest-copy')
            ).loadGuestPortalCopy(
              data.localization.selectedLocale,
              data.localization.languagePackVersion,
            )
          : null
        return { ...data, pack }
      } catch (error) {
        if (isUnavailablePosture(error)) return null
        throw error
      }
    },
    staleTime: STALE_TIME_MS,
  })

/**
 * The server resolves the `portal.guest_response` capability decision. The
 * form view has no separate 'unavailable' branch: a tenant-disabled response
 * surface and a transient failure read the same to a guest, so both land on
 * its 'error' copy.
 */
export const formAvailability: Readonly<
  Record<
    'available' | 'permission_denied' | 'unavailable',
    'available' | 'permission_denied' | 'error'
  >
> = {
  available: 'available',
  permission_denied: 'permission_denied',
  unavailable: 'error',
}
