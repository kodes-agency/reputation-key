import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(
  join(process.cwd(), 'src/contexts/guest/server/guest-scans.ts'),
  'utf8',
)
const mutationSource = readFileSync(
  join(process.cwd(), 'src/contexts/guest/server/public.ts'),
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

  it('requires the configured origin and signed-session CSRF before public mutations', () => {
    const originAdmission = mutationSource.indexOf(
      'if (origin !== new URL(getEnv().BETTER_AUTH_URL).origin)',
    )
    const signedSessionAdmission = mutationSource.indexOf(
      "useCases.guestSessions.verify(requestHeaders.get('cookie') ?? '', scope)",
    )
    const csrfAdmission = mutationSource.indexOf(
      'useCases.guestSessions.verifyCsrf(session, input.csrfNonce)',
    )

    expect(originAdmission).toBeGreaterThan(-1)
    expect(signedSessionAdmission).toBeGreaterThan(originAdmission)
    expect(csrfAdmission).toBeGreaterThan(signedSessionAdmission)
  })
})
