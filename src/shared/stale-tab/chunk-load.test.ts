// The words a browser uses when a dynamic import cannot fetch its file. Error
// monitoring tags them `chunk_load`; the tab reads them as "my code is old".
import { describe, expect, it } from 'vitest'
import { isChunkLoadMessage } from './chunk-load'

describe('isChunkLoadMessage', () => {
  it.each([
    ['Chromium', 'Failed to fetch dynamically imported module: https://x/assets/a-1.js'],
    ['Firefox', 'error loading dynamically imported module: https://x/assets/a-1.js'],
    ['Safari', 'Importing a module script failed.'],
    ['Safari without the full stop', 'Importing a module script failed'],
    ['Vite, for a stylesheet', 'Unable to preload CSS for /assets/a-1.css'],
  ])('recognises %s', (_browser, message) => {
    expect(isChunkLoadMessage(message)).toBe(true)
  })

  it.each([
    'Load failed',
    'Failed to fetch',
    'NetworkError when attempting to fetch resource.',
    "Cannot read properties of undefined (reading 'length')",
    'Importing a module script failed. Then something else happened.',
    '',
  ])('does not mistake %j for one', (message) => {
    expect(isChunkLoadMessage(message)).toBe(false)
  })
})
