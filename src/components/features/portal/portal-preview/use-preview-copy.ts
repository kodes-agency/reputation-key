// The guest copy pack the preview prints in, loaded one language at a time (the
// same loader the guest page uses, so a pack is fetched only when it is shown).

import { useQuery } from '@tanstack/react-query'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { portalKeys } from '#/shared/queries/query-keys'
import { loadGuestPortalCopyV2 } from '#/components/features/guest'

/**
 * What the preview prints a language's fixed text in when that language has no
 * reviewed pack yet. A page in such a language cannot be published in the new
 * design, so no guest reads this: it only keeps the draft drawable, and the
 * stage says so.
 */
const FALLBACK_COPY_LOCALE: GuestLocale = 'en'

async function loadCopy(locale: GuestLocale) {
  try {
    return await loadGuestPortalCopyV2(locale)
  } catch {
    return await loadGuestPortalCopyV2(FALLBACK_COPY_LOCALE)
  }
}

export function usePreviewCopy(locale: GuestLocale) {
  return useQuery({
    queryKey: portalKeys.previewCopy(locale),
    queryFn: () => loadCopy(locale),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  })
}
