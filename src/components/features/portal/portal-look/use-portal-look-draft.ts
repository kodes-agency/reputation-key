// The two ways a portal's own look is written from the editor.
//
// - `usePortalLookDraft`: a value the person edits as they go (the colours, the
//   wordmark, the photo's focus point). Held here while they edit, written through
//   the portal's autosave coordinator (the header's "Draft saved", the retry and
//   the leave guard are its), under a key of its own so the prompt can name it.
//   Until the first edit the draft is what the server holds; after it, the
//   person's edit is the page's truth, as on the Property look page.
// - `usePortalLookSwitch`: a deliberate act with its own button (follow the
//   property, own this group, a photo, a logo). It is written at once, after the
//   edits still waiting, so a late autosave cannot land on top of it, and a
//   refusal is a toast: there is no form to put it under.

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { actionErrorMessage } from '#/components/hooks/use-action-mutation'
import { usePortalDraftAutosave } from '../portal-editor/portal-draft-autosave-context'
import { afterPendingAutosaves } from '../property-look/use-property-look-media'
import type { PortalLookSave } from './portal-look-save'

/**
 * @param key the autosave key; `portal-unsaved-parts.ts` has its name
 * @param seed what the server holds now
 * @param persist one write of the draft; reads what it needs when it runs
 */
export function usePortalLookDraft<T>(key: string, seed: T, persist: PortalLookSave<T>) {
  const autosave = usePortalDraftAutosave()
  const [edited, setEdited] = useState<T | null>(null)
  const draft = edited ?? seed
  // The save runs after a pause in typing, so it reads the newest draft and write.
  const latest = useRef({ draft, persist })
  const saved = useRef(seed)
  useEffect(() => {
    latest.current = { draft, persist }
  })

  const edit = useCallback(
    (next: T) => {
      latest.current = { ...latest.current, draft: next }
      setEdited(next)
      autosave.schedule(key, async () => {
        const result = await latest.current.persist(latest.current.draft, saved.current)
        saved.current = result.saved
        return result.outcome
      })
    },
    [autosave, key],
  )

  /** Where a deliberate write put the server, so the next autosave compares with it. */
  const land = useCallback((value: T) => {
    saved.current = value
    latest.current = { ...latest.current, draft: value }
    setEdited(value)
  }, [])

  return { draft, edit, land }
}

export function usePortalLookSwitch() {
  const autosave = usePortalDraftAutosave()
  const [isPending, setIsPending] = useState(false)

  /**
   * One write, after the edits still waiting. A refusal is thrown, for a dialog
   * that says it where the person is looking.
   */
  const write = useCallback(
    <T>(send: () => Promise<T>): Promise<T> => afterPendingAutosaves(autosave, send),
    [autosave],
  )

  /** The same for a button: busy while it runs, a refusal told in a toast, the page left as it was. */
  const run = useCallback(
    async (send: () => Promise<unknown>): Promise<boolean> => {
      setIsPending(true)
      try {
        await write(send)
        return true
      } catch (error) {
        toast.error(actionErrorMessage(error))
        return false
      } finally {
        setIsPending(false)
      }
    },
    [write],
  )

  return { isPending, run, write }
}
