// What the save behind a flipped switch is doing, as the row says it (UI consistency
// scan: FORM-08). A row that saves as it is flipped hands its handler's promise to
// `track`: "Saving…" while it runs, "Saved" for a moment when it lands, nothing when
// it was refused (the caller has said so in a toast, decision 6).
//
// A save is refused when its promise rejects or resolves `false`. Anything else
// resolved is a save that landed. Flips that overlap are one stretch of saving: the
// row settles when the last of them has, and says "Saved" only if that one landed.
import { useCallback, useEffect, useRef, useState } from 'react'

/** How long "Saved" stays beside the switch. */
export const SAVED_NOTICE_MS = 2500

export type SaveStatus = 'idle' | 'saving' | 'saved'

export type TrackSave = (result: unknown) => void

export function useSaveStatus(): readonly [SaveStatus, TrackSave] {
  const [status, setStatus] = useState<SaveStatus>('idle')
  const inFlight = useRef(0)
  const alive = useRef(false)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      clearTimeout(hideTimer.current)
    }
  }, [])

  const track = useCallback<TrackSave>((result) => {
    if (!(result instanceof Promise)) return
    clearTimeout(hideTimer.current)
    inFlight.current += 1
    setStatus('saving')
    const settle = (landed: boolean) => {
      inFlight.current -= 1
      if (!alive.current || inFlight.current > 0) return
      setStatus(landed ? 'saved' : 'idle')
      if (landed) {
        hideTimer.current = setTimeout(() => setStatus('idle'), SAVED_NOTICE_MS)
      }
    }
    result.then(
      (value) => settle(value !== false),
      () => settle(false),
    )
  }, [])

  return [status, track]
}
