import { describe, expect, it, vi } from 'vitest'
import type { InboxItem } from '#/contexts/inbox/application/public-api'
import {
  handleInboxShortcut,
  type InboxShortcutEvent,
  type InboxShortcutInput,
} from './use-inbox-keyboard-shortcuts'

function run(key: string, shiftKey = false) {
  const preventDefault = vi.fn()
  const toggleSelect = vi.fn()
  const openShortcuts = vi.fn()
  const item = { id: 'item-1' } as InboxItem
  const event: InboxShortcutEvent = {
    key,
    shiftKey,
    target: { tagName: 'BODY', isContentEditable: false },
    preventDefault,
  }
  const input: InboxShortcutInput = {
    items: [item],
    isMobile: false,
    selectedItem: item,
    selectedIndex: { current: 0 },
    handleRowClick: vi.fn(),
    closeDetail: vi.fn(),
    toggleSelect,
    openShortcuts,
  }
  handleInboxShortcut(event, input)
  return { preventDefault, toggleSelect, openShortcuts }
}

describe('workspace shortcuts', () => {
  it('opens the legend for shift + ?', () => {
    const result = run('?', true)
    expect(result.openShortcuts).toHaveBeenCalledOnce()
    expect(result.preventDefault).toHaveBeenCalledOnce()
  })

  it('toggles selection for x', () => {
    expect(run('x').toggleSelect).toHaveBeenCalledOnce()
  })
})
