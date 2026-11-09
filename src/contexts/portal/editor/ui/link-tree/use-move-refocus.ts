// After a tile moves, the keyboard stays on the control that moved it: the list
// re-orders, so the focused element is drawn again in its new place, and focus
// is put back on it (or, when that control is now disabled at the end of the
// list, on the tile's other move control). The caller names the control,
// `<link id>:<control>`, through the returned function before it asks for the
// move.

import { useEffect, useRef } from 'react'

export function useMoveRefocus(order: string): (control: string) => void {
  const wanted = useRef<string | null>(null)
  useEffect(() => {
    const control = wanted.current
    if (control === null) return
    wanted.current = null
    const [linkId] = control.split(':')
    document
      .querySelector<HTMLElement>(`[data-link-move="${control}"]:not(:disabled)`)
      ?.focus()
    if (document.activeElement?.getAttribute('data-link-move') === null) {
      document
        .querySelector<HTMLElement>(`[data-link-move^="${linkId}:"]:not(:disabled)`)
        ?.focus()
    }
  }, [order])
  return (control) => {
    wanted.current = control
  }
}
