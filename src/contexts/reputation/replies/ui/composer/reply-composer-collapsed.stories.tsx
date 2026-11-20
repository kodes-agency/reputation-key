// Region 4 at 390 px — row 15's collapsed composer.
//
// A separate file from `reply-composer.stories.tsx` on purpose. That one proves
// what the region does with its REAL slots, which is why its host carries the
// saved reply, the hoisted note and the nine mutations. Nothing here needs any
// of that: what is under test is whether the region is on screen at all, which
// surface it opens onto and where the caret lands — so the slots are two plain
// fields wired to the pane's caret counter exactly as `ReplyEditor` and
// `InboxNotesThread` are, and the host is the pane's `focusComposer` and
// nothing else. Placeholder slots would be a cheat in the other file; here the
// real ones would only hide the thing being measured.
//
// Assertions are content, roles, accessible names and behaviour. The Storybook
// Vitest project compiles no Tailwind, so the bar's 44 px — `h-11` in
// `composer-mode-row.tsx` — is NOT assertable from here and is deliberately not
// asserted; "collapsed" is read as "the bar is the region's control and the
// panels are not visible", which is true with or without a stylesheet because
// `hidden` is honoured by the UA sheet alone.
//
// The breakpoint is RESIZED, not pinned — this comment used to say the
// opposite, and the opposite was measured to be false in this Storybook.
// `@storybook/addon-vitest@10.6` awaits `page.viewport(w, h)` before running
// every composed story (`dist/vitest-plugin/test-utils.js:51-71, 120`), reading
// `parameters.viewport.defaultViewport` against `preview.tsx`'s own viewport
// table. Probed in this runner on 2026-09-12: `mobileStaff` really is a
// 390 x 844 window and `matchMedia('(max-width: 767px)')` really does match in
// it; a story with no viewport param is reset to 1200 x 900, so the width never
// leaks between stories either. The `pinMobileBreakpoint` this file used to
// install is therefore gone: `useIsMobile` is a `matchMedia` subscription and
// it is now the REAL query answering at a real 390 px, which is a strictly
// stronger claim than a patched one — a stub that always returns true would
// keep passing if `useIsMobile` stopped being consulted at all.
//
// `inbox-page.stories.tsx` still carries the older device and the older
// comment; see `inbox-mobile-390.stories.tsx` for the full measurement.
import type { Meta, StoryObj } from '@storybook/react'
import { useEffect, useRef, useState } from 'react'
import { expect, fireEvent, userEvent, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { ReplyComposer } from './reply-composer'
import type { ComposerMode } from './reply-composer'
import type { ReplyEditTarget } from './reply-status-view'
import type { ReactNode } from 'react'

const BAR_REPLY = 'Reply…'
const BAR_NOTE = 'Add a note…'
const REPLY_FIELD = 'Reply text'
const NOTE_FIELD = 'Note text'
const EDITING_BAND = 'Editing a live reply · republishes to Google'

/**
 * A slot that takes the caret the way both real slots do: a counter that is
 * zero until something asks, bumped per request, and read in an effect that
 * fires on mount as well as on change — so a field mounted with a request
 * already pending still gets the caret.
 */
function Field({
  label,
  caretRequest,
}: Readonly<{ label: string; caretRequest: number }>): ReactNode {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    if (caretRequest > 0) ref.current?.focus()
  }, [caretRequest])
  return <textarea ref={ref} aria-label={label} rows={3} />
}

type HarnessProps = Readonly<{
  modes?: readonly ComposerMode[]
  initialMode?: ComposerMode
  hasPendingWork?: boolean
  editTarget?: ReplyEditTarget
  primary?: ReactNode
  /**
   * Whether there is a reply panel at all — `inbox-detail-content.tsx` passes
   * `replySlot={showReplyEditor ? <ReplyEditor/> : null}`, and `showReplyEditor`
   * is true for a compose state or an open edit and false for all six read-only
   * ones (pending, approved, published, mirrored, failed, rejected).
   *
   * A prop rather than a second harness because `null` is the ONLY difference
   * between those two worlds as region 4 sees them: it takes nodes, not reply
   * state, so a boolean here reproduces every read-only state exactly.
   */
  replySurface?: boolean
}>

/**
 * The pane, reduced to the three things region 4 reads from it: the composer
 * mode, the caret counter, and which item is selected. `focusComposer` is the
 * pane's own, verbatim in shape — set the mode, bump the counter, fence both
 * on the item — because that is the callback `collapse.onExpand` receives.
 */
function Harness({
  modes = ['reply', 'note'],
  initialMode = 'reply',
  hasPendingWork = false,
  editTarget = null,
  primary,
  replySurface = true,
}: HarnessProps): ReactNode {
  const [mode, setMode] = useState<ComposerMode>(initialMode)
  const [itemId, setItemId] = useState('item-a')
  const [caret, setCaret] = useState({ itemId: 'item-a', mode: initialMode, seq: 0 })
  /**
   * `hasPendingWork` is a fact about the item that CAN stop being true while
   * the manager is looking at it — the pane derives it from the saved draft,
   * the carried-over note and the reopen, and clearing the box clears it. The
   * harness owns it as state rather than taking the prop straight through so a
   * story can perform exactly that: arrive with work, then clear it.
   */
  const [pending, setPending] = useState(hasPendingWork)
  const focusComposer = (next: ComposerMode) => {
    setMode(next)
    setCaret((previous) => ({ itemId, mode: next, seq: previous.seq + 1 }))
  }
  const caretFor = (surface: ComposerMode) =>
    caret.itemId === itemId && caret.mode === surface ? caret.seq : 0
  return (
    <div className="flex h-[36rem] flex-col overflow-hidden border">
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <Button variant="outline" onClick={() => setItemId('item-b')}>
          Select next item
        </Button>
        <Button variant="outline" onClick={() => setPending(false)}>
          Clear the saved draft
        </Button>
      </div>
      <ReplyComposer
        mode={mode}
        onModeChange={setMode}
        modes={modes}
        hideUnavailableModesOnMobile={!replySurface}
        editTarget={editTarget}
        replySlot={
          replySurface ? (
            <Field key={itemId} label={REPLY_FIELD} caretRequest={caretFor('reply')} />
          ) : null
        }
        noteSlot={
          <Field key={itemId} label={NOTE_FIELD} caretRequest={caretFor('note')} />
        }
        singleModePrimarySlot={primary}
        collapse={{ itemId, hasPendingWork: pending, onExpand: focusComposer }}
      />
    </div>
  )
}

const meta: Meta<typeof Harness> = {
  title: 'Inbox/ReplyComposer Collapsed',
  component: Harness,
}
export default meta

type Story = StoryObj<typeof Harness>

/**
 * 390 x 844, and nothing else: no `matchMedia` patch, no `beforeEach`, no
 * restore contract. The window really is that wide (see the header), so
 * `useIsMobile` takes the mobile branch here for the same reason a phone does.
 */
const mobile = {
  parameters: { viewport: { defaultViewport: 'mobileStaff' } },
} as const

/**
 * What a manager sees on opening an item on a phone: the bar, the toggle, and
 * no writing surface. Both mode names survive the collapse — they are the same
 * Radix tab set in both states, which is what keeps the e2e selectors at
 * `inbox-triage.spec.ts:166, 213` addressing one control rather than two.
 */
export const MobileOpensCollapsed: Story = {
  ...mobile,
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bar = canvas.getByRole('button', { name: BAR_REPLY })
    await expect(bar).toHaveAttribute('aria-expanded', 'false')
    await expect(canvas.getByRole('tab', { name: 'Public reply' })).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Internal note' })).toBeVisible()
    await expect(canvas.queryByLabelText(REPLY_FIELD)).not.toBeVisible()
    await expect(canvas.queryByLabelText(NOTE_FIELD)).not.toBeVisible()
  },
}

/** Tapping the bar opens the surface it names and takes the caret. */
export const MobileBarExpandsOntoReply: Story = {
  ...mobile,
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: BAR_REPLY }))
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await expect(canvas.getByLabelText(REPLY_FIELD)).toBeVisible()
    await expect(canvas.getByLabelText(REPLY_FIELD)).toHaveFocus()
  },
}

/**
 * A reply with no writable surface: the bar names the surface that EXISTS.
 *
 * `replySurface: false` is the pane's `replySlot={null}`, which is what it
 * passes for a reply that is pending, approved, published, mirrored, failed or
 * rejected — six of the eight states a review's reply can be in, and every one
 * of them a state a manager reaches by doing their job. The segment is
 * untouched (the pane keeps `Public reply` in every reply state, by design),
 * so the resolution has to happen where the slots are: `Add a note…`, onto the
 * note form.
 *
 * The story is written against the phone's actual sequence rather than against
 * the label alone, because the label was never the injury. Measured at 390x844
 * across all five read-only fixtures in `inbox-mobile-390.stories.tsx` while
 * the bar still read `Reply…`: the tap SHRANK region 4 from 133 px to 101 px,
 * mounted no writing surface at all, removed the bar for the rest of that
 * item's visit and left focus on the sheet root with no keyboard. After the
 * fix, the same tap takes the region to 248 px with the note box and `Add note`
 * in it. Neither number is assertable here — this runner compiles no Tailwind —
 * so what is asserted is the part that survives without a stylesheet: which
 * control the bar is, and that something to type in appears when it is used.
 */
export const MobileReadOnlyReplyBarOffersTheNote: Story = {
  ...mobile,
  render: () => <Harness replySurface={false} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // The pane may still hold `reply`, but a missing surface is not presented
    // as a phone mode at all.
    await expect(canvas.queryByRole('tablist')).toBeNull()
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: BAR_NOTE }))
    // Expanded onto a real surface, with the caret in it — rather than onto the
    // `null` slot, which is what emptied the region.
    await expect(canvas.getByLabelText(NOTE_FIELD)).toBeVisible()
    await expect(canvas.getByLabelText(NOTE_FIELD)).toHaveFocus()
    await expect(canvas.queryByLabelText(REPLY_FIELD)).toBeNull()
  },
}

/**
 * …and the missing surface has no segment half on a phone.
 *
 * A read-only reply used to retain `Public reply` beside the note bar, even
 * though it had no reply slot. The phone now exposes only the real note
 * surface, regardless of which mode the pane still remembers.
 */
export const MobileReadOnlyReplyRefusesTheEmptySurface: Story = {
  ...mobile,
  render: () => <Harness replySurface={false} initialMode="note" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('tablist')).toBeNull()
    await expect(canvas.queryByRole('tab', { name: 'Public reply' })).toBeNull()
    await expect(canvas.getByRole('button', { name: BAR_NOTE })).toBeVisible()
    await expect(canvas.getByLabelText(NOTE_FIELD)).not.toBeVisible()
  },
}

/**
 * The keyboard route. The `r` / `n` shortcuts are inert on mobile
 * (`handleInboxShortcut` returns early), so the bar is the only way in from a
 * keyboard — and it has to be a real control for that to be true.
 */
export const MobileBarOpensFromTheKeyboard: Story = {
  ...mobile,
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    canvas.getByRole('button', { name: BAR_REPLY }).focus()
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByLabelText(REPLY_FIELD)).toHaveFocus()
  },
}

/**
 * Tapping the other mode opens ONTO it, rather than opening on the last one.
 *
 * The `toHaveFocus` on the last line is REAL about the caret request and NOT
 * real about the ordering that used to lose it, and the difference matters
 * enough to name: `userEvent.click` applies focus in software
 * (`element.focus()` between its own synthetic events), so the browser's own
 * default focus action for the mousedown — the thing that arrived late, found
 * the trigger detached and dropped the caret on the sheet root — never happens
 * in this runner at all. Measured in Chromium at 390x844 while the bug was
 * live: `focusin textarea @2865`, `focusout textarea @2867`, `focusin
 * div[Review detail] @2869`. This story was green throughout.
 *
 * `MobileModeExpandsOnClickNotMouseDown` below is the falsifiable half — it
 * pins the mechanism (which EVENT expands) rather than the symptom, because the
 * mechanism is the part a runner without default actions can still see.
 */
export const MobileModeExpandsOntoNotes: Story = {
  ...mobile,
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await expect(canvas.getByLabelText(NOTE_FIELD)).toBeVisible()
    await expect(canvas.getByLabelText(NOTE_FIELD)).toHaveFocus()
    await expect(canvas.getByLabelText(REPLY_FIELD)).not.toBeVisible()
  },
}

/**
 * The collapsed segment expands on CLICK, and must not expand on mousedown.
 *
 * Radix activates a `TabsTrigger` on `mousedown`. While the expansion hung off
 * `onValueChange`, that meant React unmounted `ComposerCollapsedRow` — and with
 * it the very trigger under the finger — before the browser applied its default
 * focus for that same mousedown, which then landed on a detached node and fell
 * through to the sheet root. The manager had to tap the box a second time to
 * get a keyboard.
 *
 * Two synthetic events instead of one `userEvent.click`, because that is what
 * makes the claim checkable here: the assertion between them is that the region
 * is STILL collapsed after the mousedown. It fails on the old code, where the
 * same mousedown had already expanded the region and moved the caret.
 *
 * What this cannot prove is the consequence — no synthetic event carries a
 * default action, so the late browser focus that produced the dropped caret has
 * no counterpart in this runner. That half is measured in a real Chromium at
 * 390x844: after the fix the trace reads `focusin button[Internal note] @2917`,
 * `focusout button[Internal note] @2928`, `focusin textarea @2930`, and the
 * textarea keeps the caret — the browser's focus lands on a trigger that is
 * still attached, the unmount follows it, and the caret effect is last.
 */
export const MobileModeExpandsOnClickNotMouseDown: Story = {
  ...mobile,
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const noteTab = canvas.getByRole('tab', { name: 'Internal note' })
    fireEvent.mouseDown(noteTab)
    // Radix has moved the selection — and the bar has followed it onto the
    // surface it will open — but nothing has expanded yet.
    await expect(canvas.getByRole('button', { name: BAR_NOTE })).toBeVisible()
    await expect(canvas.getByLabelText(NOTE_FIELD)).not.toBeVisible()
    fireEvent.click(noteTab)
    await expect(canvas.queryByRole('button', { name: BAR_NOTE })).toBeNull()
    await expect(canvas.getByLabelText(NOTE_FIELD)).toBeVisible()
  },
}

/**
 * Tapping the segment half that is ALREADY selected expands the region too.
 *
 * `Tabs` is controlled here, and Radix's controllable-state setter is guarded
 * by `if (nextValue !== prop)` — so the trigger whose value is the active mode
 * never reaches `onValueChange`, and while the expansion lived there this tap
 * did nothing at all: the bar stayed, both panels stayed hidden, and focus
 * parked on a visible, enabled tab that answered nothing. A per-trigger
 * `onClick` has no such guard.
 *
 * Fully falsifiable in this runner: the gesture is one ordinary click and the
 * assertions are what is on screen after it, both of which fail on the old
 * code for the reason above.
 */
export const MobileSelectedModeExpands: Story = {
  ...mobile,
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const replyTab = canvas.getByRole('tab', { name: 'Public reply' })
    await expect(replyTab).toHaveAttribute('aria-selected', 'true')
    await userEvent.click(replyTab)
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await expect(canvas.getByLabelText(REPLY_FIELD)).toBeVisible()
  },
}

/**
 * Expanded is terminal for the item: there is no control that collapses it
 * again, and moving between the two surfaces does not bring the bar back.
 */
export const MobileStaysExpandedForTheItem: Story = {
  ...mobile,
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: BAR_REPLY }))
    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    await userEvent.click(canvas.getByRole('tab', { name: 'Public reply' }))
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await expect(canvas.getByLabelText(REPLY_FIELD)).toBeVisible()
  },
}

/** A different item is a different composer: it starts collapsed again. */
export const MobileNextItemStartsCollapsed: Story = {
  ...mobile,
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: BAR_REPLY }))
    await expect(canvas.getByLabelText(REPLY_FIELD)).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Select next item' }))
    await expect(canvas.getByRole('button', { name: BAR_REPLY })).toBeVisible()
    await expect(canvas.getByLabelText(REPLY_FIELD)).not.toBeVisible()
  },
}

/**
 * A saved draft, a note carried over, a reopen in flight: anything the bar
 * would hide opens the composer instead. Collapsing over half a reply would
 * file it behind a control that says `Reply…`.
 */
export const MobilePendingWorkOpensExpanded: Story = {
  ...mobile,
  render: () => <Harness hasPendingWork />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await expect(canvas.getByLabelText(REPLY_FIELD)).toBeVisible()
  },
}

/**
 * The focus latch: a composer forced open by work on arrival must not snap shut
 * the moment that work stops existing.
 *
 * This is the half of "it cannot collapse over unsaved content" that
 * `MobilePendingWorkOpensExpanded` above cannot see. `hasPendingWork` is a fact
 * about the item on ARRIVAL — the pane derives it from the saved draft — so
 * clearing the box to start the reply again turns it false, and with nothing
 * else holding the region open the bar would come back over a manager who is
 * mid-sentence. `ReplyComposer` latches on any `focusin` inside an open region
 * for exactly this, and the latch is earlier than the first keystroke by
 * construction: you cannot type into a field you have not focused.
 *
 * The click on `Clear the saved draft` is what makes this falsifiable rather
 * than decorative — without it the region would still be forced open and the
 * assertion would hold for the wrong reason.
 */
export const MobileStaysOpenAfterTheDraftIsCleared: Story = {
  ...mobile,
  render: () => <Harness hasPendingWork />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Arrives open, on the work.
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    // The manager puts the caret in the box — the latch.
    canvas.getByLabelText(REPLY_FIELD).focus()
    // …and then clears what was saved, which is what would otherwise collapse
    // the region under their hands.
    await userEvent.click(canvas.getByRole('button', { name: 'Clear the saved draft' }))
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await expect(canvas.getByLabelText(REPLY_FIELD)).toBeVisible()
  },
}

/**
 * The same clearing WITHOUT a focus first, which is the control for the story
 * above: nothing has been typed, nothing is latched, so the region is free to
 * go back to being a bar — and does. That is the behaviour, not a bug: a
 * composer the manager never touched, on an item whose draft has gone, is
 * exactly the case row 15's bar exists for.
 */
export const MobileCollapsesAgainIfNothingWasTouched: Story = {
  ...mobile,
  render: () => <Harness hasPendingWork />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await userEvent.click(canvas.getByRole('button', { name: 'Clear the saved draft' }))
    await expect(canvas.getByRole('button', { name: BAR_REPLY })).toBeVisible()
  },
}

/** Row 9's edit target forces the region open and cannot be collapsed. */
export const MobileEditTargetOpensExpanded: Story = {
  ...mobile,
  render: () => <Harness editTarget="published" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await expect(canvas.getByText(EDITING_BAND)).toBeVisible()
    await expect(canvas.getByRole('tab', { name: 'Internal note' })).toHaveAttribute(
      'aria-disabled',
      'true',
    )
  },
}

/**
 * A note-only item (row 10). The bar names the surface it opens — there is no
 * reply to write — and `Mark as handled` keeps its place beside it: collapsing
 * gives the manager back the viewport, it does not take away the one action the
 * item exists for.
 */
export const MobileNoteOnlyKeepsItsPrimary: Story = {
  ...mobile,
  render: () => (
    <Harness
      modes={['note']}
      initialMode="note"
      primary={<Button>Mark as handled</Button>}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: BAR_NOTE })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Mark as handled' })).toBeVisible()
    await expect(canvas.queryByRole('tab')).toBeNull()
    await expect(canvas.getByLabelText(NOTE_FIELD)).not.toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: BAR_NOTE }))
    await expect(canvas.getByLabelText(NOTE_FIELD)).toHaveFocus()
  },
}

/**
 * The desktop, unchanged: no bar in any state, the composer open on arrival.
 *
 * The other half of the breakpoint, and now the same mechanism from both sides:
 * `desktopManager` really is a 1440 px window, `mobileStaff` really is a 390 px
 * one, and `useIsMobile` is the real `matchMedia` in both. That symmetry is
 * what makes the pair falsifiable — with the mobile side patched, this story
 * could have passed for the second-best reason (the patch simply not being
 * installed) rather than because the hook answered `false`.
 */
export const DesktopOpensExpanded: Story = {
  parameters: { viewport: { defaultViewport: 'desktopManager' } },
  render: () => <Harness />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByRole('button', { name: BAR_REPLY })).toBeNull()
    await expect(canvas.queryByRole('button', { name: BAR_NOTE })).toBeNull()
    await expect(canvas.getByLabelText(REPLY_FIELD)).toBeVisible()
  },
}
