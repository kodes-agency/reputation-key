// Inbox composer — the dock's HEAD ROW (plan v2.1 rows 14-16, 19): the Reply /
// Note segment at the leading edge and the per-mode state slot at the trailing
// edge; the bar that stands in for the whole region on mobile until the manager
// opens it (v1 row 15); and the channel through which a writing surface below
// the head reports its save state up into it.
//
// Split out of `reply-composer.tsx` so the region file stays a short
// description of its parts rather than a wall of control classes. The segment
// and the bar are here because they are the same choice asked twice: the
// segment picks the surface that is on screen, the bar picks the one the
// composer will OPEN ONTO, and their copy maps are keyed by the same
// `ComposerMode` and have to be read together. The state slot is here because
// it is the other half of the same row, and what it says is keyed by the same
// mode.
//
// The language control is not here and never will be: row 17 takes it out of
// the chrome altogether. It only ever chose between the property default and
// the review language (`reply-language-options.ts`, `ReplyLanguageTarget`),
// and the only two readers of that choice are the assist actions — a template
// is filtered by the target's `templateGroup`
// (`reply-template-operations.ts:137`) and stamped with its tag (`:304`), an
// AI draft is stamped the same way (`ai-suggested-draft-store.ts:360`), while a
// hand-typed reply only RECORDS the tag (`reply-operations.ts:325`) and nothing
// reads it at publish. A parameter of two menus is not a separate row or
// repeated foot control; it remains available inside each assist menu.

import { createContext, useContext, useLayoutEffect } from 'react'
import {
  CheckCircle2,
  LoaderCircle,
  Lock,
  MessageSquare,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Kbd } from '#/components/ui/kbd'
import { TabsList, TabsTrigger } from '#/components/ui/tabs'
import { cn } from '#/lib/utils'
import type { ReplyAutosaveStatus } from './use-reply-autosave'
import type { ReactNode } from 'react'

/**
 * Which surface the composer is writing to.
 *
 * Declared here, beside the control that produces it, and re-exported by
 * `reply-composer.tsx` for everything above — the arrangement `ReplyEditTarget`
 * already uses, so the module graph keeps pointing downward instead of back up
 * at the region and the pane that owns the state.
 */
export type ComposerMode = 'reply' | 'note'

/**
 * The ACCESSIBLE names — pinned copy, not decoration. Three e2e specs address
 * this control as `getByRole('tab', { name: 'Internal note' })`
 * (`inbox-triage.spec.ts:182, 231`, `activity-notification-facts.spec.ts:167`)
 * and the contract keeps `Public reply` beside it. Rename neither without
 * moving those specs in the same PR.
 */
const MODE_LABEL: Readonly<Record<ComposerMode, string>> = {
  reply: 'Public reply',
  note: 'Internal note',
}

/**
 * The VISIBLE labels, shortened by row 15 — legal only because each is
 * contained in its accessible name above.
 *
 * Checked rather than assumed, because WCAG 2.5.3 (Label in Name) is the whole
 * licence for the shortening: a speech-input user says what they SEE, so the
 * words on the tab have to appear inside the name the tab exposes. `Reply` is
 * inside `Public reply` and `Note` is inside `Internal note` — as words, at the
 * END of each name, compared case-insensitively. Case-insensitively is how the
 * criterion is read (its Understanding document matches spoken words, which
 * carry no case) and how Playwright's default `name` match and axe's
 * `label-content-name-mismatch` rule both compare; as raw case-sensitive
 * substrings neither label is contained (`Note` ≠ `note`), which is the one
 * reading under which the shortening would not stand. Starting the name with
 * the visible text is the criterion's best practice, not its requirement; the
 * names cannot be reordered without moving the three specs above, so they are
 * not. `composer-dock.stories.tsx` asserts the containment on the rendered
 * tabs, so a future edit to either map fails there rather than in an audit.
 *
 * The printed key (`R` / `N`) is not part of the label: it is `aria-hidden`, a
 * hint about the control rather than its name, and is left out of the check.
 */
const MODE_SHORT_LABEL: Readonly<Record<ComposerMode, string>> = {
  reply: 'Reply',
  note: 'Note',
}

/**
 * The keys `use-inbox-keyboard-shortcuts.ts:172-175` already binds (`r` →
 * `focusReplyComposer`, `n` → `focusNoteComposer`), printed for the first
 * time. Upper case because that is how a key cap reads; the binding ignores a
 * shifted press, so the hint is the glyph on the key, not a chord.
 */
const MODE_KEY: Readonly<Record<ComposerMode, string>> = {
  reply: 'R',
  note: 'N',
}

/**
 * What the collapsed bar says, keyed by the surface it opens onto (row 15).
 *
 * Beside `MODE_LABEL` because it is the same axis and the same kind of copy:
 * while the composer is collapsed this string is the ONLY accessible name the
 * region has, so a reader hears `Reply…` or `Add a note…` and nothing else.
 *
 * Keyed by the surface, never by the item: `mode` is what the REGION resolved
 * against the slots it was actually given (`reply-composer.tsx`), so a review
 * whose reply is pending, approved, published, mirrored, failed or rejected —
 * every state in which the pane passes `replySlot={null}` — reads the second
 * string here, exactly as a note-only feedback item does. The bar naming a
 * surface that does not exist is the defect this keying is for; measured at
 * 390x844 before it, the tap shrank region 4 from 133 px to 101 px, mounted
 * nothing, and left the bar gone for the rest of that item's visit.
 */
const MODE_PLACEHOLDER: Readonly<Record<ComposerMode, string>> = {
  reply: 'Reply…',
  note: 'Add a note…',
}

const MODE_ICON: Readonly<Record<ComposerMode, LucideIcon>> = {
  reply: MessageSquare,
  // The ONLY lock in the pane (row 12): the note node in the thread lost its
  // lock, and the dock draws none inside its box. Privacy is said there by
  // shape and words; here the glyph marks the control that chooses it.
  note: Lock,
}

/**
 * The note surface's accessible name, and the sentence the head slot prints.
 *
 * Amber cannot say "private" on its own: `--warn-line` measured 1.47:1 against
 * the pane (2.17:1 dark), under WCAG 1.4.11's 3:1, so in grayscale or to a
 * low-vision reader the note-mode dock is a box of the same shape as the
 * reply's (`styles.css`, PR 3). The thread's note node answered that with
 * words and shape — an article named `Internal note from <author>, not visible
 * to the guest` in a dashed box (`note-message.tsx`) — and the dock answers it
 * the same way, so the pane makes one promise in one form wherever private
 * text is being read or written.
 */
export const NOTE_SURFACE_NAME = 'Internal note, not visible to the guest'
const NOTE_HEAD_STATE = 'Not visible to the guest'

/**
 * The segment's track, sized from the canvas's `.seg`: 2 px of track around
 * the thumbs, 2 px between them, a 7 px outer radius over the thumbs' 5 px.
 *
 * The shape is still the `default` `TabsList` variant — a `bg-muted` track
 * with a `bg-background` thumb on the active item — because two segments that
 * swap the form below them are a tab set by any reading of the ARIA pattern,
 * and the roles and names here are pinned by e2e. Keeping Radix also keeps the
 * roving tabindex, the arrow-key order and the `aria-controls` wiring that a
 * hand-rolled group of buttons would have to reimplement (row 21: no
 * `toggle-group`).
 *
 * Note mode swaps the fill for `bg-warn-track` (row 19). `cn` in the primitive
 * resolves it against the variant's `bg-muted`, so the swap replaces the fill
 * rather than stacking a second one over it.
 */
const LIST_CLASS =
  'shrink-0 gap-0.5 rounded-[7px] p-0.5 group-data-[orientation=horizontal]/tabs:h-auto'

/**
 * One thumb: 26 px on the desktop (the canvas's 30 px track less its padding)
 * and 36 px below `md` — row 20 lowered v1's 44 px (`max-md:min-h-11`) to 36,
 * because WCAG 2.5.8 AA asks for 24 px and 44 was what inflated the phone
 * strip. 36 is the thumb, not the track, so the one number PR 5's metrics
 * harness asserts of every control (≥ 36 × 36 at 390 and 320) holds of the
 * thing a finger actually lands on.
 *
 * `text-muted-foreground` replaces the primitive's `text-foreground/60` for the
 * resting label. Composited over the segment's `bg-muted` track that alpha
 * lands at about 4.3:1, under the 4.5:1 this pane is gated on; the solid token
 * read back at 5.87:1 light and 6.49:1 dark in Chromium and WebKit, and 5.43:1
 * / 5.07:1 on note mode's `--warn-track` over `--warn-muted`. The active label is
 * semibold as well as on the thumb, so which half is selected does not rest on
 * the thumb's fill alone.
 */
const TRIGGER_CLASS =
  'h-[26px] gap-1.5 rounded-[5px] px-2.5 text-[13px] text-muted-foreground data-[state=active]:font-semibold aria-disabled:opacity-50 max-md:h-9 max-md:px-3'

/**
 * The Note thumb's active label in the warn ink (row 19) — on the NOTE trigger
 * only, so it can never land on the reply surface (amber means only private).
 *
 * Both spellings, because the primitive sets the active colour in both:
 * `data-[state=active]:text-foreground` and its `dark:` twin. `cn` replaces
 * each with its own counterpart; one without the other would leave dark mode
 * printing `Note` in the neutral ink. `--warn` on the light thumb
 * (`bg-background`) is 4.69:1 (`styles.css`).
 *
 * AND a `--warn` edge on the active thumb. The PR 4 review measured what the
 * amber did to the selection cue: on the `--warn-track` the white thumb is
 * 1.14:1 light / 1.03:1 dark against its track, its border transparent (light)
 * or 1.04:1 (dark), and the amber `Note` label is LIGHTER than the grey `Reply`
 * beside it — so in grayscale, or to a low-vision reader, which tab is
 * selected rested on 600 against 500 weight (WCAG 1.4.1, and 1.4.11 for a
 * state indicator). Reply mode never had the problem: its active label is
 * 17.76:1 against 5.87:1. The 1 px `--warn` edge gives the Note thumb a
 * shape of its own. Measured in Chromium against Storybook with Tailwind
 * compiled (computed colours composited over the dock, the same method that
 * reproduced the review's 1.14 / 1.03): the edge is 4.11:1 against the track
 * and 4.69:1 against the thumb in the light theme, 7.12:1 and 7.36:1 in the
 * dark — over the 3:1 WCAG 1.4.11 asks of a state indicator on both sides. It
 * replaces the primitive's `dark:` `border-input` through `cn` the same way
 * the ink does.
 */
const PRIVATE_TRIGGER_CLASS =
  'data-[state=active]:text-warn dark:data-[state=active]:text-warn data-[state=active]:border-warn dark:data-[state=active]:border-warn'

/**
 * The key cap, drawn after the canvas's `.kbd`: a 16 px outlined cap in a
 * 10 px mono face. Desktop only (`max-md:hidden`), because the shortcuts are
 * too: `use-inbox-keyboard-shortcuts.ts` returns before its switch when
 * `isMobile`, the same 768 px line `md` draws. The ink stays the primitive's
 * `text-muted-foreground` rather than the canvas's tertiary grade — tertiary
 * measured 2.48:1 on `--warn-muted` (`note-message.tsx`), and a hint a manager
 * is meant to read is still text.
 */
const KBD_CLASS =
  'ml-0.5 h-4 min-w-4 rounded-[3px] border bg-background px-1 font-mono text-[10px] max-md:hidden'

/**
 * The head row: 42 px (row 14), the segment against the leading edge and the
 * state slot pushed to the trailing one — the canvas's `.dock-head`, padding
 * `6px 10px 6px 6px` and a rule under it.
 *
 * It WRAPS rather than truncating or scrolling. PR 2 measured what a row that
 * scrolls behind a hidden scrollbar does — it hides its overflow from everyone
 * — and the slot's sentence is the one thing in the head that must be read
 * whole. At 390 the two thumbs and `Not visible to the guest` fit on one line
 * with room to spare; at 320 the sentence drops under the segment.
 *
 * `shrink-0`: the region is a bounded flex column, and the head is the one row
 * in it that must never give up height — the slot below it is what shrinks
 * (and scrolls).
 *
 * The bottom padding is a pixel short of the top because the rule is inside
 * the box: the canvas's `6px … 6px` with a 1 px `border-bottom` measured 43 px
 * in Chromium, so `pb-[5px]` is what makes the head the 42 px row 14 names
 * (6 + 30 + 5 + 1). Below `md` the thumbs are 36 px and the padding tightens to
 * 4 / 3, a 48 px head (4 + 40 + 3 + 1) rather than 53.
 */
const HEAD_CLASS =
  'flex min-h-[42px] min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b pt-1.5 pr-2.5 pb-[5px] pl-1.5 max-md:pt-1 max-md:pb-[3px]'

/**
 * The bar itself: 44 px, left-aligned, and shaped like the box it opens.
 *
 * `variant="outline"` rather than a bare `div` with a click handler — it is a
 * real button, so it keeps the primitive's focus ring, its hover and active
 * states and its `data-variant` (which the stories read to prove the region's
 * one-primary rule is not quietly broken by an `outline` bar). `justify-start`
 * and `font-normal` are the two overrides that make a button read as an empty
 * field rather than as an action; `h-11` stays, and is not what row 20 lowered:
 * a bare pill standing in for a whole composer is a different target from a
 * control in a toolbar, and it is not what inflated anything.
 *
 * `w-40 grow` is what decides whether the bar and the segment share one row.
 * Basis 160 px: beside the segment there is room for both from about 500 px of
 * region width up, and below that — a 390 px phone — the row wraps and the bar
 * takes the full width above the segment. Wrapping rather than truncating is
 * deliberate: `Reply…` shortened to `Repl…` would be the one string in the
 * region a manager cannot afford to misread.
 */
const BAR_CLASS = 'h-11 w-40 grow justify-start px-4 font-normal text-muted-foreground'

/**
 * The bar when it opens onto the note (row 20: "amber when the only mode is
 * Note") — the dock's note-mode surface, edge and ink, so the bar looks like
 * the box it is about to become.
 *
 * DASHED for the reason the dock is: the amber edge is 1.47:1 and cannot be the
 * only thing that says private. The bar's own words (`Add a note…`) are the
 * other half. `text-warn` on `bg-warn-muted` is 4.62:1 light, 9.16:1 dark.
 *
 * Every colour the outline variant sets is re-set here, each against its own
 * twin, so `cn` drops the variant's: the hover moves the BORDER to full warn
 * rather than washing the fill purple (`attention-band.tsx`'s rule — on the
 * track the fill already fails 4.5:1 for warn text), and the `dark:` fills
 * would otherwise paint `bg-input/30` over the amber.
 */
const PRIVATE_BAR_CLASS =
  'border-dashed border-warn-line bg-warn-muted text-warn hover:border-warn hover:bg-warn-muted hover:text-warn dark:border-warn-line dark:bg-warn-muted dark:hover:bg-warn-muted'

/**
 * What the head slot says about the reply's autosave (row 16), in three words.
 *
 * The line under the box used to carry these six states AND the publication
 * guarantee (`publishes only after approval`) in one sentence. Row 14 deletes
 * that line; the guarantee moves to the moment it matters — a tooltip on
 * `Submit for approval` (`reply-composer-footer.tsx`) and the submit toast —
 * and the state keeps only what is true of the draft.
 *
 * `idle` prints nothing. It is the coordinator's state before anything was
 * scheduled (`reply-autosave-coordinator.ts`), which is a composer that has
 * saved nothing in this visit, whether or not a draft exists behind it; neither
 * `Saved` nor `Not saved` is true of an empty box. `pending` (the debounce is
 * running) reads as `saving` because to the manager it is the same fact.
 * `unsaved` (ineligible: empty, over-long, no concrete language) and `error`
 * share `Not saved`; the error keeps the destructive ink and the alert glyph,
 * and the footer's `Retry save` and its error sentence say the rest.
 */
const SAVE_STATE_LABEL: Readonly<Record<ReplyAutosaveStatus, string | null>> = {
  idle: null,
  pending: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  unsaved: 'Not saved',
  error: 'Not saved',
}

/**
 * The channel a writing surface below the head reports its save state through.
 *
 * Why a context and not a callback prop threaded down: the state is PRODUCED
 * by `useReplyComposer`'s autosave, mounted inside the reply slot, and SHOWN in
 * the head row above it — a node cannot travel upward, so the value has to. The
 * pane precedent (`noteDraft` mirrored through `onDraftChange`) threads a
 * callback because the PANE holds that state and builds the slot that calls
 * it. Here the REGION holds the state, and the region never builds its slots:
 * the pane passes them in as finished nodes. A prop would have to be created by
 * the region and handed to a node the pane already rendered, which only a
 * render-prop slot could do — and it would then thread through three files
 * that know nothing about the head (`inbox-detail-content.tsx` → `ReplyEditor`
 * → `ReplyStatusView` → `ReplyCompose`). This is the compound-component case:
 * the dock owns the state, and the one child that has something to say about
 * it reads the dock's reporter from context.
 *
 * `null` outside a dock, so a surface rendered on its own (every
 * `reply-editor-compose` story) reports to nobody and costs nothing.
 */
type SaveStateReporter = (status: ReplyAutosaveStatus | null) => void

const SaveStateReport = createContext<SaveStateReporter | null>(null)

/**
 * The region's end of the channel: everything under it reports to
 * `onSaveStateChange` — `null` meaning "no autosaving surface is mounted".
 */
export function ComposerSaveStateScope({
  onSaveStateChange,
  children,
}: Readonly<{ onSaveStateChange: SaveStateReporter; children: ReactNode }>): ReactNode {
  return <SaveStateReport value={onSaveStateChange}>{children}</SaveStateReport>
}

/**
 * The surface's end: call with the autosave status on every render
 * (`ReplyCompose`: `useComposerSaveStateReport(state.autosave.status)`).
 *
 * The lifecycle is owned HERE so no caller can get it half right:
 *
 * - The unmount reports `null`. The region outlives what is in its slot — a
 *   submit turns the compose box into a pending reply (`replySlot={null}`), a
 *   change of selection remounts the item-keyed editor — and a status nobody
 *   retracts would print the last draft's `Saved` over a surface that has no
 *   draft, or over the next item's.
 * - A LAYOUT effect, not a passive one. React runs a removed component's layout
 *   cleanup in the commit that removes it and a new one's layout effect before
 *   the browser paints, so the head never shows one frame of the previous
 *   item's state. A passive effect runs after paint and would.
 * - One effect for both halves: on a status change the cleanup reports `null`
 *   and the body the new status in the same commit, which React batches into
 *   one render of the region. StrictMode's mount → cleanup → mount pass ends on
 *   the real status for the same reason.
 */
export function useComposerSaveStateReport(status: ReplyAutosaveStatus): void {
  const onSaveStateChange = useContext(SaveStateReport)
  useLayoutEffect(() => {
    if (onSaveStateChange === null) return
    onSaveStateChange(status)
    return () => onSaveStateChange(null)
  }, [onSaveStateChange, status])
}

function SaveStateGlyph({ status }: Readonly<{ status: ReplyAutosaveStatus }>) {
  if (status === 'pending' || status === 'saving') {
    // `motion-reduce`: a spinner is motion for its own sake, and the word
    // `Saving…` already says it.
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-3.5 animate-spin motion-reduce:animate-none"
      />
    )
  }
  if (status === 'saved') return <CheckCircle2 aria-hidden="true" className="size-3.5" />
  if (status === 'error') return <TriangleAlert aria-hidden="true" className="size-3.5" />
  return null
}

/**
 * The trailing slot, per mode (row 16).
 *
 * REPLY: the autosave state, in one polite live region — polite because an
 * autosave is not worth interrupting — and the only live region in the dock.
 * It renders even while it has nothing to say, because a live region has to be
 * in the document BEFORE its text changes for a reader to be told; one
 * inserted along with its first `Saving…` is announced by nobody.
 *
 * NOTE: `Not visible to the guest`, at EVERY width. The plan scoped it to the
 * desktop on the belief that the amber carries the promise on a phone; PR 3
 * measured that it cannot (1.47:1), and nothing else visible on the phone's
 * note-mode dock says it — the Note thumb says `Note`, the placeholder says
 * `Add a note…`. So the words stay, and the head wraps to fit them at 320.
 * The warn ink is the thread's `Internal note` label's (4.62:1 light, 9.16:1
 * dark on `--warn-muted`), so the two say private in the same voice.
 */
function ComposerHeadState({
  mode,
  saveState,
}: Readonly<{ mode: ComposerMode; saveState: ReplyAutosaveStatus | null }>): ReactNode {
  if (mode === 'note') {
    return <p className="ml-auto text-xs font-medium text-warn">{NOTE_HEAD_STATE}</p>
  }
  const label = saveState === null ? null : SAVE_STATE_LABEL[saveState]
  return (
    <p
      aria-live="polite"
      className={cn(
        'ml-auto flex items-center gap-1.5 text-xs whitespace-nowrap text-muted-foreground',
        saveState === 'error' && 'text-destructive',
      )}
    >
      {saveState !== null && label !== null ? (
        <>
          <SaveStateGlyph status={saveState} />
          {label}
        </>
      ) : null}
    </p>
  )
}

type ComposerSegmentProps = Readonly<{
  /** Rendered in this order. Callers render no segment below two. */
  modes: readonly ComposerMode[]
  /** The selected mode — which is what tones the track amber (row 19). */
  active: ComposerMode
  /**
   * While set, every OTHER mode refuses the switch: a hop to notes in the
   * middle of row 9's live edit would strand the edit behind a form that
   * cannot close it.
   */
  lockedTo?: ComposerMode
  /** Element that says why the refusal is happening — the editing band. */
  lockedById?: string
  /**
   * Wired by the COLLAPSED row and by nothing else: open the region on the
   * tapped surface. Per trigger and on `click`, which is the whole point —
   * see `ComposerCollapsedRow`.
   *
   * Omitted by the head row on purpose. There the segment only swaps the
   * panel under it; calling the pane's `focusComposer` from it would move the
   * caret into the textarea on every tap of the toggle, on the desktop too.
   */
  onSelect?: (mode: ComposerMode) => void
}>

/**
 * The Reply / Note segment. A real `tablist`; see `LIST_CLASS`.
 *
 * `data-private` on the track mirrors the tone for the Storybook project, which
 * compiles no Tailwind and so cannot see a class take effect — it can read an
 * attribute.
 */
function ComposerSegment({
  modes,
  active,
  lockedTo,
  lockedById,
  onSelect,
}: ComposerSegmentProps): ReactNode {
  const isPrivate = active === 'note'
  return (
    <TabsList
      data-private={isPrivate ? '' : undefined}
      className={cn(LIST_CLASS, isPrivate && 'bg-warn-track')}
    >
      {modes.map((mode) => {
        const Icon = MODE_ICON[mode]
        const locked = lockedTo !== undefined && lockedTo !== mode
        return (
          <TabsTrigger
            key={mode}
            value={mode}
            aria-label={MODE_LABEL[mode]}
            className={cn(TRIGGER_CLASS, mode === 'note' && PRIVATE_TRIGGER_CLASS)}
            // `aria-disabled`, never the native attribute: a locked segment
            // has something to explain, and a natively disabled button
            // leaves the tab order and takes its `aria-describedby` with it,
            // so the one line saying why becomes reachable by no keyboard
            // and no reader. The refusal itself is upstream — the region
            // holds `value`, so an ignored `onValueChange` cannot move the
            // selection however the switch was attempted.
            aria-disabled={locked ? true : undefined}
            aria-describedby={locked ? lockedById : undefined}
            // The collapsed row's own route in, kept off the locked trigger
            // for the same reason `onValueChange` refuses one upstream.
            onClick={locked || onSelect === undefined ? undefined : () => onSelect(mode)}
          >
            <Icon aria-hidden="true" />
            {MODE_SHORT_LABEL[mode]}
            <Kbd aria-hidden="true" className={KBD_CLASS}>
              {MODE_KEY[mode]}
            </Kbd>
          </TabsTrigger>
        )
      })}
    </TabsList>
  )
}

type ComposerModeRowProps = Readonly<{
  /** The region's offered modes. Below two the head has no segment. */
  modes: readonly ComposerMode[]
  /** The mode on screen — the segment's selection and the slot's key. */
  active: ComposerMode
  /**
   * The reply surface's last reported autosave status, or `null` while no
   * autosaving surface is mounted. Ignored in note mode.
   */
  saveState: ReplyAutosaveStatus | null
  lockedTo?: ComposerMode
  lockedById?: string
}>

/**
 * The dock's head row (row 14): the segment, then the per-mode state slot.
 *
 * A single-mode dock keeps the row and loses only the segment — one mode is not
 * a choice, but the slot still has something to say: a feedback item's note
 * is exactly as invisible to the guest, and a reply-only composer still
 * autosaves.
 */
export function ComposerModeRow({
  modes,
  active,
  saveState,
  lockedTo,
  lockedById,
}: ComposerModeRowProps): ReactNode {
  return (
    <div className={cn(HEAD_CLASS, active === 'note' && 'border-warn-line')}>
      {modes.length > 1 ? (
        <ComposerSegment
          modes={modes}
          active={active}
          lockedTo={lockedTo}
          lockedById={lockedById}
        />
      ) : null}
      <ComposerHeadState mode={active} saveState={saveState} />
    </div>
  )
}

export type ComposerCollapsedRowProps = Readonly<{
  /**
   * The surface the bar opens onto — and therefore the string it reads, and
   * whether it wears the note's amber.
   *
   * Not the region's active mode: the region resolves this against the slots
   * it was handed, so a review whose reply is read-only arrives here as
   * `'note'`. A bar naming a surface the region does not have is a control
   * that empties the region when tapped.
   */
  mode: ComposerMode
  /** The segment's selection, which tones the segment's own track. */
  active: ComposerMode
  /** The same list the head gets. Below two there is no segment to show. */
  modes: readonly ComposerMode[]
  /** Open the composer on `mode` and put the caret in that surface's field. */
  onExpand: (mode: ComposerMode) => void
}>

/**
 * The whole of region 4 while it is collapsed (row 15): one bar and, when there
 * is a choice to make, the segment beside it.
 *
 * The segment is the SAME control in both states — same roles, same accessible
 * names, same Radix tab set — so nothing that addresses it has to know which
 * state the region is in. It carries no `lockedTo` here because it cannot be
 * locked: row 9's edit target forces the region open, so a collapsed composer
 * is by construction one with no edit in it. It carries no state slot either:
 * the bar is not the dock, and a collapsed composer has nothing in flight a
 * manager could have typed (the region latches open on the first focus).
 *
 * Expanding from the segment IS wired here, per trigger and on `click` — the
 * bar's own pattern, one line above. It used to travel through the region's
 * `onValueChange` instead, on the reasoning that Radix owns the triggers and a
 * second handler would be a second opinion about the same tap. Both halves of
 * that were measured false at 390x844:
 *
 * - Radix activates a trigger on MOUSEDOWN. Expanding there swaps this
 *   component for `ComposerModeRow` at the same JSX position, so React unmounts
 *   the trigger the manager is still pressing — before the browser applies its
 *   default focus for that mousedown, which then lands on a detached node. The
 *   focus trace: the caret effect put the caret in the textarea at 2865 ms and
 *   the browser took it back at 2867 ms, ending on the sheet root with no
 *   keyboard. On `click` the trigger is still attached when the default focus
 *   runs, the unmount happens after it, and the caret effect is last — which is
 *   why the bar beside it never had the bug.
 * - `Tabs` is controlled, and Radix's controllable-state setter is guarded by
 *   `if (nextValue !== prop)`. The trigger whose value IS the active mode never
 *   reaches `onValueChange` at all, so tapping the selected half of the toggle
 *   while collapsed did nothing whatsoever: the bar stayed, both panels stayed
 *   hidden, and focus parked on a visible, enabled tab that answered nothing.
 *
 * `onValueChange` still owns the MODE — including its one refusal — so there is
 * exactly one path for the selection and one for the expansion, rather than two
 * opinions about either.
 */
export function ComposerCollapsedRow({
  mode,
  active,
  modes,
  onExpand,
}: ComposerCollapsedRowProps): ReactNode {
  const isPrivate = mode === 'note'
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-3">
      <Button
        type="button"
        variant="outline"
        // The bar is the disclosure, and it is the only one: there is no
        // control that collapses the region again, because a composer that
        // could shut over a half-written reply is the defect row 15's bar is
        // supposed to avoid, not a feature. So this is always `false` — the
        // expanded region simply does not render it.
        aria-expanded={false}
        data-private={isPrivate ? '' : undefined}
        onClick={() => onExpand(mode)}
        className={cn(BAR_CLASS, isPrivate && PRIVATE_BAR_CLASS)}
      >
        {MODE_PLACEHOLDER[mode]}
      </Button>
      {modes.length > 1 ? (
        <ComposerSegment modes={modes} active={active} onSelect={onExpand} />
      ) : null}
    </div>
  )
}
