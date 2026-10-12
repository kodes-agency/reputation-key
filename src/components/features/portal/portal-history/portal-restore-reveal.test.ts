import { describe, expect, it, vi } from 'vitest'
import { revealRestoreConfirmation } from './portal-restore-reveal'

function part(height = 0) {
  return {
    getBoundingClientRect: () => ({ height }),
    scrollIntoView: vi.fn(),
  }
}

describe('revealRestoreConfirmation', () => {
  it('brings the buttons on screen when the whole confirmation fits the window', () => {
    const parts = { section: part(400), heading: part(), actions: part() }

    revealRestoreConfirmation(parts, { focusOnOpen: true, viewportHeight: 568 })

    expect(parts.actions.scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      behavior: 'instant',
    })
    expect(parts.heading.scrollIntoView).not.toHaveBeenCalled()
  })

  it('keeps the question at the top when the confirmation is taller than the window', () => {
    const parts = { section: part(900), heading: part(), actions: part() }

    revealRestoreConfirmation(parts, { focusOnOpen: true, viewportHeight: 568 })

    expect(parts.heading.scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'instant',
    })
    expect(parts.actions.scrollIntoView).not.toHaveBeenCalled()
  })

  it('starts the dialog host at the confirmation, which would otherwise keep the scroll of the page it replaced', () => {
    const parts = { section: part(400), heading: part(), actions: part() }

    revealRestoreConfirmation(parts, { focusOnOpen: false, viewportHeight: 568 })

    expect(parts.section.scrollIntoView).toHaveBeenCalledWith({
      block: 'start',
      behavior: 'instant',
    })
    expect(parts.actions.scrollIntoView).not.toHaveBeenCalled()
    expect(parts.heading.scrollIntoView).not.toHaveBeenCalled()
  })

  it('does nothing before the parts are mounted', () => {
    expect(() =>
      revealRestoreConfirmation(
        { section: null, heading: null, actions: null },
        { focusOnOpen: true, viewportHeight: 568 },
      ),
    ).not.toThrow()
  })

  it('treats a window as tall as the confirmation as fitting', () => {
    const parts = { section: part(568), heading: part(), actions: part() }

    revealRestoreConfirmation(parts, { focusOnOpen: true, viewportHeight: 568 })

    expect(parts.actions.scrollIntoView).toHaveBeenCalled()
  })
})
