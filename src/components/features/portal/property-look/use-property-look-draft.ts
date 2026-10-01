// The Property look page's draft: the colours and the wordmark, and the default
// languages, held as the person edits them and written through the autosave
// coordinator of the page's provider (the portal editor's own, so the leave
// guard mounted beside it sees these saves), which drives the status line and
// the retry.
//
// The draft is the page's truth while it is open: the preview and the readout
// follow it at once, and a save lands the server's answer as the new baseline.
// The save closures read the current draft when they run, not when they were
// scheduled, as the coordinator requires.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import {
  isOfferedGuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import {
  usePortalDraftAutosave,
  usePortalDraftAutosaveState,
} from '../portal-editor/portal-draft-autosave-context'
import {
  lookDraftOf,
  lookInputOf,
  lookProblemOf,
  refusalOf,
  type LookDraft,
} from './property-look-rules'
import { runLocalesSave, runLookSave } from './property-look-save'
import type { PropertyLookProfile } from './property-look-types'

const LOOK_KEY = 'look'
const LOCALES_KEY = 'locales'
/** Short: a chip or a colour pick is a decision, not typing. The provider is given it. */
export const PROPERTY_LOOK_AUTOSAVE_DELAY_MS = 600

export type PropertyLookSaves = Readonly<{
  saveLook: Action<{ data: ReturnType<typeof lookInputOf> }, PropertyLookProfile>
  saveLocales: Action<
    { data: { propertyId: string; locales: OfferedGuestLocale[] } },
    Readonly<{ defaultGuestLocales: readonly string[] }>
  >
}>

const offeredOnly = (locales: readonly string[]): OfferedGuestLocale[] =>
  locales.filter(isOfferedGuestLocale)

export function usePropertyLookDraft(
  propertyId: string,
  profile: PropertyLookProfile,
  saves: PropertyLookSaves,
) {
  const autosave = usePortalDraftAutosave()
  const state = usePortalDraftAutosaveState()

  const [draft, setLookState] = useState<LookDraft>(() => lookDraftOf(profile))
  const [locales, setLocalesState] = useState<readonly OfferedGuestLocale[]>(() =>
    offeredOnly(profile.defaultGuestLocales),
  )
  const draftRef = useRef(draft)
  const localesRef = useRef(locales)
  const savedLookRef = useRef(draft)
  const savedLocalesRef = useRef(locales)
  const savesRef = useRef(saves)
  useEffect(() => {
    savesRef.current = saves
  })

  const setDraft = useCallback(
    (patch: Partial<LookDraft>) => {
      draftRef.current = { ...draftRef.current, ...patch }
      setLookState(draftRef.current)
      autosave.schedule(LOOK_KEY, async () => {
        const result = await runLookSave({
          propertyId,
          saved: savedLookRef.current,
          draft: draftRef.current,
          save: (args) => savesRef.current.saveLook(args),
        })
        savedLookRef.current = result.saved
        return result.outcome
      })
    },
    [autosave, propertyId],
  )

  const setLocales = useCallback(
    (next: readonly OfferedGuestLocale[]) => {
      localesRef.current = next
      setLocalesState(next)
      autosave.schedule(LOCALES_KEY, async () => {
        const result = await runLocalesSave({
          propertyId,
          saved: savedLocalesRef.current,
          draft: localesRef.current,
          save: (args) => savesRef.current.saveLocales(args),
        })
        savedLocalesRef.current = offeredOnly(result.saved)
        return result.outcome
      })
    },
    [autosave, propertyId],
  )

  return {
    draft,
    setDraft,
    locales,
    setLocales,
    /**
     * Why the last pause in editing was not written: the page's own rule for a
     * refused edit, the server's sentence for a refused write. Null when it was
     * written, or when the failure is one a retry could fix.
     */
    problem:
      state.status === 'invalid'
        ? lookProblemOf(draft)
        : state.status === 'error'
          ? refusalOf(state.error)
          : null,
    state,
    retry: autosave.retry,
  }
}
