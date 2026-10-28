// The `p` shortcut (owner P-7): it opens the open item's Priority menu under
// exactly the conditions `e` escalates under, and never otherwise. Its own file:
// `use-inbox-keyboard-shortcuts.test.ts` is near the 300 counted lines ESLint
// `max-lines` allows under `src/components`.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import type { Permission } from '#/shared/domain/permissions'
import {
  handleInboxShortcut,
  type InboxShortcutEvent,
  type InboxShortcutInput,
} from './use-inbox-keyboard-shortcuts'
import { isTriageShortcutAllowed } from './use-inbox-escalation-shortcut'
import type { InboxDetailState } from './use-inbox-detail'
import { useInboxPriorityShortcut } from './use-inbox-priority-shortcut'

const ITEM = { id: 'item-1', sourceType: 'review' } as unknown as InboxItem
const BODY = { tagName: 'BODY', isContentEditable: false }

function setup(
  priority: Partial<NonNullable<InboxShortcutInput['priority']>> = {},
  input: Partial<InboxShortcutInput> = {},
) {
  const open = vi.fn()
  const handled: InboxShortcutInput = {
    items: [ITEM],
    isMobile: false,
    selectedItem: ITEM,
    selectedIndex: { current: 0 },
    handleRowClick: vi.fn(),
    closeDetail: vi.fn(),
    priority: { isAllowed: true, isPending: false, open, ...priority },
    ...input,
  }
  const preventDefault = vi.fn()
  const press = (key: string, over: Partial<InboxShortcutEvent> = {}) =>
    handleInboxShortcut({ key, target: BODY, preventDefault, ...over }, handled)
  return { open, preventDefault, press }
}

describe('the p shortcut', () => {
  it('opens the Priority menu of the open item', () => {
    const { open, preventDefault, press } = setup()

    press('p')

    expect(open).toHaveBeenCalledOnce()
    expect(preventDefault).toHaveBeenCalledOnce()
  })

  it.each([
    ['the control is not offered', { isAllowed: false }],
    ['an item command is in flight', { isPending: true }],
  ] as const)('leaves the key alone when %s', (_why, priority) => {
    const { open, preventDefault, press } = setup(priority)

    press('p')

    expect(open).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('is inert with no item open, on a phone, with Shift, and while typing', () => {
    const noItem = setup({}, { selectedItem: null })
    noItem.press('p')
    const phone = setup({}, { isMobile: true })
    phone.press('p')
    const shifted = setup()
    shifted.press('P', { shiftKey: true })
    const typing = setup()
    typing.press('p', { target: { tagName: 'TEXTAREA', isContentEditable: false } })

    for (const run of [noItem, phone, shifted, typing]) {
      expect(run.open).not.toHaveBeenCalled()
    }
  })
})

describe('isTriageShortcutAllowed', () => {
  const shown = {
    error: null,
    isLoading: false,
    currentItem: ITEM,
  } as unknown as InboxDetailState
  const holds =
    (...granted: Permission[]) =>
    (permission: Permission) =>
      granted.includes(permission)

  it("is Escalate's gate: inbox.write, the source's handle permission and inbox.manage", () => {
    expect(
      isTriageShortcutAllowed(
        ITEM,
        shown,
        holds('inbox.write', 'review.read', 'inbox.manage'),
      ),
    ).toBe(true)
    expect(
      isTriageShortcutAllowed(ITEM, shown, holds('inbox.write', 'review.read')),
    ).toBe(false)
    expect(
      isTriageShortcutAllowed(
        { ...ITEM, sourceType: 'feedback' } as InboxItem,
        shown,
        holds('inbox.write', 'review.read', 'inbox.manage'),
      ),
    ).toBe(false)
  })

  it('is closed while the pane shows no toolbar', () => {
    const loading = { ...shown, isLoading: true } as InboxDetailState

    expect(
      isTriageShortcutAllowed(
        ITEM,
        loading,
        holds('inbox.write', 'review.read', 'inbox.manage'),
      ),
    ).toBe(false)
  })
})

describe('useInboxPriorityShortcut', () => {
  const idle = { isPending: false }
  const detailState = (opener: (() => void) | null) =>
    ({
      error: null,
      isLoading: false,
      currentItem: ITEM,
      updateStatus: idle,
      escalate: idle,
      resolveEscalation: idle,
      assign: idle,
      setPriority: idle,
      markFeedbackHandled: idle,
      correctFeedbackHandlingOutcome: idle,
      priorityMenu: { current: opener },
    }) as unknown as InboxDetailState

  function render(state: InboxDetailState) {
    let shortcut: ReturnType<typeof useInboxPriorityShortcut> | undefined
    function Harness() {
      shortcut = useInboxPriorityShortcut(ITEM, state, () => true)
      return null
    }
    renderToString(createElement(Harness))
    if (!shortcut) throw new Error('the shortcut harness did not render')
    return shortcut
  }

  it('opens whatever menu the control registered, and does nothing when none is', () => {
    const opener = vi.fn()

    const withMenu = render(detailState(opener))
    withMenu.open()
    render(detailState(null)).open()

    expect(withMenu.isAllowed).toBe(true)
    expect(opener).toHaveBeenCalledOnce()
  })
})
