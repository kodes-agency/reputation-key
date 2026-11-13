// The case toolbar's prop bag, built from the pane's raw inputs.
//
// Why this is a module of its own and not lines inside the pane: `escalate`,
// `resolveEscalation` and the one pending predicate all reach the toolbar from
// `inbox-detail-content.tsx`, which is at the `max-lines` limit and cannot take
// the wiring inline.
//
// Pure on purpose: no React, no JSX, no `.tsx` import. The unit project runs in
// node with no jsdom (`vitest.config.ts`, project `unit`), so every derivation
// that decides what the toolbar shows or which command a click issues is tested
// here without rendering, and the Storybook project is left to prove the
// structure, roles and names it is actually able to prove.
//
// What is deliberately NOT here:
//
// - Permissions. Each control reads `usePermissions()` itself
//   (`inbox-case-toolbar.tsx`, `StatusMember`; `inbox-owner-control.tsx`,
//   `InboxOwnerControl`), because the gate and the menu it gates have to be
//   read in one place — the owner menu's choices depend on `inbox.manage`
//   (`buildChoices`), and a second copy of the
//   `inbox.write ∧ SOURCE_HANDLE_PERMISSION` pair up here would be a second
//   place for it to drift.
// - Labels and initials. `feedbackHandlingStatusLabel` and the owner's name
//   resolution belong to the controls that print them; duplicating either here
//   would give the toolbar two answers to "what does this say".
import type {
  FeedbackHandlingState,
  InboxItem,
  InboxItemDetailResult,
  InboxPriority,
  ResponseTargetView,
} from '#/contexts/inbox/application/public-api'
import type { InboxAssignmentOption } from '#/components/inbox/inbox-owner-view'
import { isHeaderCommandPending } from '#/components/inbox/inbox-header-command-pending'
import { prioritySuggestion } from '#/components/inbox/inbox-priority-view'
import type { InboxDetailState } from './use-inbox-detail'

/**
 * The signed-in viewer, as the route context already carries it
 * (`routes/_authenticated.tsx:165-168`: `id`, `name`, `email`, `image`). The
 * owner control needs `name` to print the viewer's own initials when the item
 * is theirs, so the page hands over `ctx.user` itself and the pane passes it
 * down unreshaped to the toolbar and, as `currentUser.id`, to the thread.
 *
 * The ONE definition of the viewer for the whole pane. It lives in this pure
 * module rather than beside the owner control that reads `name`, because the
 * page, the panel, the sheet and the pane all name it too, and a `.ts` with no
 * React in it is the lowest point every one of them can import a type from.
 *
 * `name` and `image` are optional and nullable: a surface that only has the id
 * (a story, a test) still compiles, and the owner control degrades to the
 * person glyph rather than drawing a wrong disc. `image` is carried because
 * the route has it; no control reads it yet.
 */
export type InboxCurrentUser = Readonly<{
  id: string
  name?: string | null
  image?: string | null
}>

/**
 * Where the open Priority menu's opener is kept while the control is mounted,
 * so the page's `p` shortcut can open it (the `composerFocusRef` pattern): the
 * key is bound on `window`, above the pane, and the menu's open state is the
 * control's own. Carried on the detail state, which already reaches both.
 */
export type InboxPriorityMenuBox = { current: (() => void) | null }

/**
 * The seven item commands that share one `commandRevision` fence, exactly as
 * the pane receives them (`DetailContentProps`). All seven are here and not just
 * the four the toolbar issues, because the toolbar's lock has to cover every
 * command that would stale its revision — see `isHeaderCommandPending`.
 */
export type InboxCaseToolbarCommands = Pick<
  InboxDetailState,
  | 'updateStatus'
  | 'escalate'
  | 'resolveEscalation'
  | 'assign'
  | 'setPriority'
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
     * `null` while the detail query is loading. Only the fields the toolbar
     * reads are required, so a story or a test need not build a whole payload.
     * `analysis` is optional for the same reason: the Priority control reads
     * its suggestion from it, and a fixture without one has none.
     */
    detail:
      | (Pick<InboxItemDetailResult, 'responseTarget' | 'feedbackHandling'> &
          Partial<Pick<InboxItemDetailResult, 'analysis'>>)
      | null
    assignmentOptions: ReadonlyArray<InboxAssignmentOption>
    currentUser?: InboxCurrentUser
    /**
     * Opens the pane's reopen dialog. The dialog, not the toolbar, issues
     * `updateStatus` — it has to collect a reason first — and its open state
     * is the pane's own `useState`, so this is a callback in, not a command.
     */
    onReopen: () => void
    /** The `p` shortcut's way into the Priority menu (`InboxPriorityMenuBox`). */
    priorityMenu?: InboxPriorityMenuBox
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
  /** Any of the seven item commands in flight; disables every toolbar control. */
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
  /**
   * The review's current AI attention, from the detail's analysis (the stricter
   * delivery gate, so the toolbar is authoritative for the open item); null for
   * feedback, no analysis, or AI off.
   */
  prioritySuggestion: InboxPriority | null
  /** Sets a level, or clears it with `null`; bound to the fence and the set level. */
  onSetPriority: (priority: InboxPriority | null) => void
  priorityMenu?: InboxPriorityMenuBox
}>

/**
 * The revision fence every item command carries. The escalation member calls
 * it through the bound commands below; the `e` shortcut (`use-inbox-page.ts`)
 * and the pane's reopen dialog call it directly.
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
 * Whether the item has a raised, unresolved escalation. The toolbar member reads it through the props below and the `e` shortcut
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
 * Both surfaces branch on it before rendering the content: `InboxDetailPanel`
 * and `InboxDetailSheet` show the error block (with `Try again`) or skeletons when
 * it is false, and mount the content otherwise. The HEADER renders in all three
 * branches, but the toolbar is inside the content, so in the loading and error
 * branches there is no escalation control on screen at all.
 *
 * The `e` shortcut (`use-inbox-page.ts`) promises parity with that control — a
 * key must never reach past a control the pane has taken away — so it asks
 * this predicate too. Without it, `e` on an uncached item's first open
 * (`use-inbox-detail.ts`, `isLoading` is `detailQuery.isLoading ||
 * notesQuery.isLoading`) or on a pane stuck on the detail error would issue
 * `escalate` from a pane that shows no Escalate button.
 *
 * Both surfaces call THIS predicate rather than restating the condition inline,
 * so the key and the button read one condition and cannot drift apart.
 * `!state.error` rather than `=== null` on purpose: the two disagree on an
 * empty error string, and `=== null` would show a pane whose shortcut was
 * refused.
 */
export function isCaseToolbarShown(state: InboxDetailBranchState): boolean {
  return !state.error && !state.isLoading && state.currentItem !== null
}

/**
 * The pane's raw inputs → the toolbar's props.
 *
 * Each bound command is `.catch`ed. An `Action` rejects on failure
 * (`useActionMutation` returns `mutateAsync`) and records it on `.error`; a
 * click handler has nowhere to put the promise, and `withFreshCommandRevision`
 * has already spent the one retry a conflict earns.
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
    // All seven, not the four this toolbar issues: every command is fenced on
    // the same `commandRevision`, so a click here while a feedback outcome is
    // in flight would ship a revision about to go stale
    // (`inbox-header-command-pending.ts`).
    isPending: isHeaderCommandPending(input),
    isEscalationActive: isEscalationActive(item),
    onReopen: input.onReopen,
    prioritySuggestion: prioritySuggestion(detail?.analysis),
    priorityMenu: input.priorityMenu,
    // Each `.catch`ed, not merely `void`ed: an `Action` is `mutateAsync` and
    // rejects on refusal, so a bare `void` would make every refused command an
    // unhandled rejection. What TELLS the manager is the `errorMessage` toast
    // these commands carry in `use-inbox-detail.ts` — the toolbar narrows them
    // to `() => void`, so `.error` reaches no renderer here.
    onAssign: (assignedToUserId) => {
      void input.assign({ data: { ...fence, assignedToUserId } }).catch(() => undefined)
    },
    onEscalate: () => {
      void input.escalate({ data: fence }).catch(() => undefined)
    },
    onResolveEscalation: () => {
      void input.resolveEscalation({ data: fence }).catch(() => undefined)
    },
    // The expectation is the level a person SET on the item this pane shows,
    // never the suggestion: the server refuses a different stored level as a
    // colleague's change (`priority_changed`).
    onSetPriority: (priority) => {
      void input
        .setPriority({
          data: { ...fence, expectedPriority: item.managerPriority ?? null, priority },
        })
        .catch(() => undefined)
    },
  }
}
