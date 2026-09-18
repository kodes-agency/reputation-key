// Inbox composer — the pure rules about region 4, out of the pane that wires it.
//
// Three questions, all answered from state and none from the DOM: which
// surfaces the composer offers, whether an edit target is still live, and
// whether a collapsed bar (row 15) would hide work. They sat inside
// `inbox-detail-content.tsx` as the pane's private helpers, where the only way
// to check one was to render the whole pane; here they are ordinary functions
// with a test file next to them.

import type { ReplyEditTarget } from './reply-status-view'
// `resolveReplyView`'s own union is private to that file; this is its public name.
import type { ResolvedReplyView } from './reply-message-view'
import type { ComposerMode } from './composer-mode-row'

/**
 * The note draft, with the item it belongs to. The pane outlives a change of
 * selection, so without the id the words typed about one item would be seeded
 * into a form now fenced on the next one's revision — and filed against it.
 */
export type NoteDraft = Readonly<{ itemId: string; text: string }>

/**
 * Which surface was asked for the caret, and how many times anything was —
 * fenced on the item, exactly as `ReplyEditState` is.
 *
 * Without the id, the counter is a standing instruction. Both consumers are
 * keyed by item and both of their effects fire on mount whenever the counter
 * is non-zero, so one `r` and then a `j` down the list handed the caret to the
 * NEXT item's reply box: the following keystrokes went into a draft on a
 * review nobody had opened, and the autosave persisted them.
 */
export type CaretRequest = Readonly<{
  itemId: string
  mode: ComposerMode
  seq: number
}>

/**
 * The rejected → draft round trip that reopening a rejected reply needs.
 *
 * There is no `reopened` member. It used to carry the focus the unmounted
 * Edit & resubmit button dropped; the pane's caret request carries that for
 * every surface now, including the `r` shortcut — which a state that latches
 * on, as this one did, could not have served twice.
 */
export type ReopenState = 'idle' | 'pending' | 'failed'

/**
 * Which surfaces region 4 offers, in this order.
 *
 * Derived from the item's source type and the caller's permissions ONLY, never
 * from reply state: below two modes the composer drops the segment for a plain
 * box, and crossing that boundary remounts both slots. A feedback item gets
 * Note alone, plus the item action the region takes through
 * `singleModePrimarySlot` (row 10); a caller with neither permission gets no
 * composer at all, because `InboxNotesThread` renders nothing without
 * `inbox.write` and an empty pinned region would be a rule and some padding.
 *
 * That last case cannot strand the feedback action: handling it needs
 * `inbox.write ∧ feedback.handle`, so anyone who has the action also has Note
 * and therefore a region to host it in.
 */
export function offeredModes(
  canReply: boolean,
  canAddNotes: boolean,
): readonly ComposerMode[] {
  if (canReply) return canAddNotes ? ['reply', 'note'] : ['reply']
  return canAddNotes ? ['note'] : []
}

/**
 * An edit target lives only while the reply is still in the state it was
 * opened from. Republishing moves a published reply to `approved`, so the
 * editor has done its job — the pane closes it rather than making the editor
 * announce its own unmounting.
 *
 * `failed-retry` is deliberately NOT a published target: `editPublishedReply`
 * refuses anything that is not `published`, so an editor opened there could
 * only ever fail to save. Try again is that state's whole action list.
 */
export function liveEditTarget(
  kind: ResolvedReplyView['kind'],
  target: ReplyEditTarget,
): ReplyEditTarget {
  return target === 'published' && kind === 'published' ? target : null
}

export type ComposerPendingWorkInput = Readonly<{
  /** The item region 4 is mounted for. */
  itemId: string
  /** `resolveReplyView(detail?.reply)` — a saved draft is `compose` with text. */
  replyView: ResolvedReplyView
  /** The pane's hoisted internal-note draft, and the item it was typed about. */
  noteDraft: NoteDraft
  /** `Edit & resubmit` in flight; it ends with the refused text in the composer. */
  reopen: ReopenState
}>

/**
 * True when collapsing region 4 (row 15) would hide work belonging to
 * `itemId` — the one question the region cannot answer for itself, because it
 * sees two opaque slots and all three of these live above it in the pane.
 *
 * The scope is deliberately narrow: the item's state ON ARRIVAL, and nothing
 * after it. Anything typed has to be typed into an already expanded composer,
 * and the region latches itself open on the first focus that lands inside it
 * (`reply-composer.tsx`), so a half-written reply cannot be behind the bar in
 * the first place. That is also why a live AI suggestion needs no signal here:
 * `Draft with AI` sits inside the reply panel, which cannot be reached without
 * focusing the composer first.
 *
 * A fourth kind of pending work — an open edit — is deliberately absent from
 * this predicate. The region ORs `editTarget` in itself, because that one it
 * can see. (This used to cite "the fourth case row 15 names"; no row 15 in
 * either plan enumerates these cases, and the list lives here.)
 *
 * Whitespace does not count on either surface: a box holding one stray space
 * is an empty box to the manager, and treating it as work would leave the
 * composer permanently expanded for an item nobody has written about.
 *
 * `reopen === 'pending'` is a request in flight rather than content — but it
 * RESOLVES into content (`draftReplyFn` moves the rejected reply back to
 * `draft` and the composer becomes its editor), so the bar has to be gone
 * before the response lands rather than after. `'failed'` is not work: that
 * path restores the rejected message in the thread and leaves the composer
 * empty.
 */
export function hasPendingComposerWork(input: ComposerPendingWorkInput): boolean {
  const { itemId, replyView, noteDraft, reopen } = input
  if (reopen === 'pending') return true
  if (replyView.kind === 'compose' && (replyView.reply?.text.trim() ?? '') !== '') {
    return true
  }
  return noteDraft.itemId === itemId && noteDraft.text.trim() !== ''
}

/** What the pane is editing, if anything, fenced on the item for the same
 *  reason `CaretRequest` is: an open editor from the previous selection must
 *  never carry over to this one. */
export type ReplyEditState = Readonly<{
  itemId: string
  target: ReplyEditTarget
  reopen: ReopenState
}>
