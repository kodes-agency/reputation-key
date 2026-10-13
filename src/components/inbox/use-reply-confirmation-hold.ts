// Inbox detail — the pane stands still under an open reply confirmation.
//
// Confirm & publish and Confirm & update are confirmations, and a confirmation
// says its own refusal and stays open until the manager dismisses it
// (`ui/confirmation-dialog.tsx`). Both dialogs are drawn inside the reply they
// ask about: one in the thread message's action row, which is keyed by the
// reply's status and is not rendered at all for a draft or a deleted reply,
// the other in the editor, which is mounted only while its edit target is
// live. A refused command re-reads the reply
// (`inboxCachePolicy.onReplyCommandFailed`), and the usual reason for the
// refusal is that the reply has left the state the dialog was opened on. So
// the read that follows a refusal took the dialog away, and the sentence with
// it: a refused Confirm & publish said nothing at all.
//
// The pane therefore shows the detail a confirmation was OPENED on for as long
// as that confirmation is open, and the detail as read once it closes. Held
// from the opening, not from the refusal, so the words "the exact reply shown
// here" stay true of what is behind the dialog for its whole life: a read on
// window focus changes nothing under it either. The cache is not held. It is
// re-read at once, so the list row and the counts are current, and the pane
// follows the moment the dialog is dismissed.
//
// What is SENT is a separate guarantee, kept where the command is built: the
// row names the reply and state revision its dialog was opened on
// (`reply-message-actions.tsx`), whatever a host renders under it.
//
// One read the hold does not outlast: a re-read that FAILS. When the server
// cannot be reached at all, the command fails and so does the read after it,
// and the panel and the sheet replace the pane's content with their own
// failure block ("This item couldn't be loaded", Try again), as for any failed
// read of the open item. The hold lives inside that content and goes with it.
// The manager is told, by the pane and not by the dialog.
//
// A context rather than a prop: the two dialogs sit several components below
// the pane, in two subtrees that know nothing about each other (the thread and
// the composer), and the reporter would thread through every file between
// (the reason `composer-mode-row.tsx` gives for its own).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'

/** A reply confirmation opened (`true`) or closed (`false`). */
type ConfirmationOpenChange = (isOpen: boolean) => void

/**
 * The pane's end of the channel. Outside a pane (a story of the message or
 * the editor alone) nothing holds, and the report goes nowhere.
 */
export const ReplyConfirmationHold = createContext<ConfirmationOpenChange>(() => {})

/** A detail and the item it was shown for. */
type Held<TDetail> = Readonly<{ itemId: string; detail: TDetail }>

/**
 * What the pane shows: the detail a confirmation was opened on while it is
 * open over this item, and the detail as read otherwise. The item is compared
 * because the pane is not remounted when the manager opens another one: a
 * hold nobody released must never show the first item's reply on the second.
 */
export function detailOnScreen<TDetail>(
  held: Held<TDetail> | null,
  itemId: string,
  detail: TDetail,
): TDetail {
  return held !== null && held.itemId === itemId ? held.detail : detail
}

/**
 * The pane's hold. `detail` is what the pane renders; `onConfirmationOpenChange`
 * is what it provides through `ReplyConfirmationHold`.
 */
export function useHeldReplyDetail<TDetail>(
  itemId: string,
  detailAsRead: TDetail,
): Readonly<{ detail: TDetail; onConfirmationOpenChange: ConfirmationOpenChange }> {
  const [held, setHeld] = useState<Held<TDetail> | null>(null)
  const detail = detailOnScreen(held, itemId, detailAsRead)
  // What is on screen, for the moment a confirmation opens. A ref, so the
  // reporter below keeps one identity and a dialog's host never re-subscribes.
  const onScreen = useRef<Held<TDetail>>({ itemId, detail })
  useEffect(() => {
    onScreen.current = { itemId, detail }
  }, [itemId, detail])
  const onConfirmationOpenChange = useCallback<ConfirmationOpenChange>(
    (isOpen) => setHeld(isOpen ? onScreen.current : null),
    [],
  )
  return { detail, onConfirmationOpenChange }
}

/**
 * A confirmation's end: pass the result to the dialog's `onOpenChange`.
 *
 * A host tells the pane only about a hold it has. The dialog can outlive its
 * host's part in this: a confirmation still running when the host is unmounted
 * reports "closed" when its command settles (`ConfirmationDialog` closes
 * itself then), and by that time the hold may be another dialog's, opened on
 * another item. That late word is dropped here.
 *
 * The unmount releases a hold this host still has. A dialog does not always
 * close before its host goes: the browser's Back button selects another item
 * under an open confirmation, and the pane is not remounted for it. A hold
 * left behind would come back with the item, and show its reply as it was when
 * a dialog that no longer exists was opened. A LAYOUT effect, so the release
 * lands in the commit that removes the host and the pane never paints the held
 * reply without its dialog (the reason `composer-mode-row.tsx` gives for its
 * own report).
 */
export function useReplyConfirmationHold(): ConfirmationOpenChange {
  const onConfirmationOpenChange = useContext(ReplyConfirmationHold)
  const isHolding = useRef(false)
  const report = useCallback<ConfirmationOpenChange>(
    (isOpen) => {
      if (isHolding.current === isOpen) return
      isHolding.current = isOpen
      onConfirmationOpenChange(isOpen)
    },
    [onConfirmationOpenChange],
  )
  useLayoutEffect(() => () => report(false), [report])
  return report
}
