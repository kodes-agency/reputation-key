// The case toolbar's prop bag, built from the pane's raw inputs (plan v2.1,
// PR 2, rows 3–5).
//
// Why this is a module of its own and not four lines inside the pane: row 5
// moves escalation out of the header and into the toolbar, so `escalate`,
// `resolveEscalation` and the one pending predicate all have to reach the
// toolbar from `inbox-detail-content.tsx` — and that file was at 296 counted
// lines against the 300 `max-lines` limit when PR 2 started. It could not take
// the wiring inline. The plan names this extraction by file
// (`docs/plan/inbox-detail-v2.md`, PR 2).
//
// Pure on purpose: no React, no JSX, no `.tsx` import. The unit project runs in
// node with no jsdom (`vitest.config.ts`, project `unit`), so every derivation
// that decides what the toolbar shows or which command a click issues is tested
// here without rendering, and the Storybook project is left to prove the
// structure, roles and names it is actually able to prove.
//
// What is deliberately NOT here:
//
// - Permissions. Each control keeps reading `usePermissions()` itself, as the
//   strip and the assignee chip did before PR 2 (`inbox-case-toolbar.tsx`,
//   `StatusMember`; `inbox-owner-control.tsx`, `InboxOwnerControl`),
//   because the gate and the menu it gates have to be read in one place — the
//   owner menu's choices depend on `inbox.manage` (`buildChoices`), and a
//   second copy of the `inbox.write ∧ SOURCE_HANDLE_PERMISSION` pair up here
//   would be a second place for it to drift.
// - Labels and initials. `feedbackHandlingStatusLabel` and the owner's name
//   resolution belong to the controls that print them; duplicating either here
//   would give the toolbar two answers to "what does this say".
import type {
  FeedbackHandlingState,
  InboxItem,
  InboxItemDetailResult,
  ResponseTargetView,
} from '#/contexts/inbox/application/public-api'
import type { InboxAssignmentOption } from './inbox-owner-view'
import { isHeaderCommandPending } from './inbox-header-command-pending'
import type { InboxDetailState } from './use-inbox-detail'

/**
 * The signed-in viewer, as the route context already carries it
 * (`routes/_authenticated.tsx:165-168`: `id`, `name`, `email`, `image`). Row
 * 4's owner control needs `name` to print the viewer's own initials when the
 * item is theirs; until PR 2 the page forwarded only `ctx.user?.id`
 * (`inbox-page-v2.tsx`, both the sheet and the panel branch). The page now
 * hands over `ctx.user` itself — `InboxCtx['user']` was widened to match — and
 * the pane passes it down unreshaped to the toolbar and, as `currentUser.id`,
 * to the thread.
 *
 * The ONE definition of the viewer for the whole pane. It lives in this pure
 * module rather than beside the owner control that reads `name`, because the
 * page, the panel, the sheet and the pane all name it too, and a `.ts` with no
 * React in it is the lowest point every one of them can import a type from.
 * Two builders drew it twice during PR 2 (here and `inbox-owner-control.tsx`);
 * the owner control now imports this one.
 *
 * `name` and `image` are optional and nullable: a surface that only has the id
 * (a story, a test) still compiles, and the owner control degrades to the
 * person glyph rather than drawing a wrong disc. `image` is carried because
 * the route has it and row 4 names it; no control reads it yet.
 */
export type InboxCurrentUser = Readonly<{
  id: string
  name?: string | null
  image?: string | null
}>

/**
 * The six item commands that share one `commandRevision` fence, exactly as the
 * pane receives them (`DetailContentProps`). All six are here and not just the
 * three the toolbar issues, because the toolbar's lock has to cover every
 * command that would stale its revision — see `isHeaderCommandPending`.
 */
export type InboxCaseToolbarCommands = Pick<
  InboxDetailState,
  | 'updateStatus'
  | 'escalate'
  | 'resolveEscalation'
  | 'assign'
  | 'markFeedbackHandled'
  | 'correctFeedbackHandlingOutcome'
>

/**
 * What the pane already holds, unreshaped. Flat rather than nesting the
 * commands under a key: the pane destructures all six as props, so a flat bag
 * is the fewest lines it can hand over — which is the whole reason this module
 * exists — and it still satisfies `InboxHeaderCommands` structurally.
 */
export type InboxCaseToolbarInput = InboxCaseToolbarCommands &
  Readonly<{
    item: InboxItem
    /**
     * `null` while the detail query is loading. Only the two fields the toolbar
     * reads are required, so a story or a test need not build a whole payload.
     */
    detail: Pick<InboxItemDetailResult, 'responseTarget' | 'feedbackHandling'> | null
    assignmentOptions: ReadonlyArray<InboxAssignmentOption>
    currentUser?: InboxCurrentUser
    /**
     * Opens the pane's reopen dialog. The dialog, not the toolbar, issues
     * `updateStatus` — it has to collect a reason first — and its open state
     * is the pane's own `useState`, so this is a callback in, not a command.
     */
    onReopen: () => void
  }>

/**
 * Everything `InboxCaseToolbar` consumes. Commands arrive already bound to the
 * item's revision fence: the toolbar never sees `commandRevision`, so no
 * control can issue a command against a revision other than the one this pane
 * rendered.
 */
export type InboxCaseToolbarProps = Readonly<{
  item: InboxItem
  /** `detail.responseTarget`; `null` for no target and while loading. */
  target: ResponseTargetView | null
  /**
   * `detail.feedbackHandling`, passed through un-gated. The server already
   * null-gates it on the handle pair and the property's handle scope
   * (`get-inbox-item-detail.ts:142-160`), and the
   * item KIND must still come from `item.sourceType`, never from whether this
   * is null — see the `StatusMember` comment in `inbox-case-toolbar.tsx`.
   */
  feedbackHandling: FeedbackHandlingState | null
  assignmentOptions: ReadonlyArray<InboxAssignmentOption>
  currentUser?: InboxCurrentUser
  /** Any of the six item commands in flight; disables every toolbar control. */
  isPending: boolean
  /**
   * A raised escalation not yet resolved. `isEscalated` alone is not enough:
   * the flag is orthogonal to status and stays set once acknowledged
   * (`domain/types.ts:164-169`, ADR 0055), so a resolved item must offer
   * Escalate again rather than Resolve.
   */
  isEscalationActive: boolean
  /** Fixes the reply-due countdown's clock. Never set by the selector —
   * stories and tests pass it to stay deterministic. */
  now?: Date
  onReopen: () => void
  /** `null` releases the item. */
  onAssign: (assignedToUserId: string | null) => void
  onEscalate: () => void
  onResolveEscalation: () => void
}>

/**
 * The revision fence every item command carries. Before PR 2 the same
 * three-line literal was written three times — in the header's escalation
 * button, in `use-inbox-page.ts` for the `e` shortcut, and as the pane's
 * `expected` for its reopen dialog. All three now call this: the escalation
 * member through the bound commands below, the shortcut and the pane directly.
 */
export type InboxItemCommandFence = Readonly<{
  inboxItemId: InboxItem['id']
  expectedCommandRevision: number
}>

export function itemCommandFence(item: InboxItem): InboxItemCommandFence {
  return {
    inboxItemId: item.id,
    expectedCommandRevision: item.commandRevision,
  }
}

/**
 * The predicate the header's escalation button computed inline before PR 2.
 * The toolbar member reads it through the props below and the `e` shortcut
 * calls it directly (`use-inbox-keyboard-shortcuts.ts`, `runEscalation`), so
 * the button and the key cannot disagree about which command a press issues.
 */
export function isEscalationActive(item: InboxItem): boolean {
  return item.isEscalated && item.escalationResolvedAt === null
}

/**
 * The part of the detail state that decides which branch the pane renders.
 * `Pick`ed rather than the whole `InboxDetailState` so the unit test builds
 * three fields, not six Actions.
 */
export type InboxDetailBranchState = Pick<
  InboxDetailState,
  'error' | 'isLoading' | 'currentItem'
>

/**
 * Whether the pane is showing the case toolbar at all — the condition under
 * which `InboxDetailContent`, and with it the toolbar, is mounted.
 *
 * Both surfaces branch on it before rendering the content:
 * `inbox-detail-panel.tsx:52` and `inbox-detail-sheet.tsx:120` show the error
 * block (with `Retry`) or skeletons on `error || isLoading || !currentItem`,
 * and mount the content otherwise. The HEADER renders in all three branches.
 * That difference only started to matter in PR 2: while Escalate / Resolve
 * lived in the header, the button existed during a first load and after a
 * failed one; row 5 moved it into the toolbar, which is inside the content, so
 * in those branches there is no escalation control on screen at all.
 *
 * The `e` shortcut (`use-inbox-page.ts`) promises parity with that control — a
 * key must never reach past a control the pane has taken away — so it asks
 * this predicate too. Without it, `e` on an uncached item's first open
 * (`use-inbox-detail.ts`, `isLoading` is `detailQuery.isLoading ||
 * notesQuery.isLoading`) or on a pane stuck on `Failed to load detail` issued
 * `escalate` from a pane that showed no Escalate button.
 *
 * Both surfaces now branch on THIS predicate (`inbox-detail-panel.tsx`,
 * `inbox-detail-sheet.tsx`), so the key and the button read one condition and
 * cannot drift apart. `!state.error` rather than `=== null` on purpose: it is
 * the truthiness the two surfaces tested inline before they called this, and
 * the two disagree on an empty error string — which would have shown a pane
 * whose shortcut was refused.
 */
export function isCaseToolbarShown(state: InboxDetailBranchState): boolean {
  return !state.error && !state.isLoading && state.currentItem !== null
}

/**
 * The pane's raw inputs → the toolbar's props.
 *
 * Each bound command is `void`ed, as the strip's inline `onAssign` was in the
 * pane before PR 2. An `Action` rejects on failure
 * (`use-action-mutation.ts:101`, `mutateAsync`) and records it on `.error`; a click
 * handler has nowhere to put the promise, and `withFreshCommandRevision` has
 * already spent the one retry a conflict earns.
 */
export function buildInboxCaseToolbarProps(
  input: InboxCaseToolbarInput,
): InboxCaseToolbarProps {
  const { item, detail } = input
  const fence = itemCommandFence(item)

  return {
    item,
    target: detail?.responseTarget ?? null,
    feedbackHandling: detail?.feedbackHandling ?? null,
    assignmentOptions: input.assignmentOptions,
    currentUser: input.currentUser,
    // All six, not the three this toolbar issues: every command is fenced on
    // the same `commandRevision`, so a click here while a feedback outcome is
    // in flight would ship a revision about to go stale
    // (`inbox-header-command-pending.ts:19-26`).
    isPending: isHeaderCommandPending(input),
    isEscalationActive: isEscalationActive(item),
    onReopen: input.onReopen,
    onAssign: (assignedToUserId) => {
      void input.assign({ data: { ...fence, assignedToUserId } })
    },
    onEscalate: () => {
      void input.escalate({ data: fence })
    },
    onResolveEscalation: () => {
      void input.resolveEscalation({ data: fence })
    },
  }
}
