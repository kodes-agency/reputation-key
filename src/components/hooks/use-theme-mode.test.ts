// Third-party widgets (the Toaster) take their own `theme` prop; it must be the
// theme the document is showing, not a guess from the stored mode.
import { describe, expect, it } from 'vitest'
import { resolveAppliedTheme } from './use-theme-mode'

describe('resolveAppliedTheme', () => {
  it('is the theme class the app left on the document', () => {
    expect(resolveAppliedTheme({ contains: (name) => name === 'dark' })).toBe('dark')
    expect(resolveAppliedTheme({ contains: (name) => name === 'light' })).toBe('light')
  })

  it('is light before any theme class exists', () => {
    expect(resolveAppliedTheme({ contains: () => false })).toBe('light')
  })
})
