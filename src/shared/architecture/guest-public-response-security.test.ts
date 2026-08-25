import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(
  join(process.cwd(), 'src/contexts/guest/server/guest-scans.ts'),
  'utf8',
)

describe('guest public response security', () => {
  it('marks the nonce-bearing public Portal response private and non-cacheable', () => {
    expect(source).toContain("setResponseHeader('Cache-Control', 'private, no-store')")
    expect(source).toContain("setResponseHeader('Vary', 'Cookie')")
  })

  it('uses the shared layered limiter for scan recording', () => {
    expect(source).toContain('checkLayeredGuestRateLimit')
    expect(source).toMatch(/guestRateLimitKeys\(\s*'scan'/)
  })
})
