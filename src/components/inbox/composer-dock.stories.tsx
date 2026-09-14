// Region 4 as the DOCK — plan v2.1 rows 14, 15, 16 and 19, at 720 and 390.
//
// A file of its own, beside `reply-composer.stories.tsx` and
// `reply-composer-collapsed.stories.tsx`, because what is under test is the
// CHROME the region draws around its slots and nothing inside them: the head
// row, what its state slot says per mode, the channel a surface reports its
// autosave status through, and the three ways note mode says "private". So the
// slots are deliberately plain: a textarea for the note, and for the reply a
// field that calls `useComposerSaveStateReport` — the one line `ReplyCompose`
// needs — with buttons that drive the status it reports. That proves the
// channel end to end (report → head, unmount → retracted) without depending on
// the real editor, whose autosave the other two files already drive for real.
//
// Assertions are roles, names, text and attributes. The Storybook Vitest
// project compiles NO Tailwind (contract), so nothing here reads a pixel: the
// dashed edge and the amber are asserted as the class strings and the
// `data-private` attribute the region stamps for exactly this reason, and the
// 42 px head, the 36 px thumbs and the wrap at 320 are measured in a real
// browser against `pnpm storybook` — see the PR report — not here.
import type { Meta, StoryObj } from '@storybook/react'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'
import { Button } from '#/components/ui/button'
import { useComposerSaveStateReport } from './composer-mode-row'
import { ReplyComposer } from './reply-composer'
import { ReplyComposerFooter } from './reply-composer-footer'
import type { ComposerMode } from './reply-composer'
import type { ReplyAutosaveStatus } from './use-reply-autosave'
import type { ReactNode } from 'react'

const REPLY_FIELD = 'Reply text'
const NOTE_FIELD = 'Note text'
const NOT_VISIBLE = 'Not visible to the guest'
const NOTE_SURFACE_NAME = 'Internal note, not visible to the guest'
const GUARANTEE = 'Nothing publishes until a manager approves it'
const STATUSES: readonly ReplyAutosaveStatus[] = [
  'idle',
  'pending',
  'saving',
  'saved',
  'unsaved',
  'error',
]

/** The desktop pane's share of a 1440 px split, and the canvas width. */
const PANE_WIDTH_PX = 720
/** The staff phone the sheet is designed at (plan row 20). */
const PHONE_WIDTH_PX = 390

/**
 * A reply surface reduced to the one thing the head reads from it: the status
 * it reports. `ReplyCompose` reports `state.autosave.status`; this reports
 * whatever the story last pressed.
 */
function ReportingSurface(): ReactNode {
  const [status, setStatus] = useState<ReplyAutosaveStatus>('idle')
  useComposerSaveStateReport(status)
  return (
    <div className="flex flex-col gap-2 p-3">
      <textarea aria-label={REPLY_FIELD} rows={3} />
      <div className="flex flex-wrap gap-1">
        {STATUSES.map((next) => (
          <Button key={next} size="sm" variant="ghost" onClick={() => setStatus(next)}>
            {`Report ${next}`}
          </Button>
        ))}
      </div>
    </div>
  )
}

/**
 * A reply surface in `ReplyCompose`'s own geometry — one scroller that takes
 * everything that grows, and the primary OUTSIDE it — holding far more than
 * the region can show. The dock is a new link between the region's bound and
 * that scroller; this is what a real browser measures it against (see the PR
 * report), since the region's 60 % cap reaching the scroller THROUGH the dock
 * is the one geometry claim the dock could break.
 */
function TallReplySurface(): ReactNode {
  useComposerSaveStateReport('saved')
  return (
    <div className="flex min-h-0 grow basis-auto flex-col gap-4">
      <div
        data-testid="surface-scroller"
        className="-mx-1 -my-1 flex min-h-0 grow basis-auto flex-col overflow-y-auto overscroll-contain p-1"
      >
        <textarea aria-label={REPLY_FIELD} rows={3} />
        <div className="shrink-0" style={{ height: 1200 }} />
      </div>
      <div className="flex justify-end p-1.5">
        <Button size="sm">Submit for approval</Button>
      </div>
    </div>
  )
}

/** A note form with the same excess, for the single-mode dock with a primary. */
function TallNoteSurface(): ReactNode {
  return (
    <div className="flex flex-col gap-2 p-3">
      <textarea aria-label={NOTE_FIELD} rows={3} />
      <div className="shrink-0" style={{ height: 1200 }} />
    </div>
  )
}

type HarnessProps = Readonly<{
  width?: number
  modes?: readonly ComposerMode[]
  initialMode?: ComposerMode
  /** Pass `collapse` so a phone opens on the bar (row 15). */
  collapsible?: boolean
  /**
   * Put the region in a 600 px pane column under a thread, with surfaces that
   * hold far more than it can show — the bound, measured.
   */
  tall?: boolean
}>

/** The pane, as much of it as the dock reads: the mode and the two slots. */
function DockHarness({
  width = PANE_WIDTH_PX,
  modes = ['reply', 'note'],
  initialMode = 'reply',
  collapsible = false,
  tall = false,
}: HarnessProps): ReactNode {
  const [mode, setMode] = useState<ComposerMode>(initialMode)
  // Stands in for a submit: the pane swaps the compose box for a read-only
  // reply by passing `replySlot={null}`, which unmounts the reporting surface.
  const [hasReplySurface, setHasReplySurface] = useState(true)
  const composer = (
    <ReplyComposer
      mode={mode}
      onModeChange={setMode}
      modes={modes}
      editTarget={null}
      replySlot={
        hasReplySurface ? tall ? <TallReplySurface /> : <ReportingSurface /> : null
      }
      noteSlot={
        tall ? <TallNoteSurface /> : <textarea aria-label={NOTE_FIELD} rows={3} />
      }
      singleModePrimarySlot={
        tall && modes.length === 1 ? <Button size="sm">Mark as handled</Button> : null
      }
      collapse={
        collapsible
          ? { itemId: 'item-a', hasPendingWork: false, onExpand: setMode }
          : undefined
      }
    />
  )
  if (tall) {
    // The pane's anatomy, reduced: a column of fixed height, a thread that
    // scrolls, and region 4 pinned under it (`inbox-detail-content.tsx`).
    return (
      <div
        data-testid="pane-column"
        style={{ width, height: 600 }}
        className="flex min-w-0 flex-col overflow-hidden border-l"
      >
        <div className="min-h-0 flex-1 overflow-y-auto p-5">Thread</div>
        {composer}
      </div>
    )
  }
  return (
    <div style={{ width }} className="flex flex-col gap-2">
      <Button variant="outline" onClick={() => setHasReplySurface(false)}>
        Submit the reply
      </Button>
      {composer}
    </div>
  )
}

const meta: Meta<typeof DockHarness> = {
  title: 'Inbox/Composer Dock',
  component: DockHarness,
  // Fullscreen, so a 390 px harness in a 390 px window is not pushed past it
  // by the canvas's default 1 rem padding: measured, that padding alone put
  // 16 px of horizontal overflow on the document at 390 and 320.
  parameters: { layout: 'fullscreen' },
}
export default meta

type Story = StoryObj<typeof DockHarness>

/** A story's 390 px twin: the harness at the phone's width, in a phone window. */
function onPhone(story: Story): Story {
  return {
    ...story,
    args: { ...story.args, width: PHONE_WIDTH_PX },
    parameters: { ...story.parameters, viewport: { defaultViewport: 'mobileStaff' } },
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function dockOf(canvasElement: HTMLElement): HTMLElement {
  const dock = canvasElement.querySelector('[data-slot="tabs"]')
  if (!(dock instanceof HTMLElement)) throw new Error('The dock was not rendered')
  return dock
}

/** The head row is the tablist's parent: segment first, state slot after. */
function headOf(canvasElement: HTMLElement): HTMLElement {
  const head = within(canvasElement).getByRole('tablist').parentElement
  if (!(head instanceof HTMLElement)) throw new Error('The head row was not rendered')
  return head
}

/** The one polite live region, which is the reply-mode state slot. */
function saveStateOf(canvasElement: HTMLElement): HTMLElement {
  const live = canvasElement.querySelectorAll('[aria-live="polite"]')
  expect(live).toHaveLength(1)
  const node = live[0]
  if (!(node instanceof HTMLElement)) throw new Error('No save state slot')
  return node
}

/** The words a tab PRINTS: its own text nodes, without the `aria-hidden` key. */
function printedLabel(tab: HTMLElement): string {
  return Array.from(tab.childNodes)
    .filter((node) => node.nodeType === Node.TEXT_NODE)
    .map((node) => node.textContent ?? '')
    .join('')
    .trim()
}

/**
 * Row 15, and the WCAG 2.5.3 check it rests on: the visible labels are the
 * short ones, the accessible names are the pinned long ones, and each visible
 * label is contained in its name — as words, case-insensitively, which is how
 * the criterion is read (see `MODE_SHORT_LABEL`).
 */
function expectShortLabelsInsidePinnedNames(canvasElement: HTMLElement): void {
  const canvas = within(canvasElement)
  const reply = canvas.getByRole('tab', { name: 'Public reply' })
  const note = canvas.getByRole('tab', { name: 'Internal note' })
  expect(printedLabel(reply)).toBe('Reply')
  expect(printedLabel(note)).toBe('Note')
  for (const tab of [reply, note]) {
    const name = (tab.getAttribute('aria-label') ?? '').toLowerCase()
    expect(name.split(' ')).toContain(printedLabel(tab).toLowerCase())
    // The key hint is printed but not spoken, and binds nothing itself.
    const key = tab.querySelector('kbd')
    expect(key).not.toBeNull()
    expect(key).toHaveAttribute('aria-hidden', 'true')
  }
  expect(reply.querySelector('kbd')?.textContent).toBe('R')
  expect(note.querySelector('kbd')?.textContent).toBe('N')
}

/** Nothing on the reply surface wears a warn token: amber means only private. */
function expectReplySurfaceNeutral(canvasElement: HTMLElement): void {
  const dock = dockOf(canvasElement)
  const head = headOf(canvasElement)
  const track = within(canvasElement).getByRole('tablist')
  const replyTab = within(canvasElement).getByRole('tab', { name: 'Public reply' })
  expect(dock).not.toHaveAttribute('data-private')
  expect(track).not.toHaveAttribute('data-private')
  for (const element of [dock, head, track, replyTab]) {
    expect(element.className).not.toMatch(/warn/)
  }
  expect(dock.className).not.toMatch(/border-dashed/)
  expect(dock.className).toMatch(/rounded-\[10px\]/)
  expect(dock.className).toMatch(/bg-card/)
}

/**
 * Note mode says private three ways, none of them the amber alone (row 19 and
 * PR 3's measurement): a DASHED edge, the printed `Not visible to the guest`,
 * and the note surface's accessible name. And the only lock is the tab's.
 */
function expectNoteSurfacePrivate(canvasElement: HTMLElement): void {
  const canvas = within(canvasElement)
  const dock = dockOf(canvasElement)
  const track = canvas.getByRole('tablist')
  expect(dock).toHaveAttribute('data-private')
  expect(track).toHaveAttribute('data-private')
  expect(dock.className).toMatch(/border-dashed/)
  expect(dock.className).toMatch(/border-warn-line/)
  expect(dock.className).toMatch(/bg-warn-muted/)
  expect(track.className).toMatch(/bg-warn-track/)
  expect(canvas.getByRole('tab', { name: 'Internal note' }).className).toMatch(
    /data-\[state=active\]:text-warn/,
  )
  expect(within(headOf(canvasElement)).getByText(NOT_VISIBLE)).toBeVisible()
  const panel = canvas.getByRole('tabpanel', { name: NOTE_SURFACE_NAME })
  expect(panel).toBeVisible()
  expect(within(panel).getByLabelText(NOTE_FIELD)).toBeVisible()
  // No live region in note mode: the slot is a statement, not a status.
  expect(canvasElement.querySelectorAll('[aria-live="polite"]')).toHaveLength(0)
  // The one lock in the pane is the Note tab's own glyph (row 12).
  const locks = Array.from(dock.querySelectorAll('svg.lucide-lock'))
  expect(locks).toHaveLength(1)
  expect(locks[0]?.closest('[role="tab"]')).toHaveAccessibleName('Internal note')
}

// ─── reply mode ─────────────────────────────────────────────────────────────

/**
 * The dock at rest in reply mode: one box, the segment in its head with the
 * short labels and their keys, and a state slot that says nothing yet — the
 * surface has saved nothing in this visit, and neither `Saved` nor `Not saved`
 * is true of that. The slot's live region is already mounted, so the first
 * `Saving…` is announced.
 */
export const ReplyHeadAt720: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expectShortLabelsInsidePinnedNames(canvasElement)
    expect(canvas.getByRole('tab', { name: 'Public reply' })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expectReplySurfaceNeutral(canvasElement)
    expect(saveStateOf(canvasElement).textContent).toBe('')
    // Head first, then the panel: the segment is not inside the writing surface.
    const head = headOf(canvasElement)
    expect(head.parentElement).toBe(dockOf(canvasElement))
    expect(head.nextElementSibling).toHaveAttribute('data-slot', 'tabs-content')
    expect(canvas.queryByText(NOT_VISIBLE)).toBeNull()
  },
}

export const ReplyHeadAt390: Story = onPhone(ReplyHeadAt720)

/**
 * Row 16: the status is produced BELOW the head, inside the reply slot, and
 * printed IN the head. Every autosave status, in the head's three words; and
 * when the surface leaves the region — here a submit swapping it for a
 * read-only reply — the status leaves with it rather than saying `Saved` about
 * a draft that is no longer there.
 */
export const SaveStateTravelsUpAt720: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const expectState = async (status: ReplyAutosaveStatus, text: string) => {
      await userEvent.click(canvas.getByRole('button', { name: `Report ${status}` }))
      await waitFor(() => expect(saveStateOf(canvasElement).textContent).toBe(text))
    }
    await expectState('pending', 'Saving…')
    await expectState('saving', 'Saving…')
    await expectState('saved', 'Saved')
    expect(saveStateOf(canvasElement).className).not.toMatch(/text-destructive/)
    await expectState('unsaved', 'Not saved')
    expect(saveStateOf(canvasElement).className).not.toMatch(/text-destructive/)
    await expectState('error', 'Not saved')
    expect(saveStateOf(canvasElement).className).toMatch(/text-destructive/)
    await expectState('idle', '')
    await expectState('saved', 'Saved')

    // The slot is the head's; the reply surface itself prints no status line.
    expect(headOf(canvasElement).contains(saveStateOf(canvasElement))).toBe(true)
    expect(canvasElement.textContent ?? '').not.toMatch(/publishes only after approval/)

    await userEvent.click(canvas.getByRole('button', { name: 'Submit the reply' }))
    await waitFor(() => expect(saveStateOf(canvasElement).textContent).toBe(''))
  },
}

export const SaveStateTravelsUpAt390: Story = onPhone(SaveStateTravelsUpAt720)

/**
 * Both panels are force-mounted, so the reply surface keeps reporting while
 * the note is on screen. The head follows the MODE, not the last report: note
 * mode prints the privacy sentence and no status, and coming back prints the
 * status the surface kept.
 */
export const SlotFollowsTheModeAt720: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Report saved' }))
    await waitFor(() => expect(saveStateOf(canvasElement).textContent).toBe('Saved'))

    await userEvent.click(canvas.getByRole('tab', { name: 'Internal note' }))
    await waitFor(() => expect(canvas.getByText(NOT_VISIBLE)).toBeVisible())
    expect(canvas.queryByText('Saved')).toBeNull()
    expectNoteSurfacePrivate(canvasElement)

    await userEvent.click(canvas.getByRole('tab', { name: 'Public reply' }))
    await waitFor(() => expect(saveStateOf(canvasElement).textContent).toBe('Saved'))
    expect(canvas.queryByText(NOT_VISIBLE)).toBeNull()
    expectReplySurfaceNeutral(canvasElement)
  },
}

// ─── note mode ──────────────────────────────────────────────────────────────

/** Row 19 at the desktop width. */
export const NoteModeIsPrivateAt720: Story = {
  args: { initialMode: 'note' },
  play: async ({ canvasElement }) => {
    expectShortLabelsInsidePinnedNames(canvasElement)
    expectNoteSurfacePrivate(canvasElement)
  },
}

/**
 * Row 19 at the phone's width — and `Not visible to the guest` still printed.
 * The plan scoped the sentence to the desktop on the belief that the amber
 * carries it on a phone; PR 3 measured the amber edge at 1.47:1, and nothing
 * else visible on the phone's note dock says the guest will not see it.
 */
export const NoteModeIsPrivateAt390: Story = onPhone(NoteModeIsPrivateAt720)

/**
 * A single-mode note dock — a feedback item's composer (row 10): no segment,
 * because one mode is not a choice, but the same box, the same dashed edge and
 * the same sentence, and the surface still named for what it is. The lock goes
 * with the segment: a dock with no Note tab has no lock at all.
 */
export const SingleModeNoteDockAt720: Story = {
  args: { modes: ['note'], initialMode: 'note' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvas.queryByRole('tablist')).toBeNull()
    const surface = canvas.getByRole('group', { name: NOTE_SURFACE_NAME })
    expect(within(surface).getByLabelText(NOTE_FIELD)).toBeVisible()
    const dock = surface.parentElement
    if (!(dock instanceof HTMLElement)) throw new Error('No dock around the note')
    expect(dock).toHaveAttribute('data-private')
    expect(dock.className).toMatch(/border-dashed/)
    expect(dock.className).toMatch(/rounded-\[10px\]/)
    expect(within(dock).getByText(NOT_VISIBLE)).toBeVisible()
    expect(dock.querySelectorAll('svg.lucide-lock')).toHaveLength(0)
  },
}

export const SingleModeNoteDockAt390: Story = onPhone(SingleModeNoteDockAt720)

// ─── the bound, through the dock ────────────────────────────────────────────

/**
 * A reply surface far taller than the region may be. The dock is the region's
 * `Tabs` root, so it sits on the chain the 60 % cap travels down to the
 * surface's scroller. Structure only here — the primary is in the live panel
 * and is the region's one primary; that it stays inside the region's box, and
 * the region inside 60 % of the column, is measured in a real browser.
 */
export const TallReplyKeepsItsPrimaryAt720: Story = {
  args: { tall: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const primaries = Array.from(
      canvasElement.querySelectorAll('button[data-variant="default"]'),
    ).filter((button) => button.closest('[data-slot="tabs-content"][hidden]') === null)
    expect(primaries).toHaveLength(1)
    expect(primaries[0]).toHaveAccessibleName('Submit for approval')
    await waitFor(() => expect(saveStateOf(canvasElement).textContent).toBe('Saved'))
    expect(canvas.getByTestId('surface-scroller')).toBeVisible()
  },
}

export const TallReplyKeepsItsPrimaryAt390: Story = onPhone(TallReplyKeepsItsPrimaryAt720)

/**
 * The single-mode note dock with row 10's primary under it — the one shape in
 * which the dock is a plain `div` rather than the `Tabs` root, and in which the
 * region's own scroller (`SCROLLED_SLOT_CLASS`) sits inside the dock.
 */
export const TallFeedbackNoteKeepsItsPrimaryAt720: Story = {
  args: { tall: true, modes: ['note'], initialMode: 'note' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const surface = canvas.getByRole('group', { name: NOTE_SURFACE_NAME })
    const primary = canvas.getByRole('button', { name: 'Mark as handled' })
    // Outside the dock, after it: the item's action is not part of the note.
    expect(surface.parentElement?.contains(primary)).toBe(false)
    expect(surface.parentElement?.compareDocumentPosition(primary) ?? 0).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
  },
}

export const TallFeedbackNoteKeepsItsPrimaryAt390: Story = onPhone(
  TallFeedbackNoteKeepsItsPrimaryAt720,
)

// ─── the collapsed bar (390 only: the bar is a phone's) ─────────────────────

/**
 * Row 20: the collapsed bar opening onto a note wears the note's amber — and,
 * for the reason the dock does, its dashed edge; its words (`Add a note…`)
 * are the rest. It stays the 44 px bar (`h-11`), which is not asserted here.
 */
export const CollapsedNoteBarIsPrivateAt390: Story = onPhone({
  args: { modes: ['note'], initialMode: 'note', collapsible: true },
  play: async ({ canvasElement }) => {
    const bar = within(canvasElement).getByRole('button', { name: 'Add a note…' })
    expect(bar).toHaveAttribute('data-private')
    expect(bar.className).toMatch(/border-dashed/)
    expect(bar.className).toMatch(/bg-warn-muted/)
    expect(bar.className).toMatch(/h-11/)
    expect(bar).toHaveAttribute('data-variant', 'outline')
  },
})

/** The same bar opening onto a reply keeps no amber at all. */
export const CollapsedReplyBarStaysNeutralAt390: Story = onPhone({
  args: { collapsible: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const bar = canvas.getByRole('button', { name: 'Reply…' })
    expect(bar).not.toHaveAttribute('data-private')
    expect(bar.className).not.toMatch(/warn/)
    expect(canvas.getByRole('tablist')).not.toHaveAttribute('data-private')
    // Collapsed, there is no dock and no head: the bar is the region.
    expect(dockOf(canvasElement).className).not.toMatch(/rounded-\[10px\]/)
    expect(canvasElement.querySelectorAll('[aria-live="polite"]')).toHaveLength(0)
  },
})

// ─── the guarantee, moved ───────────────────────────────────────────────────

const footerArgs = {
  status: 'saved',
  error: null,
  canSubmit: true,
  submitBlockedReason: null,
  disabled: false,
  isSubmitting: false,
  onRetrySave: async () => undefined,
  onSubmit: async () => undefined,
} as const

/**
 * Row 14: the line under the box is gone, and the guarantee it carried is on
 * the control that submits. The toast carries it on a phone, where a tooltip
 * never opens (`use-reply-actions.ts`).
 */
export const SubmitCarriesTheGuaranteeAt720: Story = {
  render: () => (
    <div style={{ width: PANE_WIDTH_PX }}>
      <ReplyComposerFooter {...footerArgs} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    expect(canvasElement.querySelectorAll('[aria-live="polite"]')).toHaveLength(0)
    expect(canvasElement.textContent ?? '').not.toMatch(/publishes only after approval/)
    expect(canvasElement.textContent ?? '').not.toMatch(/Draft saved/)
    const submit = canvas.getByRole('button', { name: 'Submit for approval' })
    expect(submit).toHaveAttribute('data-variant', 'default')
    await userEvent.hover(submit)
    const tooltip = await within(document.body).findByRole('tooltip')
    expect(tooltip).toHaveTextContent(GUARANTEE)
    await waitFor(() => expect(submit).toHaveAccessibleDescription(GUARANTEE))
    await userEvent.unhover(submit)
  },
}

/**
 * The blocked reason still describes the refused submit. The tooltip is on the
 * same button now, and `TooltipTrigger asChild` lets the child's props win — so
 * this is the regression guard for the id surviving the merge.
 */
export const BlockedSubmitKeepsItsReasonAt720: Story = {
  render: () => (
    <div style={{ width: PANE_WIDTH_PX }}>
      <ReplyComposerFooter
        {...footerArgs}
        canSubmit={false}
        submitBlockedReason="Fill every template placeholder before publishing: {guest_name}."
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const submit = within(canvasElement).getByRole('button', {
      name: 'Submit for approval',
    })
    expect(submit).toBeDisabled()
    expect(submit).toHaveAccessibleDescription(
      'Fill every template placeholder before publishing: {guest_name}.',
    )
  },
}
