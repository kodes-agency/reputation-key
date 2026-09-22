// Keeps keyboard focus in the notification list when the row holding it goes.
//
// Dismissing a row, marking it read in the popover (which moves it from "New"
// to "Earlier", a remount), or a filter dropping it removes the focused control
// with the row, and nothing moved focus afterwards: it fell to <body>, outside
// the non-modal popover, and the next Tab restarted from the top of the page
// (WCAG 2.4.3). This hook remembers the last row control focused inside the
// list. When a render leaves that control detached with focus lost, it moves
// focus to the same control on the neighbouring row (the next one, else the
// previous one), or to the list itself when no row is left.
//
// A row's menu renders in a portal outside the list. Focus moving into it keeps
// the record, because the menu's trigger is what its actions remove.
//
// Focus the reader moved away stays away. Tabbing out of the list forgets the
// record, and so does a pointer press anywhere outside the list and its row
// menus: a click on blank page space blurs the control without naming a new
// target, exactly like its removal does, so blur alone cannot tell the two
// apart. Without this, a row that later went on its own (a poll, another tab)
// pulled focus, and the scroll position, back into the list.

import {
  useEffect,
  useLayoutEffect,
  useRef,
  type FocusEvent,
  type RefObject,
} from 'react'

const ROW_SELECTOR = 'li[data-notification-id]'

type FocusedRowControl = Readonly<{
  element: HTMLElement
  rowId: string
  /** `data-row-control` of the focused control: `open`, `menu` or `dismiss`. */
  control: string
}>

function rowControlOf(target: EventTarget | null): FocusedRowControl | null {
  if (!(target instanceof HTMLElement)) return null
  const row = target.closest<HTMLElement>(ROW_SELECTOR)
  const control = target.closest<HTMLElement>('[data-row-control]')
  const rowId = row?.dataset.notificationId
  const kind = control?.dataset.rowControl
  if (!control || !rowId || !kind) return null
  return { element: control, rowId, control: kind }
}

/** The next row after `rowId` in the old order that is still listed, else the previous one. */
function neighbourOf(
  rowId: string,
  previousIds: ReadonlyArray<string>,
  currentIds: ReadonlyArray<string>,
): string | undefined {
  const listed = (id: string) => id !== rowId && currentIds.includes(id)
  const at = previousIds.indexOf(rowId)
  if (at === -1) return currentIds.find(listed)
  return (
    previousIds.slice(at + 1).find(listed) ??
    previousIds.slice(0, at).reverse().find(listed)
  )
}

const isFocusLost = () =>
  document.activeElement === null || document.activeElement === document.body

const isInRowMenu = (target: EventTarget | null) =>
  target instanceof Element && target.closest('[role="menu"]') !== null

/**
 * `list` is the focusable list container; `rowIds` the rows in rendered order.
 * Spread the returned handlers onto the container.
 */
export function useNotificationFocusRecovery(
  list: RefObject<HTMLElement | null>,
  rowIds: ReadonlyArray<string>,
) {
  const focused = useRef<FocusedRowControl | null>(null)
  const previousIds = useRef(rowIds)

  useLayoutEffect(() => {
    const last = focused.current
    const container = list.current
    if (last && container && !last.element.isConnected && isFocusLost()) {
      const id = neighbourOf(last.rowId, previousIds.current, rowIds)
      const row = id
        ? container.querySelector(`${ROW_SELECTOR}[data-notification-id="${id}"]`)
        : null
      focused.current = null
      ;(
        row?.querySelector<HTMLElement>(`[data-row-control="${last.control}"]`) ??
        container
      ).focus()
    }
    previousIds.current = rowIds
  })

  useEffect(() => {
    const forgetOnPressElsewhere = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && list.current?.contains(target)) return
      if (isInRowMenu(target)) return
      focused.current = null
    }
    document.addEventListener('pointerdown', forgetOnPressElsewhere, true)
    return () => document.removeEventListener('pointerdown', forgetOnPressElsewhere, true)
  }, [list])

  return {
    onFocus: (event: FocusEvent<HTMLElement>) => {
      // A target outside the container is a row's menu, rendered in a portal.
      if (list.current?.contains(event.target)) {
        focused.current = rowControlOf(event.target)
      }
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      const next = event.relatedTarget
      if (!(next instanceof Element) || list.current?.contains(next)) return
      if (isInRowMenu(next)) return
      focused.current = null
    },
  }
}
