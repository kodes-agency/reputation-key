// Keyboard shortcuts for the inbox — j/k/ArrowDown/ArrowUp walk the list and
// Escape closes the detail; r and n open the composer and e escalates the open
// item (plan row 17, which described all three as already working — they were
// not). Extracted from inbox-page-v2.tsx for max-lines compliance.
//
// Every decision lives in `handleInboxShortcut`, a pure function of the
// keypress and of what the page can currently do with it. The unit project
// runs in node with no jsdom, so the hook is only the window binding and the
// handler is what the tests drive.
import { useEffect, useRef } from 'react'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { isEscalationActive } from './inbox-case-toolbar-props'

/**
 * What `e` needs to behave exactly like the case toolbar's Escalate / Resolve
 * member (`inbox-detail-manager-actions.tsx`, moved out of the header by plan
 * v2.1 row 5), the only other way to issue either command. Both flags are that
 * button's own two "not available" conditions, and a shortcut must not bypass
 * a control the pane has taken away — in the
 * in-flight case it would also ship a `commandRevision` that is already going
 * stale (see `isHeaderCommandPending`: all six item commands share one fence).
 *
 * There is no confirmation step on that button, so there is none here either.
 *
 * Rebuild the object only when its parts change — the window listener
 * re-subscribes whenever it does.
 */
export type InboxEscalationShortcut = Readonly<{
  /**
   * Whether the toolbar is showing the button at all: the member's gate for
   * the selected item — `inbox.write` AND the source's handle permission AND
   * `inbox.manage` — and the pane past its loading and error branches, since
   * the toolbar only mounts with the detail content (`isCaseToolbarShown`).
   * Both are computed in `use-inbox-page.ts`.
   */
  isAllowed: boolean
  /** `isHeaderCommandPending(detailState)` — the button is disabled. */
  isPending: boolean
  escalate: () => void
  resolveEscalation: () => void
}>

/**
 * The part of `KeyboardEvent` the shortcuts read. A real `KeyboardEvent`
 * satisfies it; a test hands over a plain object.
 */
export type InboxShortcutEvent = Readonly<{
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  /** `EventTarget | null` at runtime; only three of its fields are read. */
  target: unknown
  preventDefault: () => void
}>

export type InboxShortcutInput = Readonly<{
  items: ReadonlyArray<InboxItem>
  isMobile: boolean
  selectedItem: InboxItem | null
  /** The hook's cursor into `items`; `-1` when nothing is selected. */
  selectedIndex: { current: number }
  handleRowClick: (item: InboxItem) => void
  closeDetail: () => void
  /** Puts the composer in Reply mode and focuses its editor. */
  focusReplyComposer?: () => void
  /** Puts the composer in Note mode and focuses its field. */
  focusNoteComposer?: () => void
  escalation?: InboxEscalationShortcut
  /** Toggles the active row in the bulk selection. */
  toggleSelect?: () => void
  /** Opens the shared keyboard-shortcut legend. */
  openShortcuts?: () => void
}>

/**
 * Whatever is being typed into owns the keyboard. This is why a plain `r`
 * cannot fire while the composer has focus, which is the point — and it also
 * means `n` cannot switch the composer to Note mode once a reply has been
 * started. That is accepted rather than worked around: a shortcut that took
 * the keystroke anyway would eat a letter out of the draft.
 */
function isTextEntryTarget(target: unknown): boolean {
  const element = target as HTMLElement | null
  return (
    element?.tagName === 'INPUT' ||
    element?.tagName === 'TEXTAREA' ||
    element?.isContentEditable === true
  )
}

/**
 * An open menu, select, dialog or alert dialog owns the letter keys too: Radix
 * typeahead is a keydown on a non-input element, so the guard above does not
 * cover it. Without this, `e` would escalate from behind an open confirmation
 * and Escape would close both the menu and the pane.
 */
const OVERLAY_SELECTOR =
  '[role="menu"],[role="listbox"],[role="dialog"],[role="alertdialog"]'

function isOverlayTarget(target: unknown): boolean {
  const element = target as HTMLElement | null
  return element?.closest?.(OVERLAY_SELECTOR) != null
}

/**
 * Marks a focusable scroller whose arrow keys must SCROLL it rather than walk
 * the list. Spread onto the element as `{...{ [INBOX_SCROLL_REGION]: '' }}`.
 *
 * The thread's scroller became a tab stop so a keyboard user can read a long
 * review, and the arrow keys are how a focused scroller is read. Claimed by
 * the list shortcut instead, ArrowDown on the Conversation region opened the
 * NEXT case — and if that case was not cached, the pane fell back to its
 * skeleton, the focused region unmounted and focus dropped to `<body>`. `j` and
 * `k` stay list keys everywhere; only the arrows yield, and only here.
 */
export const INBOX_SCROLL_REGION = 'data-inbox-scroll-region'

/**
 * Everything that owns its own arrow keys, so the list shortcut must not also
 * act on them: the marked scrollers above, and any control whose keyboard
 * contract uses the arrows. A dropdown or select trigger opens on ArrowDown —
 * with only the scroller guard, ArrowDown on the composer's `Draft with AI`
 * chevron opened its menu AND switched to the next case in the same keystroke.
 *
 * A trigger whose popup is a dialog is not one of them. Radix marks every
 * Popover, Dialog and AlertDialog trigger `aria-haspopup="dialog"` and gives it
 * no arrow-key handling, so on those buttons (the toolbar's reply-due chip, the
 * list's Filters, `Review update`) the arrows keep walking the list, as they do
 * on the plain buttons beside them.
 */
const ARROW_KEY_OWNERS = [
  `[${INBOX_SCROLL_REGION}]`,
  '[aria-haspopup]:not([aria-haspopup="dialog"])',
  '[role="combobox"]',
  '[role="tab"]',
  '[role="radio"]',
  '[role="slider"]',
  'select',
].join(', ')

function ownsArrowKeys(target: unknown): boolean {
  const element = target as HTMLElement | null
  return element?.closest?.(ARROW_KEY_OWNERS) != null
}

/**
 * An absent callback leaves the keystroke alone — no `preventDefault`, so a
 * key this page cannot act on still reaches the browser.
 */
function runShortcut(event: InboxShortcutEvent, action: (() => void) | undefined): void {
  if (!action) return
  event.preventDefault()
  action()
}

/**
 * `e` is the toolbar member's toggle: an escalation that was raised and not yet
 * resolved resolves, anything else escalates. The predicate is not a copy of
 * the member's but the same function — `isEscalationActive`, which the props
 * selector also hands the member — so the key and the button cannot disagree.
 */
function runEscalation(event: InboxShortcutEvent, input: InboxShortcutInput): void {
  const { escalation, selectedItem } = input
  if (!escalation || !selectedItem) return
  if (!escalation.isAllowed || escalation.isPending) return

  event.preventDefault()
  if (isEscalationActive(selectedItem)) escalation.resolveEscalation()
  else escalation.escalate()
}

function selectNext({ items, selectedIndex, handleRowClick }: InboxShortcutInput): void {
  if (selectedIndex.current < 0 && items.length > 0) {
    selectedIndex.current = 0
    const first = items[0]
    if (first) handleRowClick(first)
    return
  }
  if (selectedIndex.current < items.length - 1) {
    selectedIndex.current++
    const next = items[selectedIndex.current]
    if (next) handleRowClick(next)
  }
}

function selectPrevious({
  items,
  selectedIndex,
  handleRowClick,
}: InboxShortcutInput): void {
  if (selectedIndex.current <= 0) return
  selectedIndex.current--
  const previous = items[selectedIndex.current]
  if (previous) handleRowClick(previous)
}

/** Every inbox shortcut, as one pure function so it can be unit tested. */
export function handleInboxShortcut(
  event: InboxShortcutEvent,
  input: InboxShortcutInput,
): void {
  if (isTextEntryTarget(event.target) || isOverlayTarget(event.target)) return

  if (event.ctrlKey || event.metaKey || event.altKey) return

  // `?` is Shift+/ on common layouts, so it must be handled before the shift
  // guard that protects every letter shortcut.
  if (event.key === '?') {
    runShortcut(event, input.openShortcuts)
    return
  }

  // A modified keypress belongs to the browser or the OS: Cmd+R must still
  // reload the page, Ctrl+N must still open a window, and Shift+R is not the
  // same keystroke as r.
  if (event.shiftKey) return

  if (input.isMobile) return

  switch (event.key) {
    case 'ArrowDown':
      if (ownsArrowKeys(event.target)) return
      event.preventDefault()
      selectNext(input)
      break
    case 'j':
      event.preventDefault()
      selectNext(input)
      break
    case 'ArrowUp':
      if (ownsArrowKeys(event.target)) return
      event.preventDefault()
      selectPrevious(input)
      break
    case 'k':
      event.preventDefault()
      selectPrevious(input)
      break
    case 'r':
      runShortcut(event, input.focusReplyComposer)
      break
    case 'n':
      runShortcut(event, input.focusNoteComposer)
      break
    case 'e':
      runEscalation(event, input)
      break
    case 'x':
      runShortcut(event, input.toggleSelect)
      break
    case 'Enter':
      if (input.selectedItem) {
        const item = input.selectedItem
        runShortcut(event, () => input.handleRowClick(item))
      }
      break
    case 'Escape':
      event.preventDefault()
      input.closeDetail()
      break
  }
}

export function useInboxKeyboardShortcuts({
  items,
  isMobile,
  selectedItem,
  handleRowClick,
  closeDetail,
  focusReplyComposer,
  focusNoteComposer,
  escalation,
  toggleSelect,
  openShortcuts,
}: Readonly<{
  items: ReadonlyArray<InboxItem>
  isMobile: boolean
  selectedItem: InboxItem | null
  handleRowClick: (item: InboxItem) => void
  closeDetail: () => void
  focusReplyComposer?: () => void
  focusNoteComposer?: () => void
  escalation?: InboxEscalationShortcut
  toggleSelect?: () => void
  openShortcuts?: () => void
}>) {
  const selectedIndexRef = useRef(-1)

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      handleInboxShortcut(e, {
        items,
        isMobile,
        selectedItem,
        selectedIndex: selectedIndexRef,
        handleRowClick,
        closeDetail,
        focusReplyComposer,
        focusNoteComposer,
        escalation,
        toggleSelect,
        openShortcuts,
      })
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    items,
    isMobile,
    selectedItem,
    handleRowClick,
    closeDetail,
    focusReplyComposer,
    focusNoteComposer,
    escalation,
    toggleSelect,
    openShortcuts,
  ])

  // Sync selectedIndexRef when selectedItem changes
  useEffect(() => {
    if (selectedItem) {
      const idx = items.findIndex((i) => i.id === selectedItem.id)
      if (idx !== -1) selectedIndexRef.current = idx
    } else {
      selectedIndexRef.current = -1
    }
  }, [selectedItem, items])

  return { selectedIndexRef }
}
