// Makes one change to a Portal's languages (add, remove, make fallback) and
// writes it through the portal's autosave coordinator, so it is serialised with
// the other saves of the same Portal and the header says "Draft saved".
//
// The change is applied when the write RUNS, to the languages the Portal has
// then, not to the ones it had when the menu was used: two quick changes in a
// row each build on the one before, rather than the second undoing the first.

import { useCallback, useEffect, useRef } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { UpdatePortalVariables } from '../shared/types'
import { applyLanguageChange, type PortalLanguageChange } from './portal-languages-rules'

const LANGUAGES_KEY = 'languages'

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
  // What the write reads when it runs, not when it was asked for.
  const latest = useRef({ portal, update })
  useEffect(() => {
    latest.current = { portal, update }
  })

  return useCallback(
    (change: PortalLanguageChange) => {
      autosave.schedule(LANGUAGES_KEY, async () => {
        const { portal: current, update: write } = latest.current
        const next = applyLanguageChange(
          {
            primary: current.primaryGuestLocale ?? 'en',
            additional: current.additionalGuestLocales ?? [],
          },
          change,
        )
        if (next === null) return 'unchanged'
        await write({
          data: {
            portalId: current.id,
            primaryGuestLocale: next.primary,
            additionalGuestLocales: [...next.additional],
          },
        })
        return 'saved'
      })
      // A discrete choice, not typing: write it now rather than after the pause.
      void autosave.flush()
    },
    [autosave],
  )
}
