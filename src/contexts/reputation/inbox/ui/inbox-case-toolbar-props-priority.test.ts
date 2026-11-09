// The Priority member's half of the toolbar's prop bag (ADR 0071), in a file of
// its own: `inbox-case-toolbar-props.test.ts` stands near the 300 counted lines
// ESLint `max-lines` allows under `src/components`.
import { describe, expect, it, vi } from 'vitest'
import {
  buildInboxCaseToolbarProps,
  type InboxCaseToolbarInput,
} from './inbox-case-toolbar-props'
import type {
  InboxItem,
  InboxReviewAnalysis,
} from '#/contexts/inbox/application/public-api'

const idle = () =>
  Object.assign(
    vi.fn(async () => undefined),
    {
      isPending: false,
      error: null,
      isSuccess: false,
      data: null,
    },
  )

const READY_URGENT = {
  status: 'ready',
  sentiment: 'negative',
  aspects: [],
  primaryCategory: 'service',
  attention: 'urgent',
  generatedAtEpochMillis: 0,
} as const satisfies InboxReviewAnalysis

function makeInput(
  item: Partial<InboxItem>,
  analysis?: InboxReviewAnalysis | null,
): InboxCaseToolbarInput {
  return {
    updateStatus: idle(),
    escalate: idle(),
    resolveEscalation: idle(),
    assign: idle(),
    setPriority: idle(),
    markFeedbackHandled: idle(),
    correctFeedbackHandlingOutcome: idle(),
    item: {
      id: 'item-1',
      commandRevision: 5,
      isEscalated: false,
      escalationResolvedAt: null,
      managerPriority: null,
      ...item,
    } as unknown as InboxItem,
    detail: { responseTarget: null, feedbackHandling: null, analysis },
    assignmentOptions: [],
    onReopen: () => {},
  } as unknown as InboxCaseToolbarInput
}

describe('buildInboxCaseToolbarProps — priority', () => {
  it("reads the suggestion from the detail's analysis, and none without one", () => {
    expect(
      buildInboxCaseToolbarProps(makeInput({}, READY_URGENT)).prioritySuggestion,
    ).toBe('urgent')
    expect(buildInboxCaseToolbarProps(makeInput({}, null)).prioritySuggestion).toBeNull()
    expect(
      buildInboxCaseToolbarProps({ ...makeInput({}), detail: null }).prioritySuggestion,
    ).toBeNull()
  })

  it('sets through the fence, expecting the level a person set — never the suggestion', () => {
    const input = makeInput({ managerPriority: 'low' }, READY_URGENT)

    buildInboxCaseToolbarProps(input).onSetPriority('high')

    expect(input.setPriority).toHaveBeenCalledWith({
      data: {
        inboxItemId: 'item-1',
        expectedCommandRevision: 5,
        expectedPriority: 'low',
        priority: 'high',
      },
    })
  })

  it('expects no level on an item that follows the suggestion, and clears with null', () => {
    const input = makeInput({}, READY_URGENT)

    buildInboxCaseToolbarProps(input).onSetPriority(null)

    expect(input.setPriority).toHaveBeenCalledWith({
      data: {
        inboxItemId: 'item-1',
        expectedCommandRevision: 5,
        expectedPriority: null,
        priority: null,
      },
    })
  })

  it("hands the `p` shortcut's menu box through untouched", () => {
    const priorityMenu = { current: null }

    expect(
      buildInboxCaseToolbarProps({ ...makeInput({}), priorityMenu }).priorityMenu,
    ).toBe(priorityMenu)
  })
})
