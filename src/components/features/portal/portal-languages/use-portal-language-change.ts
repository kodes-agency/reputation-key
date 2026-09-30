// The Languages section's hook over `createPortalLanguageChanger`: it reads the
// Portal's languages from the query cache when a write runs (the optimistic
// update of the write before it has already landed there), not from a render.

import { useCallback, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Action } from '#/components/hooks/use-action'
import { portalKeys } from '#/shared/queries/query-keys'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import type { UpdatePortalVariables } from '../shared/types'
import { createPortalLanguageChanger } from './portal-language-change'
import type { PortalLanguageChange } from './portal-languages-rules'

type LanguagePortal = Readonly<{
  id: string
  primaryGuestLocale?: GuestLocale
  additionalGuestLocales?: readonly GuestLocale[]
}>

export function usePortalLanguageChange(
  portal: LanguagePortal,
  update: Action<UpdatePortalVariables>,
): (change: PortalLanguageChange) => void {
  const autosave = usePortalDraftAutosave()
  const queryClient = useQueryClient()
  // Only the write and the render's own Portal are kept here, as the fallback
  // when the cache holds nothing; the languages themselves come from the cache.
  const latest = useRef({ portal, update })
  useEffect(() => {
    latest.current = { portal, update }
  })

  return useCallback(
    (change: PortalLanguageChange) => {
      const portalId = latest.current.portal.id
      createPortalLanguageChanger({
        autosave,
        readCurrent: () => {
          const cached = queryClient.getQueryData<{ portal: LanguagePortal | null }>(
            portalKeys.detail(portalId),
          )?.portal
          const current = cached ?? latest.current.portal
          return {
            primary: current.primaryGuestLocale ?? 'en',
            additional: current.additionalGuestLocales ?? [],
          }
        },
        write: (next) =>
          latest.current.update({
            data: {
              portalId,
              primaryGuestLocale: next.primaryGuestLocale,
              additionalGuestLocales: [...next.additionalGuestLocales],
            },
          }),
      })(change)
    },
    [autosave, queryClient],
  )
}
