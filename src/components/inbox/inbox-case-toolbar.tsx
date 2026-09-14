import { useEffect, useId, useState } from 'react'
import { ChevronDown, Clock3, RotateCcw } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { ButtonGroup } from '#/components/ui/button-group'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '#/components/ui/popover'
import { cn } from '#/lib/utils'
import { usePermissions } from '#/shared/hooks/usePermissions'
import type {
  FeedbackHandlingState,
  InboxItem,
  ResponseTargetView,
} from '#/contexts/inbox/application/public-api'
import { feedbackHandlingStatusLabel } from './feedback-handling-presentation'
import { CASE_GROUP_CLASS, CaseFact } from './inbox-case-member'
import type { InboxCaseToolbarProps } from './inbox-case-toolbar-props'
import { InboxDetailManagerActions } from './inbox-detail-manager-actions'
import { INBOX_SOURCE_HANDLE_PERMISSION, InboxOwnerControl } from './inbox-owner-control'
import {
  presentResponseTargetChip,
  type ResponseTargetChipTone,
} from './response-target-chip'

/**
 * The reply-due fact's text colour. Direction colour comes from the text-grade
 * tokens and never carries meaning alone — the fact prints its own words beside
 * the tint. `warning` is `--warn` (`styles.css`, plan v2.1 PR 3), the same ink
 * the internal note's label and `attention-band.tsx` use. It replaced
 * `amber-700` / `amber-400` and measured 4.69:1 on `--background` and 4.97:1 on
 * `--surface` light, 10.59:1 / 9.91:1 dark (was 4.73 / 11.69 on the pane) —
 * still over 4.5:1 for this 13 px text. `--warn` is 4.44:1 on `--muted`, so
 * this fact must never move onto a muted fill.
 *
 * Row 6 made this TEXT, not a chip: v1's entries painted a `bg-*` tint behind a
 * pill, which is exactly how a fact ended up wearing a control's clothes. No
 * background survives here. `muted` has no entry because it is never rendered
 * (see `ReplyDueDetail`), and the narrower key type makes the compiler hold
 * that line rather than a comment.
 */
const TONE_CLASS: Readonly<Record<Exclude<ResponseTargetChipTone, 'muted'>, string>> = {
  neutral: 'text-muted-foreground',
  warning: 'text-warn',
  negative: 'text-negative',
  positive: 'text-positive',
}

/**
 * The status dot. `open` is ink, `closed` recedes to `border-strong`, and a
 * feedback item waiting on a handler is the warning amber — `--warn`, the ink
 * `TONE_CLASS.warning` uses (it was `amber-500` until the token existed). The
 * token is darker than `amber-500` in the light theme, which only helps a 7 px
 * dot against the pane. The dot is a glance cue
 * only — it is `aria-hidden`, and the word beside it is always printed, so no
 * state is ever told by colour alone.
 *
 * `open` was the accent until review: purple is interactive-only (contract,
 * "Colour and token rules"; v1 row 12), and on an open item the status is a
 * FACT, so a purple dot beside a purple owner disc told the viewer `Open` could
 * be pressed. Ink against a faded `border-strong` keeps open and closed apart
 * by lightness — which also survives a colour-blind reading — without
 * borrowing `--positive`, whose green already means "on time" one fact over.
 */
type StatusDot = 'open' | 'closed' | 'attention'

const DOT_CLASS: Readonly<Record<StatusDot, string>> = {
  open: 'bg-foreground',
  closed: 'bg-(--border-strong)',
  attention: 'bg-warn',
}

/**
 * The dot has to agree with the WORD, not with `item.status`, so a feedback
 * item reads open-ness from the same place `feedbackHandlingStatusLabel` does
 * (`feedback-handling-presentation.ts:153`): the handling cycle when the caller
 * may read it, the item's own status when the server withheld it. Otherwise a
 * cycle closed ahead of its item would print `Handled` beside an amber dot.
 */
function statusDot(item: InboxItem, handling: FeedbackHandlingState | null): StatusDot {
  if (item.sourceType !== 'feedback') return item.status === 'closed' ? 'closed' : 'open'
  return (handling?.status ?? item.status) === 'closed' ? 'closed' : 'attention'
}

/** The countdown rounds to whole minutes, so a finer tick would repaint for
 * nothing and a coarser one would let the fact assert a stale deadline. */
const CLOCK_TICK_MS = 60_000

/**
 * A countdown read from `new Date()` during render is true only for the minute
 * it was computed in, and nothing else re-renders the pane on a clock tick: the
 * detail query polls only while a reply publication is in flight, and
 * `useTargetDeadlineRefresh` schedules exactly one timer, at `dueAt`. Without
 * this the pane shows the mounting minute's number all shift and the `warning`
 * mood is unreachable unless it happens to mount inside the last 12 h.
 *
 * `isLive` is false for a completed, cancelled or excluded target — none of
 * them ever change — and for a caller that supplied its own clock, so neither
 * starts an interval.
 */
function useMinuteClock(isLive: boolean): Date {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    if (!isLive) return undefined
    const interval = window.setInterval(() => setNow(new Date()), CLOCK_TICK_MS)
    return () => window.clearInterval(interval)
  }, [isLive])

  return now
}

type StatusMemberProps = Readonly<{
  item: InboxItem
  feedbackHandling: FeedbackHandlingState | null
  isPending: boolean
  onReopen: () => void
}>

/**
 * First member of the group. Row 3's load-bearing correction: an OPEN item has
 * no status move to offer, because `update-inbox-status.ts:165` refuses every
 * manual close ("Every close is source-specific" — Google observation closes
 * review work, a manager's outcome closes private feedback). v1 still dressed
 * the open status as a chip beside the controls; here it is a `CaseFact` —
 * `ButtonGroupText`, as row 3 names it, with row 2's box taken off: text and a
 * dot, no chevron, nothing to press. Only a CLOSED
 * item gets a trigger, and its only item is `Reopen`, so the pane never carries
 * a control named exactly `Close` — the triage journey asserts there is none.
 *
 * The trigger keeps `aria-label="Work status: <label>"`. Three e2e journeys
 * open it by that name (`inbox-triage.spec.ts:117`,
 * `inbox-handling-cycle.spec.ts:358`, `activity-notification-facts.spec.ts:146`)
 * and the visible word is contained in it, so label-in-name holds.
 *
 * Reopening is a manager move: the control lived behind `inbox.manage` in the
 * header the strip replaced, and a viewer without it saw the status as plain
 * text. Keep that gate here — like the owner control, a caller with no move to
 * make gets the static fact rather than a menu the server would refuse.
 *
 * `update-inbox-status.ts:67` gates on `inbox.write`, then `:76` on
 * `canHandleInboxSource` — which is itself `inbox.write` **and**
 * `SOURCE_HANDLE_PERMISSION[sourceType]` (`inbox-access.ts:36`). Both server
 * conjuncts are reproduced below, for either source type, so nothing refused is
 * ever offered: `inbox.manage` does not imply `inbox.write` anywhere — the
 * client `can` is a flat membership test over `effectivePermissions`
 * (`usePermissions.ts:26`) and custom roles carry no implication rules
 * (`custom-role.dto.ts:3`) — so a role holding `inbox.manage` without
 * `inbox.write` would otherwise be offered a reopen the server throws on.
 *
 * `inbox.manage` is then added on top, deliberately narrowing the gate below
 * the server's: widening who may reopen is a product decision
 * (`docs/plan/inbox-detail-redesign.md`, row 2), not a review fix.
 *
 * The item kind comes from `item.sourceType`, never from `feedbackHandling`:
 * `get-inbox-item-detail.ts:132` populates that field only for a caller holding
 * `feedback.handle` in the property's scope, so using it as the discriminator
 * would label a private-feedback item `Open`/`Closed` for everyone else.
 */
function StatusMember({
  item,
  feedbackHandling,
  isPending,
  onReopen,
}: StatusMemberProps) {
  const { can } = usePermissions()
  const isClosed = item.status === 'closed'
  const isFeedback = item.sourceType === 'feedback'
  // The member's whole visible text, and the whole of the trigger's accessible
  // name below: the outcome is part of the status, not a decoration beside it,
  // so a reader that only ever hears the label still hears which outcome closed
  // the work — which is also why an outcome word this build cannot read has to
  // be dropped rather than stringified into the name. Row 10's three feedback
  // words, the four ways a closed cycle ends up with no outcome to name, and
  // which word each of them earns are all decided next door, in the pure
  // presenter the thread's outcome rows already share:
  // `feedback-handling-presentation.ts`.
  const label = isFeedback
    ? feedbackHandlingStatusLabel(feedbackHandling, item.status)
    : isClosed
      ? 'Closed'
      : 'Open'
  const dot = (
    <span
      aria-hidden="true"
      className={cn(
        'size-1.75 shrink-0 rounded-full',
        DOT_CLASS[statusDot(item, feedbackHandling)],
      )}
    />
  )

  if (
    !isClosed ||
    !can('inbox.write') ||
    !can(INBOX_SOURCE_HANDLE_PERMISSION[item.sourceType]) ||
    !can('inbox.manage')
  ) {
    // No height of its own: the group stretches it to the controls beside
    // it. The word never drops at any width — it is the one member whose label
    // IS the information. It may only TRUNCATE, and only when the whole group
    // is wider than the toolbar (see `InboxCaseToolbar`): `CaseFact`'s
    // `min-w-0` lets it give, and the text stays whole in the DOM, so the
    // fact's name — which on a `div` is its text — never loses a word.
    return (
      <CaseFact className="gap-2">
        {dot}
        <span className="truncate">{label}</span>
      </CaseFact>
    )
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          aria-label={`Work status: ${label}`}
          // `shrink min-w-0` undoes `Button`'s own `shrink-0` for this member
          // alone, so a long outcome truncates here while the owner and flag
          // squares keep their 36 px. The accessible name is the `aria-label`,
          // so an ellipsis on screen never shortens what is announced.
          className="min-w-0 shrink gap-2 max-md:h-9"
        >
          {dot}
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 opacity-60" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {/* A menu ITEM keeps 44 px below `md`: it is a different target class
            from a toolbar control, stacked edge to edge with no gap between
            neighbours, and it was never what inflated the row (row 20). */}
        <DropdownMenuItem className="max-md:min-h-11" onSelect={onReopen}>
          <RotateCcw data-icon="inline-start" />
          Reopen
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * Row 6: reply due is a DETAIL — the fact's plain text, underlined dotted,
 * that opens a popover. It is still a real `button` (Radix's `PopoverTrigger`
 * without `asChild`, the precedent `features/shared/glossary-term.tsx:23` set),
 * so it stays in the tab order and announces itself by the same name v1 gave
 * it, `<label>. Show timing details`; only its clothes change, from a `Button`
 * pill to text.
 *
 * The deleted response-target card's prose lives in the popover: the sentence
 * that explains when the clock started, plus the exact due time and the
 * property timezone. The toolbar itself only carries the mood and the
 * countdown.
 */
function ReplyDueDetail({
  target,
  now,
}: Readonly<{ target: ResponseTargetView; now?: Date }>) {
  const ticked = useMinuteClock(now === undefined && target.evaluation.state === 'active')
  const titleId = useId()
  const descriptionId = useId()
  const chip = presentResponseTargetChip(target, now ?? ticked)

  // `Not measured` is the ABSENCE of a fact — an excluded, cancelled or
  // undated cycle has no clock to report — and v1 rendered that absence as a
  // popover trigger, so the row's quietest state was one more button. Row 6
  // skips it here and only here: `presentResponseTargetChip` still returns it,
  // unchanged, because a list can legitimately want to say "not measured"
  // about a row, and the eleven description sentences stay with the presenter.
  // Returning after the hook is deliberate — `useMinuteClock` is not live for
  // an excluded or cancelled target, so no interval runs for a fact that is
  // never drawn.
  if (chip.tone === 'muted') return null

  return (
    <Popover>
      {/* `ml-auto` pushes the fact to the trailing edge; the underline sits on
          the words, not on the flex box, so the glyph is never underlined and
          no engine has to propagate a decoration into a flex item.
          `min-h-8` / `max-md:min-h-9` match the group's height so the whole
          row's height is one target tall — it costs no width, which is the
          budget that is actually short at 390 px.

          The dotted line is the ONLY thing that tells this text from a fact —
          row 2 defines a detail as a fact plus the underline — so it is held to
          WCAG 1.4.11's 3:1 for a non-text cue, at rest, with no pointer. It was
          `border-strong` at rest, measured 1.89:1 (light) and 2.00:1 (dark)
          against `--background`, and only took the text colour on hover, which
          a phone never produces. It is now the text's own colour
          (`decoration-current`), the precedent `features/shared/glossary-
          term.tsx:24` set for the same dotted-underline popover: every tone of
          this text clears 4.5:1 on the pane (review measurement — neutral
          6.19 / 7.53, warning 4.73 / 11.69, negative 5.34 / 6.13, positive
          5.14 / 8.69, light / dark), so the line clears 3:1 by construction.
          Hover and the open state turn it solid, which is still the detail
          answering the pointer the way the controls beside it do.

          `cursor-help` stays: row 2 names it, and the glossary term uses it
          for the same click-to-open explanation. */}
      <PopoverTrigger
        aria-label={`${chip.label}. Show timing details`}
        className={cn(
          'group/due ml-auto inline-flex min-h-8 shrink-0 cursor-help items-center gap-1.5 rounded-sm text-[13px] focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none max-md:min-h-9',
          TONE_CLASS[chip.tone],
        )}
      >
        <Clock3 className="size-3.5" aria-hidden="true" />
        <span className="underline decoration-current decoration-dotted underline-offset-4 group-hover/due:decoration-solid group-data-[state=open]/due:decoration-solid">
          {chip.label}
        </span>
      </PopoverTrigger>
      {/* `w-80` is 320 px, which is the WHOLE of the narrowest viewport the
          pane is gated at: the popover would sit flush against both edges with
          no margin at all. The cap only binds below ~352 px, so the desktop
          pane is untouched and the 320 px phone gets 16 px of air either
          side. `align="end"` because the trigger now sits on the trailing
          edge: a start-aligned 320 px popover would hang off the pane's right
          side and be pushed back by collision handling anyway.

          Radix gives the content `role="dialog"` and moves focus into it, but
          names it nothing: `PopoverTitle` is a plain `div` that no attribute
          points at, so a reader announced an unnamed "dialog" (axe
          `aria-dialog-name`, serious). The title names it and the sentence
          describes it — the same pairing a Radix `Dialog` wires up itself. */}
      <PopoverContent
        align="end"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        className="w-80 max-w-[calc(100vw-2rem)]"
      >
        <PopoverHeader>
          <PopoverTitle id={titleId}>{chip.label}</PopoverTitle>
          <PopoverDescription id={descriptionId}>{chip.description}</PopoverDescription>
        </PopoverHeader>
        {chip.dueLabel !== null && (
          <p className="mt-3 text-sm">
            <time dateTime={target.dueAt?.toISOString()}>{chip.dueLabel}</time>{' '}
            <span className="text-muted-foreground">({chip.timezone})</span>
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Region 2 of the pane (plan v2.1 row 3): ONE `ButtonGroup` — status, owner,
 * escalation, in that order — then the reply-due detail on the trailing edge.
 * Row 2's rule is what the file is for: a control is an outlined button inside
 * the group, a fact is plain text with a glyph and no box (`CaseFact`, in
 * `inbox-case-member.tsx`, with the group's edge rules beside it), and a detail
 * is that text with a dotted underline. Nothing here is a pill any
 * more; `INBOX_CHIP_TRIGGER_CLASS` is deleted, and `INBOX_CHIP_STATIC_CLASS`
 * now lives in `inbox-chip.ts` for the two thread chips that genuinely remain.
 *
 * Every prop arrives already derived by `inbox-case-toolbar-props.ts` — the
 * pane is at its line limit, and the selector is where the revision fence, the
 * pending predicate and `isEscalationActive` are unit-tested. Permissions are
 * NOT in the bag: each member reads `usePermissions()` itself, beside the menu
 * the gate decides.
 */
export function InboxCaseToolbar({
  item,
  target,
  feedbackHandling,
  assignmentOptions,
  currentUser,
  isPending,
  isEscalationActive,
  now,
  onReopen,
  onAssign,
  onEscalate,
  onResolveEscalation,
}: InboxCaseToolbarProps) {
  return (
    // The row WRAPS; it does not scroll. v1's strip, and this toolbar until
    // PR 2's gate measured it, was `overflow-x-auto` with the scrollbar hidden
    // on both engines — a fallback budgeted from the canvas (`[Closed ▾][GI][⚑]`
    // = 180 px at 390, row 20) and deferred to "PR 5's Playwright harness".
    // Measured against the real Tailwind build (Playwright, Storybook dev,
    // every `Inbox/Case Toolbar` state and the `Inbox/Mobile 390` sheet), the
    // fallback was the layout in 10 of 62 phone runs, and in every one of them
    // the hidden scrollbar left nothing on screen to say more was there:
    //
    // - 390 px, feedback handled: `Handled · Follow-up completed` alone is a
    //   258 px member, the group 330 px of 350, so `Handled on time` sat
    //   entirely past the edge — only its clock glyph showed
    //   (`scrollWidth` 496 / `clientWidth` 390).
    // - 320 px (280 px inside `px-5`), an ordinary closed review:
    //   `[Closed ▾]` 103 + 36 + 36 = 175, plus `gap-3` and `Replied on time`
    //   109 = 296, so the fact ran 16 px under the right padding (336 / 320).
    //   `Needs attention` 137 + 72 + 12 + `Handle within 6 h` 120 = 341, the
    //   fact wholly clipped (381 / 320).
    //
    // So: `flex-wrap`, and the reply-due detail — the only item outside the
    // group — drops to a second line, still on the trailing edge (`ml-auto`
    // applies per flex line). One line stays exactly 48 px at every width —
    // `min-h-12` is border-box, so it includes `border-b`, and `py-1` + a
    // 36 px member + that 1 px border is 45 px, under it (`py-1.5` measured
    // 49 px, one over the contract's 48). The rare wrapped row is 85 px:
    // 4 + 36 + `gap-y-1` + 36 + 4 + 1. The group is capped at the
    // row's width (`min-w-0 max-w-full`, replacing `shrink-0`) so that even at
    // 320 px a `Handled · <outcome>` status truncates inside its own member
    // rather than pushing the group past the edge — the owner and flag are
    // 36 px squares that never shrink, and the status is the member built to
    // give (`StatusMember`).
    //
    // Facts that print their words at every width (row 2, after review) make
    // the wrap commoner on a phone, and that is the trade taken: a second line
    // costs height, a wordless square cost the meaning. Measured the same way,
    // after the change: a Member on a closed, escalated review held by Grace
    // (`● Closed` 65 + `GH Grace Hopper` 127 + `⚑ Escalated` 84 = 276 px)
    // fits one line at 320 and puts `Replied on time` on the second at 390 and
    // 320 — 69 px, the facts' line being 20 px, not 36; a manager on an open,
    // escalated review (`● Open` 57 + 36 + 36 + `⚑ Escalated` 84 = 213 px)
    // stays one 48 px line at 390 and wraps to 85 px at 320. No run overflowed
    // (`scrollWidth === clientWidth` in all of them).
    //
    // No scroll container is left, which retires three workarounds the old
    // one needed: the hidden scrollbar, `overscroll-x-contain` (a flick past
    // the row's end chaining to the browser's back gesture, which pops
    // `itemId`), and the zero-vertical-range argument for why the row could
    // not trap a swipe meant for the thread. It also stops clipping the
    // members' focus rings at the row's edges. `min-h-12`, not `h-12`, is what
    // lets the wrapped row grow.
    <section
      aria-label="Case status"
      className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-5 py-1 lg:px-6"
    >
      {/* `min-w-0 max-w-full`: the group may be no wider than the row, and a
          flex item's automatic minimum (its min-content width) would
          otherwise hold it at full width and overflow the pane. */}
      <ButtonGroup className={cn('min-w-0 max-w-full', CASE_GROUP_CLASS)}>
        <StatusMember
          item={item}
          feedbackHandling={feedbackHandling}
          isPending={isPending}
          onReopen={onReopen}
        />
        <InboxOwnerControl
          assignedTo={item.assignedTo}
          sourceType={item.sourceType}
          assignmentOptions={assignmentOptions}
          currentUser={currentUser}
          isPending={isPending}
          onAssign={onAssign}
        />
        <InboxDetailManagerActions
          sourceType={item.sourceType}
          isEscalationActive={isEscalationActive}
          isPending={isPending}
          onEscalate={onEscalate}
          onResolveEscalation={onResolveEscalation}
        />
      </ButtonGroup>
      {target !== null && <ReplyDueDetail target={target} now={now} />}
    </section>
  )
}
