import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('GuestResponseForm Google navigation safety', () => {
  const source = readFileSync(
    new URL('./guest-response-form.tsx', import.meta.url),
    'utf8',
  )

  it('navigates only to the URI returned by the current server selection', () => {
    expect(source).toContain('window.location.assign(result.url)')
    expect(source).not.toMatch(/catch\s*\{[^}]*window\.location\.assign/s)
  })
})
