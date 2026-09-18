// Arrow keys inside a focusable scroller and on controls that own them, in a
// file of its own: the suite for every other shortcut,
// `use-inbox-keyboard-shortcuts.test.ts`, stands at the edge of the 300 counted
// lines ESLint `max-lines` allows under `src/components`. The fixtures repeat the base suite's shapes rather than
// importing them: a test file exporting helpers would be a module other suites
// could start to lean on, and these are a dozen lines.
import { describe, expect, it, vi } from 'vitest'
import {
  handleInboxShortcut,
  type InboxShortcutEvent,
  type InboxShortcutInput,
} from './use-inbox-keyboard-shortcuts'
import type { InboxItem } from '#/contexts/inbox/application/public-api'

const ITEMS = ['a', 'b', 'c'].map(
  (id) =>
    ({ id, isEscalated: false, escalationResolvedAt: null }) as unknown as InboxItem,
)

function makeSpies() {
  return {
    handleRowClick: vi.fn<(item: InboxItem) => void>(),
    closeDetail: vi.fn(),
    focusReplyComposer: vi.fn(),
    focusNoteComposer: vi.fn(),
  }
}

function makeInput(
  spies: ReturnType<typeof makeSpies>,
  overrides: Partial<InboxShortcutInput> = {},
): InboxShortcutInput {
  return {
    items: ITEMS,
    isMobile: false,
    selectedItem: ITEMS[0],
    selectedIndex: { current: 0 },
    ...spies,
    ...overrides,
  }
}

function fakeEvent(key: string, overrides: Partial<InboxShortcutEvent> = {}) {
  const preventDefault = vi.fn()
  const event: InboxShortcutEvent = { key, target: null, preventDefault, ...overrides }
  return { event, preventDefault }
}

function expectNoAction(spies: ReturnType<typeof makeSpies>) {
  for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled()
}

/**
 * A target that matches exactly the selectors listed. The real `closest` takes
 * a selector LIST and matches when any one member does, so the fake splits the
 * list the guard passes and looks each member up — by the whole member, never
 * a substring, or a `:not(...)` naming the very attribute would count as a hit.
 */
function controlMatching(tagName: string, selectors: ReadonlyArray<string>) {
  return {
    tagName,
    isContentEditable: false,
    closest: (list: string) =>
      list.split(',').some((member) => selectors.includes(member.trim())) ? {} : null,
  }
}

describe('arrow keys inside a focusable scroller', () => {
  // `closest` answers only the scroll-region selector, so neither the text-entry
  // nor the overlay guard claims the keystroke — the new guard must.
  const inScroller = controlMatching('SECTION', ['[data-inbox-scroll-region]'])

  it.each(['ArrowDown', 'ArrowUp'])(
    '%s scrolls the region instead of changing case',
    (key) => {
      const spies = makeSpies()
      const { event, preventDefault } = fakeEvent(key, { target: inScroller })

      handleInboxShortcut(event, makeInput(spies, { selectedIndex: { current: 1 } }))

      expect(preventDefault).not.toHaveBeenCalled()
      expectNoAction(spies)
    },
  )

  it.each([
    ['j', 'c'],
    ['k', 'a'],
  ])('%s still walks the list from inside it', (key, expectedId) => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent(key, { target: inScroller })

    handleInboxShortcut(event, makeInput(spies, { selectedIndex: { current: 1 } }))

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(spies.handleRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedId }),
    )
  })
})

describe('arrow keys on a control that owns them', () => {
  // A dropdown trigger opens on ArrowDown. The list must not ALSO move, or one
  // keystroke opens the composer's menu and switches case under it. Radix's
  // DropdownMenu trigger is `aria-haspopup="menu"`.
  const menuTrigger = controlMatching('BUTTON', [
    '[aria-haspopup]',
    '[aria-haspopup="menu"]',
    '[aria-haspopup]:not([aria-haspopup="dialog"])',
  ])

  // Every other owner, one fake per selector. The combobox stands for the list
  // header's Radix sort trigger (`role="combobox"`, no `aria-haspopup`), which
  // opens on ArrowDown just as the menu trigger does.
  const owners = [
    ['menu trigger', menuTrigger],
    ['select trigger', controlMatching('BUTTON', ['[role="combobox"]'])],
    ['tab', controlMatching('BUTTON', ['[role="tab"]'])],
    ['radio', controlMatching('BUTTON', ['[role="radio"]'])],
    ['slider thumb', controlMatching('SPAN', ['[role="slider"]'])],
    ['native select', controlMatching('SELECT', ['select'])],
  ] as const

  describe.each(owners)('on a %s', (_name, target) => {
    it.each(['ArrowDown', 'ArrowUp'])('%s is left to the control', (key) => {
      const spies = makeSpies()
      const { event, preventDefault } = fakeEvent(key, { target })

      handleInboxShortcut(event, makeInput(spies, { selectedIndex: { current: 1 } }))

      expect(preventDefault).not.toHaveBeenCalled()
      expectNoAction(spies)
    })
  })
})

describe('arrow keys on a trigger whose popup is a dialog', () => {
  // Radix Popover, Dialog and AlertDialog triggers: `aria-haspopup="dialog"`
  // and no arrow-key handling of their own, so the list keeps the arrows.
  const dialogTrigger = controlMatching('BUTTON', [
    '[aria-haspopup]',
    '[aria-haspopup="dialog"]',
  ])

  it.each([
    ['ArrowDown', 'c'],
    ['ArrowUp', 'a'],
  ])('%s still walks the list', (key, expectedId) => {
    const spies = makeSpies()
    const { event, preventDefault } = fakeEvent(key, { target: dialogTrigger })

    handleInboxShortcut(event, makeInput(spies, { selectedIndex: { current: 1 } }))

    expect(preventDefault).toHaveBeenCalledTimes(1)
    expect(spies.handleRowClick).toHaveBeenCalledWith(
      expect.objectContaining({ id: expectedId }),
    )
  })
})
