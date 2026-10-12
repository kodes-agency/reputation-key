// One rule for a dialog that is committing something: it cannot be dismissed
// until the request settles (UI consistency scan: SURF-03, FORM-16).
//
// Escape, the overlay and the close button all reach the dialog as
// `onOpenChange(false)`, so the rule is one guard on that call. A request in
// flight holds the dialog; the hold is released when the request settles, and
// the dialog closes itself (or shows the refusal) from there. Without it the
// person could walk away from a half-made change and never read what it said.
//
// Who holds it:
// - `<Dialog busy={…}>` when the dialog's owner has the pending flag at hand.
// - `useDialogBusy(mutation.isPending)` in a body that owns the mutation (the
//   beta feedback form, loaded lazily inside the launcher's dialog).
// - `ConfirmationDialog` holds it itself while its `onConfirm` runs.
//
// The count lives in a small store rather than state so the guard reads the
// answer at the moment of the keypress, not as of the last render.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from 'react'

export type BusyStore = Readonly<{
  /** Opens a hold; call the returned function to release it (once). */
  hold: () => () => void
  isBusy: () => boolean
  subscribe: (listener: () => void) => () => void
}>

export function createBusyStore(): BusyStore {
  let holds = 0
  const listeners = new Set<() => void>()
  const notify = () => listeners.forEach((listener) => listener())
  return {
    hold: () => {
      holds += 1
      notify()
      let released = false
      return () => {
        if (released) return
        released = true
        holds -= 1
        notify()
      }
    },
    isBusy: () => holds > 0,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** `onOpenChange` that refuses to close while `isBusy()`; opening is always allowed. */
export function guardDismissal(
  isBusy: () => boolean,
  onOpenChange: (open: boolean) => void,
): (open: boolean) => void {
  return (open) => {
    if (!open && isBusy()) return
    onOpenChange(open)
  }
}

/**
 * The hold a dialog keeps for its owner. `busy` is the owner's pending flag, if it
 * has one; `hold` is for a dialog that decides for itself (a confirmation).
 */
export function useDismissalGuard(busy = false) {
  const [store] = useState(createBusyStore)
  useEffect(() => (busy ? store.hold() : undefined), [busy, store])
  const isBusy = useSyncExternalStore(store.subscribe, store.isBusy, () => false)
  const guard = useCallback(
    (onOpenChange: (open: boolean) => void) => guardDismissal(store.isBusy, onOpenChange),
    [store],
  )
  return { store, isBusy, guard }
}

/** What a `Dialog` offers the bodies inside it. */
export const DialogBusyContext = createContext<BusyStore | null>(null)

/**
 * Hold the nearest `Dialog` open while `isBusy`: its Escape, overlay and close
 * button are refused until the request settles. For a body that owns the mutation.
 */
export function useDialogBusy(isBusy: boolean): void {
  const store = useContext(DialogBusyContext)
  useEffect(() => (isBusy && store ? store.hold() : undefined), [isBusy, store])
}

/** Whether the nearest `Dialog` is being held, for a control that should look it. */
export function useDialogIsBusy(): boolean {
  const store = useContext(DialogBusyContext)
  return useSyncExternalStore(
    store?.subscribe ?? noSubscription,
    store?.isBusy ?? idle,
    idle,
  )
}

const idle = () => false
const noSubscription = () => () => undefined
