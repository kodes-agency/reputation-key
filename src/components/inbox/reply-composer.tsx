// Inbox detail — region 4 of the pane: the pinned composer.
//
// This file is the REGION, not a form. The reply editor and the notes form are
// passed in as slots because their state and their mutations belong to the pane
// (`inbox-detail-content.tsx` builds the nine reply mutations once and hands
// them down). What is owned here is everything around them: the bounded
// container, the Reply / Note segment, the row-9 editing band, the two caps that
// keep a long draft from pushing the footer out of the pane, and — on a phone —
// whether any of it is on screen yet at all (row 15).
//
// Plan v2.1 row 14 gives the expanded region ONE shape: a bordered
// `rounded-xl` box — the dock — with three rows. The HEAD (the Reply / Note
// segment and a per-mode state slot, `composer-mode-row.tsx`) is drawn here;
// the TEXT and the FOOT (assist tools, count, the one primary) are the slot's,
// because the slot is the only thing that knows what they are. The dock draws
// the border, the fill and the head's rule and pads nothing: each row owns its
// own inset, so a surface's text and foot run edge to edge inside the box the
// way the canvas draws them (`.ta` 10/12 px, `.dock-foot` 6 px under a rule).
//
// In NOTE mode the dock is amber (row 19) — and, because amber alone measured
// 1.47:1 at its edge (PR 3), also DASHED, and the note surface is NAMED
// `Internal note, not visible to the guest`. Amber never touches the reply
// surface: in this pane it means only "private".

import { useId, useState } from 'react'
import { PenLine } from 'lucide-react'
import { useIsMobile } from '#/components/hooks/use-mobile'
import { Tabs, TabsContent } from '#/components/ui/tabs'
import { cn } from '#/lib/utils'
import {
  ComposerCollapsedRow,
  ComposerModeRow,
  ComposerSaveStateScope,
  NOTE_SURFACE_NAME,
} from './composer-mode-row'
import type { ComposerMode } from './composer-mode-row'
import type { ReplyEditTarget } from './reply-status-view'
import type { ReplyAutosaveStatus } from './use-reply-autosave'
import type { ReactNode } from 'react'

export type { ComposerMode } from './composer-mode-row'

/**
 * Region 4's accessible name.
 *
 * The pane is four regions and only region 2 was named
 * (`inbox-case-toolbar.tsx`, `<section aria-label="Case status">`), so a screen
 * reader got one landmark out of four and no way to jump between the
 * conversation and the surface for writing into it. A stable word rather than
 * the active mode: the segment inside already says Reply or Internal note, and
 * a landmark whose name moved under the reader would be worse than none.
 */
const COMPOSER_REGION_NAME = 'Composer'

const BOTH_MODES: readonly ComposerMode[] = ['reply', 'note']

/**
 * Pinned, and bounded against the COLUMN rather than the viewport.
 *
 * `shrink-0` so the thread's scroller gives up the space instead, `max-h-[60%]`
 * of the pane's column so the region can never take the whole of it, and a flex
 * column so the slot inside can shrink to what is left. The percentage is the
 * load-bearing half: the region's budget is the column, not the screen — the
 * column is already the viewport minus the top bar, minus the 56 px header and
 * the 44 px case strip — so a cap in `svh`, which is what every cap in here
 * used to be, bounds the region against a box it does not live in. Measured
 * before the change: 1016 px of region in an 844 px sheet, `Submit for
 * approval` 256 px below a clip with `overflow: hidden` over it, and the thread
 * starved to 0 px; on a 375 px phone the primary was unreachable in EVERY
 * state, including an empty composer.
 *
 * `min-h-0` because a flex item's automatic minimum is content-based and would
 * otherwise argue with the cap. `overflow-y-auto overscroll-contain` is a
 * backstop, not the mechanism: the slot's own scroller (`reply-editor-compose`)
 * is what absorbs a long draft, so the region itself is measured at zero
 * overflow in every state — but a surface with a hard minimum height would
 * otherwise be clipped here on a short viewport, and clipped inside
 * `overflow-hidden` means unreachable. The note form and the published editor
 * were two such surfaces until they took the dock's rows too
 * (`composer-dock-rows.ts`): at 320x568 a long note scrolled this backstop by
 * 148 px with `Add note` 53.5 px below the viewport.
 *
 * `@container/reply-workspace` was declared for the language control's
 * `@min-[38rem]/reply-workspace:w-[17.5rem]` (`reply-language-select.tsx`),
 * which row 17 deletes in this PR; nothing else in `src` queries the name. It
 * is left standing rather than removed with its consumer because a container
 * declaration is not only a name — it applies `container-type: inline-size`,
 * which keeps the region's content out of its own width — and taking that away
 * is a layout change nobody measured here. Drop it in a PR that does.
 *
 * `gap-3` spaces the row-9 editing band from the dock below it. The band sits
 * ABOVE the box rather than inside it: the dock's rows are head, text and foot
 * (row 14), and a line about the whole edit belongs over all three.
 */
const REGION_CLASS =
  'flex max-h-[60%] min-h-0 shrink-0 flex-col gap-3 overflow-y-auto overscroll-contain border-t px-5 py-4 @container/reply-workspace lg:px-6'

/**
 * The same region while it is collapsed (row 15) — the bar, and nothing that
 * can grow.
 *
 * Neither the cap nor the scroller above survives here, and both are dropped
 * rather than left standing: the only visible child is a 44 px control row, so
 * `max-h-[60%]` would bound a region that is already a tenth of that and
 * `overflow-y-auto` would be a scrollport with nothing to scroll. `py-3` rather
 * than `py-4` for the same reason — the padding is around a bar now, not around
 * a form.
 *
 * `@container/reply-workspace` survives here for the same reason it survives
 * on the expanded region: collapsing must not change the containment the
 * still-mounted panels below are laid out in.
 *
 * No dock either. The bar IS the whole region while collapsed; a box drawn
 * around it and a row of hidden panels would be a border with nothing in it.
 */
const COLLAPSED_REGION_CLASS =
  'flex shrink-0 flex-col border-t px-5 py-3 @container/reply-workspace lg:px-6'

/**
 * The slot: a flex column that is allowed to SHRINK, plus the textarea's cap.
 *
 * `min-h-0 basis-auto` is what makes the bound above reach the slot's contents
 * — `basis-auto` because `TabsContent` ships `flex-1` (`flex: 1 1 0%`), and a
 * zero basis makes a content-sized flex container measure its panel as nothing.
 * With an auto basis the panel is measured at its content height and then
 * shrunk to the region's budget, which is what lets the composer pin its footer
 * against the bottom of the region.
 *
 * `[&_textarea]:max-h-80` replaces a `40svh` cap. Same job — past this height
 * the box scrolls its own content instead of pushing everything below it — but
 * a fixed height, because the box's budget is no more the viewport's than the
 * region's was. 320 px sits inside the band the old cap actually resolved to
 * (288 px at 720 px tall, 360 px at 900 px). The other thing in the slot that
 * grows without bound is the AI suggestion preview, which prints the whole
 * proposed reply and caps itself in `svh` (`reply-suggestion-preview.tsx`);
 * that one is not this file's to change, and the slot's scroller makes it
 * harmless either way. See the report.
 */
const SLOT_CLASS =
  'flex min-h-0 basis-auto flex-col rounded-md [&_textarea]:max-h-80 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-solid focus-visible:outline-1 focus-visible:outline-ring'

/**
 * The slot when the region hosts a primary of its own below it.
 *
 * `reply-editor-compose.tsx` is where this arrangement was measured: the reply
 * panel spends the region's budget by putting everything that grows in ONE
 * scroller and leaving `Submit for approval` outside it, so the primary is
 * pinned against the bottom of the region in every state — 90 layout states in
 * two engines, from 1440x900 down to 320x568, where before it sat 256 px below
 * a clip that could not scroll. A single-mode note composer needed no scroller
 * of its own because it had nothing below the form to protect; the moment the
 * region carries `Mark as handled` underneath it (row 10), it does, and the
 * extra classes are the reply path's verbatim so the two are one geometry
 * rather than two that agree today.
 *
 * `grow` is the half that does the work: the primary gets no `min-h-0`, so its
 * automatic minimum stays content-based and the whole of a deficit lands on the
 * scroller instead. `-mx-1 -mb-1 … px-1 pb-1` is 4 px of room so a focus ring on
 * the note box is not clipped by the scrollport, bled back out so the content
 * still lines up with the dock's edges; it lands inside the region's own 20 px
 * padding and so adds no overflow of its own.
 *
 * The TOP bleed (`-my-1 … p-1` before the dock) is gone on purpose. The
 * scroller now sits directly under the dock's head, and a scrollport pulled
 * 4 px up over the head's rule lets scrolled content paint across that rule.
 * The first thing in the note form is its label, not the box, so nothing's
 * ring needs room at the top.
 */
const SCROLLED_SLOT_CLASS = `${SLOT_CLASS} -mx-1 -mb-1 grow overflow-y-auto overscroll-contain px-1 pb-1`

/**
 * The dock (row 14), as the two-mode region's `Tabs` root.
 *
 * The root rather than a box inside it, because the root is ALREADY the link in
 * the bound's chain that the panels hang from (`min-h-0 grow basis-auto`, see
 * the region): a new box between them would be one more flex item that has to
 * be told to shrink, and one that forgot would push `Submit for approval` out
 * of the region again. `gap-0` because the head draws its own rule and the
 * panel pads itself.
 *
 * NOT `overflow-hidden`, though the canvas's `.dock` clips its corners. A
 * clipping box here would cut the 3 px focus ring off every control that sits
 * against its edge and would make the dock a second scrollport competing with
 * the slot's own scroller. Nothing inside draws past the corners, because
 * nothing inside has a fill of its own at the edge.
 *
 * `bg-card` is the canvas's `--surface`; `cn` in the primitive resolves it
 * against the private tone below.
 */
const DOCK_CLASS = 'min-h-0 grow basis-auto gap-0 rounded-xl border bg-card'

/**
 * Note mode (row 19): the note's surface and edge, and a DASHED edge.
 *
 * The dash is not decoration. `--warn-line` is 1.47:1 against the pane (2.17:1
 * dark), so an amber edge on a solid box is, in grayscale or to a low-vision
 * reader, the reply's box; PR 3 measured exactly that on the thread's note node
 * and answered with `border-dashed` (`note-message.tsx`). The dock matches, so
 * writing a note and reading one look like the same kind of thing. Reply mode
 * stays solid — the default `border-style` the primitive's `border` implies.
 */
const PRIVATE_DOCK_CLASS = 'border-dashed border-warn-line bg-warn-muted'

/**
 * The single-mode dock: the same box as a plain flex column, since a region
 * with one mode has no `Tabs` root to be the box. `grow` is added only beside a
 * primary, mirroring `SCROLLED_SLOT_CLASS`, so the geometry of every
 * single-mode state without one is the column it always was.
 */
const SINGLE_DOCK_CLASS = 'flex min-h-0 basis-auto flex-col rounded-xl border bg-card'

/**
 * The note panel's name, spread onto the note `TabsContent` only.
 *
 * Radix names a panel after its trigger (`aria-labelledby` → `Internal note`)
 * and spreads caller props AFTER its own, so an explicit `undefined` here is
 * what removes the reference and lets `aria-label` be the name — `aria-
 * labelledby` would otherwise win the name computation. The reply panel keeps
 * Radix's wiring untouched, which is why this is a spread and not two props
 * that would also land `undefined` on the reply panel.
 *
 * The panel is focusable (`tabIndex={0}`, Radix), so tabbing from the segment
 * into it announces `Internal note, not visible to the guest`; the note
 * form's own textarea is named by its label inside `inbox-notes-thread.tsx`,
 * which this region does not own.
 */
const NOTE_PANEL_NAMING = {
  'aria-labelledby': undefined,
  'aria-label': NOTE_SURFACE_NAME,
} as const

const isComposerMode = (value: string): value is ComposerMode =>
  value === 'reply' || value === 'note'

/**
 * Which mode is actually on screen.
 *
 * `mode` is the pane's, and the pane keeps one for the whole session, so it can
 * arrive pointing at a mode this composer does not offer — a feedback item is
 * note-only (row 10) and the previous selection may well have left `mode` on
 * `reply`. A live edit outranks both: row 9's editor is in the reply slot, and
 * nothing else may be shown while it is open.
 */
function resolveMode(
  mode: ComposerMode,
  modes: readonly ComposerMode[],
  lockedTo: ComposerMode | undefined,
): ComposerMode {
  if (lockedTo !== undefined && modes.includes(lockedTo)) return lockedTo
  if (modes.includes(mode)) return mode
  return modes.includes('reply') ? 'reply' : 'note'
}

/**
 * A slot that renders nothing is not a surface.
 *
 * `null` is what `inbox-detail-content.tsx` passes for `replySlot` in every
 * state but a compose or an open edit — `showReplyEditor` gates the SLOT, not
 * the region — so this is the pane's own signal read back, not a guess. The
 * other two falsy nodes are here because `ReactNode` admits them and a caller
 * writing `{flag && <Editor/>}` should not produce a bar onto an empty panel.
 */
const hasSurface = (slot: ReactNode): boolean =>
  slot !== null && slot !== undefined && slot !== false

/**
 * Which surface the collapsed bar names and opens onto — or `null` when this
 * region has none, in which case there is nothing to disclose and no bar.
 *
 * The active mode first, because the bar should open what the segment beside it
 * says is selected; otherwise the first offered mode that HAS a slot. That
 * second clause is the whole fix: a reply that is pending, approved, published,
 * mirrored, failed or rejected has no reply panel, and a bar reading `Reply…`
 * over it expanded the region onto nothing — measured at 390x844 across all
 * five states, region 4 went from 133 px to 101 px, no writing surface
 * appeared, and the bar did not come back for the rest of that item's visit.
 * The note form is the surface such an item actually has, so the bar says so.
 *
 * When the live-on-Google phone policy is active, modes without a surface are
 * removed before this function is called, so the bar and the segment always
 * describe the same real surface.
 */
function resolveBarSurface(
  active: ComposerMode,
  modes: readonly ComposerMode[],
  hasSlot: (mode: ComposerMode) => boolean,
): ComposerMode | null {
  if (hasSlot(active)) return active
  return modes.find((mode) => hasSlot(mode)) ?? null
}

function useComposerCollapse({
  active,
  availableModes,
  collapse,
  hasSlot,
  isMobile,
  lockedTo,
}: Readonly<{
  active: ComposerMode
  availableModes: readonly ComposerMode[]
  collapse: ComposerCollapse | undefined
  hasSlot: (mode: ComposerMode) => boolean
  isMobile: boolean
  lockedTo: ComposerMode | undefined
}>) {
  const [expandedFor, setExpandedFor] = useState<string | null>(null)
  const forcedOpen = lockedTo !== undefined || (collapse?.hasPendingWork ?? false)
  const collapsedBar =
    isMobile && collapse !== undefined && !forcedOpen && expandedFor !== collapse.itemId
      ? resolveBarSurface(active, availableModes, hasSlot)
      : null
  const collapsed = collapsedBar !== null
  const expand = (surface: ComposerMode) => {
    if (collapse === undefined || !hasSlot(surface)) return
    setExpandedFor(collapse.itemId)
    collapse.onExpand(surface)
  }
  const latchOpen = () => {
    if (collapse !== undefined && !collapsed) setExpandedFor(collapse.itemId)
  }

  return { collapsed, collapsedBar, expand, latchOpen }
}

/**
 * Row 9's band. One line, and deliberately not a heading: the editor in the
 * slot below titles itself, and a second `h2` saying the same thing would read
 * as two sections. One text node, because the sentence is pinned copy.
 */
function EditingBand({ id }: Readonly<{ id: string }>): ReactNode {
  return (
    <p
      id={id}
      className="flex shrink-0 items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs font-medium"
    >
      <PenLine aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
      Editing a live reply · republishes to Google
    </p>
  )
}

/**
 * What region 4 needs in order to open COLLAPSED on a phone (row 15), as one
 * object so it can only ever arrive whole.
 *
 * All three or none. Half of this wiring is worse than none of it: an
 * `itemId` with no `onExpand` is a composer that opens and drops the caret on
 * the floor, and an `onExpand` with no `itemId` is a composer that stays open
 * for every item the manager visits afterwards because there is nothing to
 * fence the expansion against. Omit the prop and the region is exactly what it
 * was — expanded everywhere, at every width — which is what the desktop panel
 * passes and what every existing caller gets for free.
 */
export type ComposerCollapse = Readonly<{
  /**
   * What the expansion is fenced on. The region outlives a change of
   * selection (only the two slots are keyed by item), so without this the
   * manager's tap on one item's bar would leave the next item's composer open.
   */
  itemId: string
  /**
   * Content belonging to THIS item that a bar reading `Reply…` would hide: a
   * saved draft reply, a note carried over from an earlier visit, a reopen in
   * flight. The region ORs `editTarget` in itself — that one it can see.
   *
   * It is deliberately about the item's state on ARRIVAL and nothing more.
   * Anything the manager types has to be typed into an expanded composer, and
   * the region latches expanded on the first focus that lands inside it, so a
   * half-written reply cannot be behind the bar in the first place. That is
   * also why nothing below the region has to report its draft upward.
   */
  hasPendingWork: boolean
  /**
   * Open the composer on this surface and put the caret in its field — the
   * pane's `focusComposer`, the same callback the `r` / `n` shortcuts use.
   * The region cannot do the second half itself: the caret is a counter the
   * pane owns, and both slots read it as a prop.
   */
  onExpand: (mode: ComposerMode) => void
}>

export type ReplyComposerProps = Readonly<{
  mode: ComposerMode
  onModeChange: (mode: ComposerMode) => void
  /** Non-null while an existing live reply is being edited (row 9). */
  editTarget: ReplyEditTarget
  /** Rendered in reply mode: ReplyEditor or the published editor. */
  replySlot: ReactNode
  /** Rendered in note mode: the notes form. */
  noteSlot: ReactNode
  /** Feedback items get note mode only plus their own primary (PR 5). */
  modes?: readonly ComposerMode[]
  /**
   * Phone-only policy for a reply already live on Google: remove mode controls
   * whose writing surface is unavailable instead of presenting a dead Public
   * reply choice beside the real note control.
   */
  hideUnavailableModesOnMobile?: boolean
  /**
   * The primary action of a SINGLE-MODE composer — a feedback item's
   * `Mark as handled` (row 10).
   *
   * Named for the shape it belongs to rather than for the button, because the
   * condition is the whole point: a feedback item has no reply panel at all, so
   * it never reaches `ReplyCompose` and never reaches `ReplyComposerFooter`,
   * which is where every other primary in this region comes from. That leaves
   * the note form's own `Add note` and nothing that acts on the ITEM, so the
   * region takes the action directly instead — as a node, like the two surface
   * slots, so this file still contains no button and no mutation.
   *
   * A TWO-MODE composer ignores it: there the reply panel is one arrow key away
   * and its footer owns the region's primary, and a second primary parked under
   * the note form would rebuild finding 4's competing buttons inside the fix for
   * them. It is dropped in a single-mode REPLY composer for the same reason —
   * `modes: ['reply']`, which is what a caller holding `reply.manage` without
   * `inbox.write` gets.
   *
   * Omit it (or pass `null`) and the region is exactly what it was.
   */
  singleModePrimarySlot?: ReactNode
  /**
   * Mobile only, and opt-in: row 15's collapsed bar. See `ComposerCollapse`.
   *
   * The breakpoint is NOT in here and is not a prop. The region asks
   * `useIsMobile()` — the same hook, and therefore the same 768 px line, that
   * the page already branches the whole desktop-panel / mobile-sheet choice on
   * — because whether the composer is a bar has to be knowable to JavaScript:
   * it decides what is mounted, where the caret goes and what the bar's
   * accessible name is, none of which a `max-md:` class can answer.
   */
  collapse?: ComposerCollapse
}>

type ComposerLayoutProps = Readonly<{
  active: ComposerMode
  availableModes: readonly ComposerMode[]
  band: ReactNode
  collapsed: boolean
  collapsedRow: ReactNode
  head: ReactNode
  isPrivate: boolean
  latchOpen: () => void
  noteSlot: ReactNode
  onModeChange: (mode: ComposerMode) => void
  onSaveStateChange: (status: ReplyAutosaveStatus | null) => void
  replySlot: ReactNode
  lockedTo: ComposerMode | undefined
}>

function SingleModeComposerLayout({
  active,
  band,
  collapsed,
  collapsedRow,
  head,
  isPrivate,
  latchOpen,
  noteSlot,
  onSaveStateChange,
  replySlot,
  primary,
}: Omit<ComposerLayoutProps, 'availableModes' | 'lockedTo' | 'onModeChange'> &
  Readonly<{ primary: ReactNode }>): ReactNode {
  return (
    <ComposerSaveStateScope onSaveStateChange={onSaveStateChange}>
      <section
        aria-label={COMPOSER_REGION_NAME}
        className={collapsed ? COLLAPSED_REGION_CLASS : REGION_CLASS}
        onFocus={latchOpen}
      >
        <div className="flex min-h-0 min-w-0 flex-col gap-4">
          {collapsedRow ?? band}
          <div
            hidden={collapsed}
            data-private={isPrivate ? '' : undefined}
            className={cn(
              SINGLE_DOCK_CLASS,
              primary !== null && 'grow',
              isPrivate && PRIVATE_DOCK_CLASS,
            )}
          >
            {head}
            <div
              role={isPrivate ? 'group' : undefined}
              aria-label={isPrivate ? NOTE_SURFACE_NAME : undefined}
              className={primary === null ? SLOT_CLASS : SCROLLED_SLOT_CLASS}
            >
              {active === 'reply' ? replySlot : noteSlot}
            </div>
          </div>
          {primary}
        </div>
      </section>
    </ComposerSaveStateScope>
  )
}

function TabbedComposerLayout({
  active,
  availableModes,
  band,
  collapsed,
  collapsedRow,
  head,
  isPrivate,
  latchOpen,
  lockedTo,
  noteSlot,
  onModeChange,
  onSaveStateChange,
  replySlot,
}: ComposerLayoutProps): ReactNode {
  const handleModeChange = (next: string) => {
    if (lockedTo !== undefined) return
    if (!isComposerMode(next) || !availableModes.includes(next)) return
    onModeChange(next)
  }

  return (
    <ComposerSaveStateScope onSaveStateChange={onSaveStateChange}>
      <section
        aria-label={COMPOSER_REGION_NAME}
        className={collapsed ? COLLAPSED_REGION_CLASS : REGION_CLASS}
        onFocus={latchOpen}
      >
        {band}
        <Tabs
          value={active}
          onValueChange={handleModeChange}
          data-private={!collapsed && isPrivate ? '' : undefined}
          className={
            collapsed
              ? 'min-h-0 grow basis-auto gap-4'
              : cn(DOCK_CLASS, isPrivate && PRIVATE_DOCK_CLASS)
          }
        >
          {collapsedRow ?? head}
          {availableModes.map((composerMode) => (
            <TabsContent
              key={composerMode}
              value={composerMode}
              forceMount
              hidden={collapsed || composerMode !== active}
              className={SLOT_CLASS}
              {...(composerMode === 'note' ? NOTE_PANEL_NAMING : {})}
            >
              {composerMode === 'reply' ? replySlot : noteSlot}
            </TabsContent>
          ))}
        </Tabs>
      </section>
    </ComposerSaveStateScope>
  )
}

/**
 * The composer region.
 *
 * Exactly ONE primary button is VISIBLE in here and it comes from a slot:
 * `Submit for approval` in reply mode, the note form's own submit in note mode,
 * `Review update` while a live reply is being edited, and — for a single-mode
 * item whose one mode acts on nothing (row 10's feedback items) —
 * `singleModePrimarySlot`. The segment and the head's state slot are
 * deliberately not primary, and nothing in this file is a button at all.
 *
 * The last two are the only pair that can both be on screen at once, and the
 * region does NOT arbitrate between them: the caller that supplies both nodes
 * demotes one before handing them over (`inbox-detail-content.tsx`, off
 * `feedbackHandlingAction`). This file cannot, because it sees nodes and not
 * the state that decides whether the slot holds a button or a sentence.
 *
 * Visible, not present: both panels are force-mounted (see below), so the
 * inactive slot's primary is in the document with `hidden` on its panel. A
 * check of the rule has to read the live panel — `[data-slot="tabs-content"]:
 * not([hidden])` — or it counts the one the manager cannot see.
 *
 * On a phone the region starts COLLAPSED (row 15, `collapse` below): one 44 px
 * bar with the mode toggle, and every panel hidden behind it. The bar names the
 * surface it will open, resolved against the slots this region was given rather
 * than against the active mode — `Reply…` for a draft, `Add a note…` on a
 * note-only item AND on a review whose reply is read-only, where the pane
 * passes no reply panel at all. That is the one state in which no
 * primary is visible at all, and it is the point: the region is bounded at 60 %
 * of the column, which on a 390x844 phone is a large share of everything the
 * manager can see, and an item they have just opened should show them the
 * guest's words rather than an empty text box. It never happens on the desktop
 * panel, which is unchanged and opens expanded at every state.
 */
export function ReplyComposer({
  mode,
  onModeChange,
  editTarget,
  replySlot,
  noteSlot,
  modes = BOTH_MODES,
  hideUnavailableModesOnMobile = false,
  singleModePrimarySlot,
  collapse,
}: ReplyComposerProps): ReactNode {
  /** Modes without a rendered writing surface are not phone controls the manager can use. */
  const hasSlot = (surface: ComposerMode): boolean =>
    hasSurface(surface === 'reply' ? replySlot : noteSlot)
  const isMobile = useIsMobile()
  // This is opt-in for live-on-Google replies. Other lifecycle states retain
  // their established navigation, and desktop keeps the two-tab workflow.
  const availableModes =
    isMobile && hideUnavailableModesOnMobile ? modes.filter(hasSlot) : modes
  // The lock is derived, never stored: `editTarget` is the pane's, and the one
  // thing that clears it is the editor closing (see the PR report on cancel).
  const lockedTo: ComposerMode | undefined = editTarget !== null ? 'reply' : undefined
  const active = resolveMode(mode, availableModes, lockedTo)
  /**
   * The reply surface's autosave status, as the head row prints it (row 16).
   *
   * Held HERE because this is where it is shown and nowhere else: the head is
   * the region's, and the status is produced below it, inside the reply slot,
   * by `useReplyComposer`'s autosave. The surface reports it up through
   * `ComposerSaveStateScope` (`composer-mode-row.tsx` explains why a context
   * and not a threaded callback), and it is a copy of a CLIENT lifecycle —
   * `idle` → `pending` → `saving` → `saved` / `unsaved` / `error`, the
   * coordinator's own states — never of a server record: whether the draft
   * exists on the server stays in the detail query, and nothing reads this to
   * decide anything but three words of copy.
   *
   * `null` is "no autosaving surface is mounted" — a read-only reply, a live
   * edit, a note-only item, a selection change mid-remount — and prints
   * nothing. The report hook retracts its status on unmount, so this cannot go
   * on saying `Saved` about a draft that has left the region.
   */
  const [saveState, setSaveState] = useState<ReplyAutosaveStatus | null>(null)
  const { collapsed, collapsedBar, expand, latchOpen } = useComposerCollapse({
    active,
    availableModes,
    collapse,
    hasSlot,
    isMobile,
    lockedTo,
  })
  // Per instance, not a module constant: the desktop panel is `hidden md:flex`
  // rather than unmounted, so it and the mobile sheet can both be in the
  // document at once and a fixed id would point the second band's
  // `aria-describedby` at the first band.
  const bandId = useId()
  if (availableModes.length === 0) return null
  const band = lockedTo !== undefined ? <EditingBand id={bandId} /> : null
  // Built once and used by both shapes below, so the single-mode and two-mode
  // regions cannot drift on what a collapsed region is.
  const collapsedRow =
    collapsedBar === null ? null : (
      <ComposerCollapsedRow
        mode={collapsedBar}
        active={active}
        modes={availableModes}
        onExpand={expand}
      />
    )

  // Amber, dashed and named — the three ways the dock says "private" (row 19),
  // keyed by the surface on screen and by nothing else.
  const isPrivate = active === 'note'
  // One head for both shapes, so the single-mode and two-mode docks cannot
  // drift on what the head row says.
  const head = (
    <ComposerModeRow
      modes={availableModes}
      active={active}
      saveState={saveState}
      lockedTo={lockedTo}
      lockedById={bandId}
    />
  )
  const layoutProps: ComposerLayoutProps = {
    active,
    availableModes,
    band,
    collapsed,
    collapsedRow,
    head,
    isPrivate,
    latchOpen,
    lockedTo,
    noteSlot,
    onModeChange,
    onSaveStateChange: setSaveState,
    replySlot,
  }

  if (availableModes.length < 2) {
    const primary = active === 'reply' ? null : (singleModePrimarySlot ?? null)
    return <SingleModeComposerLayout {...layoutProps} primary={primary} />
  }

  return <TabbedComposerLayout {...layoutProps} />
}
