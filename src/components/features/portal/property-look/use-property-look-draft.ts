// The Property look page's draft: the colours and the wordmark, and the default
// languages, held as the person edits them and written through one autosave
// coordinator (the editor's own), so the status line, the retry and the leave
// guard behave as they do in the portal editor.
//
// The draft is the page's truth while it is open: the preview and the readout
// follow it at once, and a save lands the server's answer as the new baseline.
// The save closures read the current draft when they run, not when they were
// scheduled, as the coordinator requires.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { Action } from '#/components/hooks/use-action'
import {
  isOfferedGuestLocale,
  type OfferedGuestLocale,
} from '#/shared/domain/guest-locale'
import {
  createPortalDraftAutosave,
  type PortalDraftAutosaveState,
} from '../portal-editor/portal-draft-autosave'
import {
  lookDraftOf,
  lookInputOf,
  lookProblemOf,
  type LookDraft,
} from './property-look-rules'
import { runLocalesSave, runLookSave } from './property-look-save'
import type { PropertyLookProfile } from './property-look-types'

const LOOK_KEY = 'look'
const LOCALES_KEY = 'locales'
/** Short: a chip or a colour pick is a decision, not typing. */
const AUTOSAVE_DELAY_MS = 600

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
  const [autosave] = useState(() =>
    createPortalDraftAutosave({ delayMs: AUTOSAVE_DELAY_MS }),
  )
  useEffect(() => () => autosave.flushOnTeardown(), [autosave])
  const state: PortalDraftAutosaveState = useSyncExternalStore(
    autosave.subscribe,
    autosave.getState,
    autosave.getState,
  )

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
    /** Why the last pause in editing was not written; null when it was or nothing is wrong. */
    problem: state.status === 'invalid' ? lookProblemOf(draft) : null,
    state,
    retry: autosave.retry,
  }
}
