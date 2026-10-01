// The portal's palette as an autosaved draft.
//
// The palette is chosen from presets, so there is no form: a click is the edit.
// The chosen palette is held as a draft (so the selector follows
// the click at once) and written through the coordinator after the same short
// quiet as a keystroke. The draft is dropped only when the write landed and the
// person has not chosen again meanwhile, so a second click during a save is
// never overwritten by the first save's refetch. A write that failed keeps the
// draft (the header offers Retry); choosing to leave without it drops the draft
// too, or the selector would go on showing a palette that will
// never be written.

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Action } from '#/components/hooks/use-action'
import { isThemeDraftDirty } from '../portal-detail/portal-detail-rules'
import { usePortalDraftAutosave } from './portal-draft-autosave-context'
import type { PortalThemeDraft, UpdatePortalVariables } from '../shared/types'

const THEME_KEY = 'theme'

type Portal = Readonly<{ id: string; theme: PortalThemeDraft }>

export function usePortalThemeAutosave(
  portal: Portal,
  update: Action<UpdatePortalVariables>,
) {
  const autosave = usePortalDraftAutosave()
  const [draft, setDraft] = useState<PortalThemeDraft | null>(null)
  // What the save closure reads when it RUNS, not when it was scheduled.
  const draftRef = useRef<PortalThemeDraft | null>(null)
  const savedRef = useRef(portal.theme)
  const updateRef = useRef(update)
  useEffect(() => {
    savedRef.current = portal.theme
    updateRef.current = update
  })
  const portalId = portal.id

  useEffect(
    () =>
      autosave.onDiscard((keys) => {
        if (!keys.has(THEME_KEY)) return
        draftRef.current = null
        setDraft(null)
      }),
    [autosave],
  )

  const setTheme = useCallback(
    (next: PortalThemeDraft) => {
      draftRef.current = next
      setDraft(next)
      autosave.schedule(THEME_KEY, async () => {
        const submitted = draftRef.current
        const isWrite =
          submitted !== null && isThemeDraftDirty(submitted, savedRef.current)
        if (isWrite) await updateRef.current({ data: { portalId, theme: submitted } })
        // Chosen again while the write ran: that newer choice has its own save.
        if (draftRef.current === submitted) {
          draftRef.current = null
          setDraft(null)
        }
        return isWrite ? 'saved' : 'unchanged'
      })
    },
    [autosave, portalId],
  )

  return { theme: draft ?? portal.theme, setTheme }
}
