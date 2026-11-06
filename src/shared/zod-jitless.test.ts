import { execFileSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod/v4'

const originalJitless = z.config().jitless

afterEach(() => {
  vi.unstubAllGlobals()
  vi.doUnmock('@tanstack/react-start/client')
  vi.doUnmock('react-dom/client')
  vi.doUnmock('../instrument.client')
  vi.doUnmock('./stale-tab/stale-tab')
  z.config({ jitless: originalJitless })
  vi.resetModules()
})

it('validates startup and later guest schemas without attempting dynamic code', async () => {
  vi.resetModules()
  z.config({ jitless: false })
  let evalAttempts = 0
  vi.stubGlobal(
    'Function',
    new Proxy(Function, {
      construct() {
        evalAttempts++
        throw new EvalError('Dynamic code is blocked by CSP')
      },
    }),
  )

  const hydrateRoot = vi.fn()
  vi.stubGlobal('document', {})
  vi.doMock('react-dom/client', () => ({ hydrateRoot }))
  vi.doMock('../instrument.client', () => ({}))
  vi.doMock('./stale-tab/stale-tab', () => ({ startStaleTabGuard: vi.fn() }))
  vi.doMock('@tanstack/react-start/client', () => {
    // Dependency evaluation constructs schemas before the entry's body runs.
    const login = z.object({ email: z.email(), password: z.string().min(1) })
    expect(
      login.safeParse({ email: 'user@example.com', password: 'secret' }).success,
    ).toBe(true)
    expect(login.safeParse({ email: 'invalid', password: '' }).success).toBe(false)
    return { StartClient: () => null }
  })

  await import('../client')
  expect(hydrateRoot).toHaveBeenCalledOnce()

  const { guestRatingFormDto } =
    await import('../contexts/guest/application/dto/guest-response-form.dto')
  expect(guestRatingFormDto.parse({ rating: 5, honeypot: '' })).toEqual({
    rating: 5,
    honeypot: '',
  })
  expect(guestRatingFormDto.safeParse({ rating: 6, honeypot: '' }).success).toBe(false)
  expect(evalAttempts).toBe(0)
})

it('avoids even the eval probe on a cold Zod import', () => {
  // A fresh process prevents the test setup's schemas from caching the probe.
  execFileSync(
    process.execPath,
    [
      '--import',
      'tsx',
      '--input-type=module',
      '--eval',
      `
        import assert from 'node:assert/strict'
        let evalAttempts = 0
        globalThis.Function = new Proxy(Function, {
          construct() {
            evalAttempts++
            throw new EvalError('Dynamic code is blocked by CSP')
          },
        })
        await import('./src/shared/zod-jitless.ts')
        const { guestRatingFormDto, guestPrivateFeedbackFormDto } = await import(
          './src/contexts/guest/application/dto/guest-response-form.dto.ts'
        )
        assert.deepEqual(guestRatingFormDto.parse({ rating: 5, honeypot: '' }), {
          rating: 5, honeypot: '',
        })
        assert.equal(guestRatingFormDto.safeParse({ rating: 6, honeypot: '' }).success, false)
        assert.equal(guestPrivateFeedbackFormDto.safeParse({ text: 'Thank you', honeypot: '' }).success, true)
        assert.equal(guestPrivateFeedbackFormDto.safeParse({ text: '', honeypot: '' }).success, false)
        assert.equal(evalAttempts, 0)
      `,
    ],
    { cwd: process.cwd(), stdio: 'pipe', timeout: 10_000 },
  )
})
