// The case toolbar's prop selector. Pure, so it runs in the node unit project:
// every case drives `buildInboxCaseToolbarProps` with the pane's raw inputs and
// checks what the toolbar would receive — including which command a click
// issues and with exactly which revision fence, since that is the part a
// Storybook test cannot observe.

import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  buildInboxCaseToolbarProps,
  isCaseToolbarShown,
  itemCommandFence,
  type InboxCaseToolbarCommands,
  type InboxCaseToolbarInput,
  type InboxCurrentUser,
} from './inbox-case-toolbar-props'
import type {
  FeedbackHandlingState,
  InboxItem,
  ResponseTargetView,
} from '#/contexts/inbox/application/public-api'

// Only the fields the selector reads — the same partial-fixture shape
// `use-inbox-keyboard-shortcuts.test.ts` uses. Overrides are spelled with plain
// strings rather than `Partial<InboxItem>` because `id` is branded.
type ItemOverrides = Readonly<{
  id?: string
  sourceType?: 'review' | 'feedback'
  status?: 'open' | 'closed'
  isEscalated?: boolean
  escalationResolvedAt?: Date | null
  assignedTo?: string | null
  commandRevision?: number
}>

const makeItem = (overrides: ItemOverrides = {}): InboxItem =>
  ({
    id: 'item-1',
    sourceType: 'review',
    status: 'open',
    isEscalated: false,
    escalationResolvedAt: null,
    assignedTo: null,
    commandRevision: 7,
    ...overrides,
  }) as unknown as InboxItem

// The selector passes the target through untouched, so identity is all a case
// needs; the presenter that reads its fields has its own tests
// (`response-target-chip.test.ts`).
const TARGET = {
  dueAt: new Date('2026-09-14T09:00:00Z'),
} as unknown as ResponseTargetView

const OPEN_HANDLING: FeedbackHandlingState = {
  cycleNumber: 1,
  sourceRevision: 1,
  stateRevision: 1,
  status: 'open',
  closeReason: null,
  currentOutcome: null,
  history: [],
}

const VIEWER: InboxCurrentUser = {
  id: 'user-maria',
  name: 'Maria Petrova',
  image: null,
}

const ASSIGNMENT_OPTIONS = [{ userId: 'user-georgi', name: 'Georgi Ivanov' }]

type CommandName = keyof InboxCaseToolbarCommands

const COMMAND_NAMES: ReadonlyArray<CommandName> = [
  'updateStatus',
  'escalate',
  'resolveEscalation',
  'assign',
  'markFeedbackHandled',
  'correctFeedbackHandlingOutcome',
]

type FakeAction = Mock<(input: unknown) => Promise<undefined>> &
  Readonly<{ isPending: boolean; error: null; isSuccess: boolean; data: null }>

/**
 * A callable `Action` stand-in: a resolving spy carrying the reactive fields
 * `useActionMutation` attaches (`use-action-mutation.ts:102-107`).
 */
const fakeAction = (isPending: boolean): FakeAction =>
  Object.assign(
    vi.fn<(input: unknown) => Promise<undefined>>().mockResolvedValue(undefined),
    {
      isPending,
      error: null,
      isSuccess: false,
      data: null,
    },
  )

/** One fake per command; `pending` names the one in flight, if any. */
function makeCommands(pending?: CommandName) {
  const actions: Readonly<Record<CommandName, FakeAction>> = {
    updateStatus: fakeAction(pending === 'updateStatus'),
    escalate: fakeAction(pending === 'escalate'),
    resolveEscalation: fakeAction(pending === 'resolveEscalation'),
    assign: fakeAction(pending === 'assign'),
    markFeedbackHandled: fakeAction(pending === 'markFeedbackHandled'),
    correctFeedbackHandlingOutcome: fakeAction(
      pending === 'correctFeedbackHandlingOutcome',
    ),
  }
  // The fakes resolve `undefined` where the real Actions resolve an item; the
  // selector never reads a result, so the output type is the only mismatch.
  return { actions, commands: actions as unknown as InboxCaseToolbarCommands }
}

function makeInput(
  overrides: Partial<InboxCaseToolbarInput> & { pending?: CommandName } = {},
) {
  const { pending, ...rest } = overrides
  const { actions, commands } = makeCommands(pending)
  const onReopen = vi.fn()
  const input: InboxCaseToolbarInput = {
    ...commands,
    item: makeItem(),
    detail: { responseTarget: TARGET, feedbackHandling: null },
    assignmentOptions: ASSIGNMENT_OPTIONS,
    currentUser: VIEWER,
    onReopen,
    ...rest,
  }
  return { input, actions, onReopen }
}

const expectNoCommandIssued = (actions: ReturnType<typeof makeCommands>['actions']) => {
  for (const name of COMMAND_NAMES) expect(actions[name]).not.toHaveBeenCalled()
}

describe('itemCommandFence', () => {
  it('carries exactly the item id and the revision the pane rendered', () => {
    const item = makeItem({ id: 'item-9', commandRevision: 42 })

    expect(itemCommandFence(item)).toStrictEqual({
      inboxItemId: 'item-9',
      expectedCommandRevision: 42,
    })
  })
})

describe('buildInboxCaseToolbarProps — open review', () => {
  it('passes the item, target, owner inputs and viewer through untouched', () => {
    const { input } = makeInput()

    const props = buildInboxCaseToolbarProps(input)

    expect(props.item).toBe(input.item)
    expect(props.target).toBe(TARGET)
    expect(props.feedbackHandling).toBeNull()
    expect(props.assignmentOptions).toBe(ASSIGNMENT_OPTIONS)
    expect(props.currentUser).toBe(VIEWER)
    expect(props.isPending).toBe(false)
    expect(props.isEscalationActive).toBe(false)
    expect(props.now).toBeUndefined()
  })

  it('reads no target and no handling state while the detail is loading', () => {
    const { input } = makeInput({ detail: null })

    const props = buildInboxCaseToolbarProps(input)

    expect(props.target).toBeNull()
    expect(props.feedbackHandling).toBeNull()
  })

  it('assigns through the fence, with the chosen user id', () => {
    const { input, actions } = makeInput({ item: makeItem({ commandRevision: 12 }) })

    buildInboxCaseToolbarProps(input).onAssign('user-georgi')

    expect(actions.assign).toHaveBeenCalledTimes(1)
    expect(actions.assign).toHaveBeenCalledWith({
      data: {
        inboxItemId: 'item-1',
        expectedCommandRevision: 12,
        assignedToUserId: 'user-georgi',
      },
    })
  })

  it('releases with a null user id rather than dropping the field', () => {
    const { input, actions } = makeInput({
      item: makeItem({ assignedTo: 'user-maria' }),
    })

    buildInboxCaseToolbarProps(input).onAssign(null)

    expect(actions.assign).toHaveBeenCalledWith({
      data: { inboxItemId: 'item-1', expectedCommandRevision: 7, assignedToUserId: null },
    })
  })

  it('leaves the viewer undefined when the page has none', () => {
    const { input } = makeInput({ currentUser: undefined })

    expect(buildInboxCaseToolbarProps(input).currentUser).toBeUndefined()
  })
})

describe('buildInboxCaseToolbarProps — closed review', () => {
  it("hands Reopen the pane's dialog opener and issues no command itself", () => {
    const { input, actions, onReopen } = makeInput({
      item: makeItem({ status: 'closed' }),
    })

    const props = buildInboxCaseToolbarProps(input)
    props.onReopen()

    expect(props.item.status).toBe('closed')
    expect(onReopen).toHaveBeenCalledTimes(1)
    // The dialog collects a reason before `updateStatus` can be sent.
    expectNoCommandIssued(actions)
  })
})

describe('buildInboxCaseToolbarProps — feedback item', () => {
  it("passes the detail's handling state and private-feedback target through", () => {
    const { input } = makeInput({
      item: makeItem({ sourceType: 'feedback' }),
      detail: { responseTarget: TARGET, feedbackHandling: OPEN_HANDLING },
    })

    const props = buildInboxCaseToolbarProps(input)

    expect(props.item.sourceType).toBe('feedback')
    expect(props.feedbackHandling).toBe(OPEN_HANDLING)
    expect(props.target).toBe(TARGET)
  })

  it('keeps a null handling state null — the kind comes from the item', () => {
    // `get-inbox-item-detail.ts` nulls the field for a caller without the
    // handle pair; the toolbar must still know this is feedback.
    const { input } = makeInput({
      item: makeItem({ sourceType: 'feedback' }),
      detail: { responseTarget: null, feedbackHandling: null },
    })

    const props = buildInboxCaseToolbarProps(input)

    expect(props.feedbackHandling).toBeNull()
    expect(props.item.sourceType).toBe('feedback')
  })
})

describe('buildInboxCaseToolbarProps — escalation', () => {
  it('reads an unresolved escalation as active', () => {
    const { input } = makeInput({
      item: makeItem({ isEscalated: true, escalationResolvedAt: null }),
    })

    expect(buildInboxCaseToolbarProps(input).isEscalationActive).toBe(true)
  })

  it('reads an escalation that was already resolved as inactive', () => {
    const { input } = makeInput({
      item: makeItem({
        isEscalated: true,
        escalationResolvedAt: new Date('2026-09-12T10:00:00Z'),
      }),
    })

    expect(buildInboxCaseToolbarProps(input).isEscalationActive).toBe(false)
  })

  it('resolves through the fence and does not escalate', () => {
    const { input, actions } = makeInput({
      item: makeItem({ isEscalated: true, commandRevision: 3 }),
    })

    buildInboxCaseToolbarProps(input).onResolveEscalation()

    expect(actions.resolveEscalation).toHaveBeenCalledTimes(1)
    expect(actions.resolveEscalation).toHaveBeenCalledWith({
      data: { inboxItemId: 'item-1', expectedCommandRevision: 3 },
    })
    expect(actions.escalate).not.toHaveBeenCalled()
  })

  it('escalates through the same fence and does not resolve', () => {
    const { input, actions } = makeInput({ item: makeItem({ commandRevision: 3 }) })

    buildInboxCaseToolbarProps(input).onEscalate()

    expect(actions.escalate).toHaveBeenCalledTimes(1)
    expect(actions.escalate).toHaveBeenCalledWith({
      data: { inboxItemId: 'item-1', expectedCommandRevision: 3 },
    })
    expect(actions.resolveEscalation).not.toHaveBeenCalled()
  })

  it('issues nothing merely by building the props', () => {
    const { input, actions, onReopen } = makeInput({
      item: makeItem({ isEscalated: true }),
    })

    buildInboxCaseToolbarProps(input)

    expectNoCommandIssued(actions)
    expect(onReopen).not.toHaveBeenCalled()
  })
})

describe('buildInboxCaseToolbarProps — pending command', () => {
  // All six, because all six share the `commandRevision` fence: the toolbar
  // must lock while a command it does not issue itself is in flight too.
  it.each(COMMAND_NAMES)('locks the toolbar while %s is in flight', (pending) => {
    const { input } = makeInput({ pending })

    expect(buildInboxCaseToolbarProps(input).isPending).toBe(true)
  })

  it('unlocks once nothing is in flight', () => {
    const { input } = makeInput()

    expect(buildInboxCaseToolbarProps(input).isPending).toBe(false)
  })
})

// The pane mounts `InboxDetailContent` — and so the toolbar and its Escalate /
// Resolve member — only past `inbox-detail-panel.tsx:52` and
// `inbox-detail-sheet.tsx:120`. The `e` shortcut gates on this predicate so it
// cannot issue a command from a loading or failed pane that shows no button.
describe('isCaseToolbarShown', () => {
  const ready = { error: null, isLoading: false, currentItem: makeItem() }

  it('is shown once the detail has loaded for an item', () => {
    expect(isCaseToolbarShown(ready)).toBe(true)
  })

  it('is not shown on the first load, while the pane draws skeletons', () => {
    expect(isCaseToolbarShown({ ...ready, isLoading: true })).toBe(false)
  })

  it('is not shown when the detail failed, while the pane offers Retry', () => {
    expect(
      isCaseToolbarShown({ ...ready, error: 'Failed to load detail. Try again.' }),
    ).toBe(false)
  })

  it('is not shown without an item', () => {
    expect(isCaseToolbarShown({ ...ready, currentItem: null })).toBe(false)
  })

  // The panel and the sheet tested `detailState.error ||` before they called
  // this predicate, so an empty error string rendered the content. `=== null`
  // would have refused `e` on a pane that still showed Escalate.
  it('treats an empty error string as no error, as the surfaces always did', () => {
    expect(isCaseToolbarShown({ ...ready, error: '' })).toBe(true)
  })
})
