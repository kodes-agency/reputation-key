import { describe, expect, it, vi } from 'vitest'
import {
  handleInboxShortcut,
  type InboxShortcutEvent,
  type InboxShortcutInput,
} from './use-inbox-keyboard-shortcuts'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import { isCaseToolbarShown } from './inbox-case-toolbar-props'

// Only the three fields the handler reads — the same partial-fixture shape
// inbox-cache-policy.test.ts uses for an InboxItem. The overrides are spelled
// with plain strings rather than `Partial<InboxItem>` because `id` is branded.
type ItemOverrides = Readonly<{
  id?: string
  isEscalated?: boolean
  escalationResolvedAt?: Date | null
}>

const makeItem = (overrides: ItemOverrides = {}): InboxItem =>
  ({
    id: 'item-1',
    isEscalated: false,
    escalationResolvedAt: null,
    ...overrides,
  }) as unknown as InboxItem

const ITEMS = [makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })]

const BODY = { tagName: 'BODY', isContentEditable: false }

function makeSpies() {
  return {
    handleRowClick: vi.fn<(item: InboxItem) => void>(),
    closeDetail: vi.fn(),
    focusReplyComposer: vi.fn(),
    focusNoteComposer: vi.fn(),
    escalate: vi.fn(),
    resolveEscalation: vi.fn(),
    toggleSelect: vi.fn(),
    openShortcuts: vi.fn(),
  }
}

type Spies = ReturnType<typeof makeSpies>

function makeInput(
  spies: Spies,
  overrides: Partial<InboxShortcutInput> = {},
): InboxShortcutInput {
  return {
    items: ITEMS,
    isMobile: false,
    selectedItem: ITEMS[0],
    selectedIndex: { current: 0 },
    handleRowClick: spies.handleRowClick,
    closeDetail: spies.closeDetail,
    focusReplyComposer: spies.focusReplyComposer,
    focusNoteComposer: spies.focusNoteComposer,
    escalation: {
      isAllowed: true,
      isPending: false,
      escalate: spies.escalate,
      resolveEscalation: spies.resolveEscalation,
    },
    toggleSelect: spies.toggleSelect,
    openShortcuts: spies.openShortcuts,
    ...overrides,
  }
}

function fakeEvent(key: string, overrides: Partial<InboxShortcutEvent> = {}) {
  const preventDefault = vi.fn()
  const event: InboxShortcutEvent = { key, target: BODY, preventDefault, ...overrides }
  return { event, preventDefault }
}

/** Every callback the page handed over stayed untouched. */
function expectNoAction(spies: Spies) {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
}

// ── The three keys plan row 17 claimed already existed ──────────

describe('r — the reply composer', () => {
  it('puts the composer in reply mode and focuses it', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent('r')

    handleInboxShortcut(event, makeInput(spies))

    expect(spies.focusReplyComposer).toHaveBeenCalledTimes(1)
    expect(spies.focusNoteComposer).not.toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('n — the note composer', () => {
  it('puts the composer in note mode and focuses it', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent('n')

    handleInboxShortcut(event, makeInput(spies))

    expect(spies.focusNoteComposer).toHaveBeenCalledTimes(1)
    expect(spies.focusReplyComposer).not.toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })
})

describe('e — escalate or resolve', () => {
  it('escalates an item that carries no escalation', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent('e')

    handleInboxShortcut(event, makeInput(spies))

    expect(spies.escalate).toHaveBeenCalledTimes(1)
    expect(spies.resolveEscalation).not.toHaveBeenCalled()
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('resolves an escalation that is still open', () => {
    const spies = makeSpies()
    const item = makeItem({ isEscalated: true, escalationResolvedAt: null })

    handleInboxShortcut(fakeEvent('e').event, makeInput(spies, { selectedItem: item }))

    expect(spies.resolveEscalation).toHaveBeenCalledTimes(1)
    expect(spies.escalate).not.toHaveBeenCalled()
  })

  it('escalates again once an earlier escalation was resolved', () => {
    const spies = makeSpies()
    const item = makeItem({ isEscalated: true, escalationResolvedAt: new Date() })

    handleInboxShortcut(fakeEvent('e').event, makeInput(spies, { selectedItem: item }))

    expect(spies.escalate).toHaveBeenCalledTimes(1)
    expect(spies.resolveEscalation).not.toHaveBeenCalled()
  })

  it('does nothing without the permissions the toolbar button needs', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent('e')
    const escalation = {
      isAllowed: false,
      isPending: false,
      escalate: spies.escalate,
      resolveEscalation: spies.resolveEscalation,
    }

    handleInboxShortcut(event, makeInput(spies, { escalation }))

    expectNoAction(spies)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('does nothing while an item command is already in flight', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent('e')
    const escalation = {
      isAllowed: true,
      isPending: true,
      escalate: spies.escalate,
      resolveEscalation: spies.resolveEscalation,
    }

    handleInboxShortcut(event, makeInput(spies, { escalation }))

    expectNoAction(spies)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  // Plan v2.1 row 5 moved the button from the header, which renders in every
  // branch of the pane, into the case toolbar, which renders only once the
  // detail has loaded. `use-inbox-page.ts` folds `isCaseToolbarShown` into
  // `isAllowed`; these cases drive the handler with exactly that composition,
  // for the two branches that show no button.
  it.each([
    ['still loading', { error: null, isLoading: true }],
    [
      'showing its load error',
      { error: 'Failed to load detail. Try again.', isLoading: false },
    ],
  ])('does nothing while the pane is %s and shows no toolbar', (_, branch) => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent('e')
    const escalation = {
      isAllowed: isCaseToolbarShown({ ...branch, currentItem: ITEMS[0] }),
      isPending: false,
      escalate: spies.escalate,
      resolveEscalation: spies.resolveEscalation,
    }

    handleInboxShortcut(event, makeInput(spies, { escalation }))

    expectNoAction(spies)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('does nothing when no item is open', () => {
    const spies = makeSpies()

    handleInboxShortcut(fakeEvent('e').event, makeInput(spies, { selectedItem: null }))

    expectNoAction(spies)
  })
})

// ── What must never fire the new keys ───────────────────────────

const MODIFIED: Array<Partial<InboxShortcutEvent>> = [
  { ctrlKey: true },
  { metaKey: true },
  { altKey: true },
  { shiftKey: true },
]

// Each key's own callback, absent. `r` and `n` are optional so a surface with
// no composer (a feedback item has no Reply mode) still compiles and stays
// silent; `e` is optional for a caller that cannot escalate at all.
const ABSENT_HANDLER: Record<string, Partial<InboxShortcutInput>> = {
  r: { focusReplyComposer: undefined },
  n: { focusNoteComposer: undefined },
  e: { escalation: undefined },
}

describe.each(['r', 'n', 'e'])('%s is ignored', (key) => {
  it('while a text input has focus', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent(key, { target: { tagName: 'INPUT' } })

    handleInboxShortcut(event, makeInput(spies))

    expectNoAction(spies)
    expect(preventDefault).not.toHaveBeenCalled()
  })

  it('while a textarea has focus', () => {
    const spies = makeSpies()

    handleInboxShortcut(
      fakeEvent(key, { target: { tagName: 'TEXTAREA' } }).event,
      makeInput(spies),
    )

    expectNoAction(spies)
  })

  it('while a contenteditable element has focus', () => {
    const spies = makeSpies()

    handleInboxShortcut(
      fakeEvent(key, { target: { tagName: 'DIV', isContentEditable: true } }).event,
      makeInput(spies),
    )

    expectNoAction(spies)
  })

  it('while an open menu or dialog owns the keyboard', () => {
    const spies = makeSpies()
    const target = { tagName: 'DIV', closest: (selector: string) => ({ selector }) }

    handleInboxShortcut(fakeEvent(key, { target }).event, makeInput(spies))

    expectNoAction(spies)
  })

  it('with ctrl, cmd, alt or shift held', () => {
    const spies = makeSpies()

    for (const modifier of MODIFIED) {
      const { event, preventDefault } = fakeEvent(key, modifier)

      handleInboxShortcut(event, makeInput(spies))

      // Cmd+R must still reach the browser and reload the page.
      expect(preventDefault).not.toHaveBeenCalled()
    }

    expectNoAction(spies)
  })

  it('on mobile', () => {
    const spies = makeSpies()

    handleInboxShortcut(fakeEvent(key).event, makeInput(spies, { isMobile: true }))

    expectNoAction(spies)
  })

  it('when the page passes no handler for it', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent(key)

    handleInboxShortcut(event, makeInput(spies, ABSENT_HANDLER[key]))

    expectNoAction(spies)
    expect(preventDefault).not.toHaveBeenCalled()
  })
})

// ── List navigation, unchanged by the three new keys ────────────

describe('list navigation', () => {
  it('opens the first row when nothing is selected yet', () => {
    const spies = makeSpies()
    const input = makeInput(spies, { selectedItem: null, selectedIndex: { current: -1 } })
    const { event, preventDefault } = fakeEvent('j')

    handleInboxShortcut(event, input)

    expect(spies.handleRowClick).toHaveBeenCalledWith(ITEMS[0])
    expect(input.selectedIndex.current).toBe(0)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('walks down with j and back up with k', () => {
    const spies = makeSpies()
    const input = makeInput(spies)

    handleInboxShortcut(fakeEvent('j').event, input)
    handleInboxShortcut(fakeEvent('j').event, input)
    handleInboxShortcut(fakeEvent('k').event, input)

    expect(spies.handleRowClick.mock.calls.map(([item]) => item.id)).toEqual([
      'b',
      'c',
      'b',
    ])
    expect(input.selectedIndex.current).toBe(1)
  })

  it('treats ArrowDown and ArrowUp as j and k', () => {
    const spies = makeSpies()
    const input = makeInput(spies)

    handleInboxShortcut(fakeEvent('ArrowDown').event, input)
    handleInboxShortcut(fakeEvent('ArrowUp').event, input)

    expect(spies.handleRowClick.mock.calls.map(([item]) => item.id)).toEqual(['b', 'a'])
  })

  it('stops at the last row and at the first', () => {
    const spies = makeSpies()
    const atEnd = makeInput(spies, { selectedIndex: { current: ITEMS.length - 1 } })
    const atStart = makeInput(spies, { selectedIndex: { current: 0 } })

    handleInboxShortcut(fakeEvent('j').event, atEnd)
    handleInboxShortcut(fakeEvent('k').event, atStart)

    expect(spies.handleRowClick).not.toHaveBeenCalled()
    expect(atEnd.selectedIndex.current).toBe(ITEMS.length - 1)
    expect(atStart.selectedIndex.current).toBe(0)
  })

  it('closes the detail on Escape', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent('Escape')

    handleInboxShortcut(event, makeInput(spies))

    expect(spies.closeDetail).toHaveBeenCalledTimes(1)
    expect(preventDefault).toHaveBeenCalledTimes(1)
  })

  it('leaves j, k and Escape alone inside a text input, on mobile and modified', () => {
    const spies = makeSpies()

    for (const key of ['j', 'k', 'ArrowDown', 'ArrowUp', 'Escape']) {
      handleInboxShortcut(
        fakeEvent(key, { target: { tagName: 'INPUT' } }).event,
        makeInput(spies),
      )
      handleInboxShortcut(fakeEvent(key, { metaKey: true }).event, makeInput(spies))
      handleInboxShortcut(fakeEvent(key).event, makeInput(spies, { isMobile: true }))
    }

    expectNoAction(spies)
  })

  it('ignores a key it does not bind', () => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent('q')

    handleInboxShortcut(event, makeInput(spies))

    expectNoAction(spies)
    expect(preventDefault).not.toHaveBeenCalled()
  })
})
