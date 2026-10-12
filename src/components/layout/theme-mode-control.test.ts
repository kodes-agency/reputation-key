// One theme choice, drawn one way. The account menu and the Preferences page
// show the same segmented Light / Dark / System control, in that order; the
// public header's compact button walks the same list in the same direction.
// Before, the app menu cycled dark -> light -> auto and labelled the NEXT mode
// with the CURRENT mode's icon, while the header and Preferences cycled
// light -> dark -> auto.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { THEME_MODE_OPTIONS, nextThemeMode, themeModeLabel } from './theme-mode-options'
import { ThemeModeControl } from './theme-mode-control'
import { ThemeToggle } from './theme-toggle'

describe('theme mode options', () => {
  it('are Light, Dark, System, in that order', () => {
    expect(THEME_MODE_OPTIONS.map((option) => option.value)).toEqual([
      'light',
      'dark',
      'auto',
    ])
    expect(THEME_MODE_OPTIONS.map((option) => option.label)).toEqual([
      'Light',
      'Dark',
      'System',
    ])
  })

  it('names the stored "auto" mode System', () => {
    expect(themeModeLabel('auto')).toBe('System')
    expect(themeModeLabel('light')).toBe('Light')
    expect(themeModeLabel('dark')).toBe('Dark')
  })

  it('cycles in the order they are listed and wraps', () => {
    expect(nextThemeMode('light')).toBe('dark')
    expect(nextThemeMode('dark')).toBe('auto')
    expect(nextThemeMode('auto')).toBe('light')
  })
})

describe('ThemeModeControl', () => {
  it('is a radio group named Theme with one radio per mode, in order', () => {
    const html = renderToStaticMarkup(createElement(ThemeModeControl))

    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('aria-label="Theme"')
    const labels = [...html.matchAll(/role="radio"[^>]*>([^<]+)</gu)].map(
      (match) => match[1],
    )
    expect(labels).toEqual(['Light', 'Dark', 'System'])
  })

  it('checks exactly one mode: System before the stored choice is read', () => {
    const html = renderToStaticMarkup(createElement(ThemeModeControl))

    expect(html.match(/aria-checked="true"/gu)).toHaveLength(1)
    expect(html).toMatch(/aria-checked="true"[^>]*value="auto"/u)
  })

  it('takes its name from a visible label when the page draws one', () => {
    const html = renderToStaticMarkup(
      createElement(ThemeModeControl, { labelledBy: 'theme-row-label' }),
    )

    expect(html).toContain('aria-labelledby="theme-row-label"')
    expect(html).not.toContain('aria-label="Theme"')
  })
})

describe('ThemeToggle', () => {
  it('names the current mode and the one a click switches to, in list order', () => {
    // Before the stored choice is read the mode is System, and System wraps to Light.
    const html = renderToStaticMarkup(createElement(ThemeToggle))

    expect(html).toContain('aria-label="Theme: System. Switch to Light."')
  })
})
