import { describe, expect, it } from 'vitest'
import { shortcutModifierFor } from './use-shortcut-modifier'

describe('shortcutModifierFor', () => {
  it.each(['MacIntel', 'MacPPC', 'iPhone', 'iPad'])('prints ⌘ on %s', (platform) => {
    expect(shortcutModifierFor(platform)).toBe('⌘')
  })

  it.each(['Win32', 'Linux x86_64', 'Linux armv81', ''])(
    'prints Ctrl on %s',
    (platform) => {
      expect(shortcutModifierFor(platform)).toBe('Ctrl')
    },
  )
})
