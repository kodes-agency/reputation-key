import { afterEach, describe, expect, it, vi } from 'vitest'
import { bindLinkTapCounter } from './linktree-follow'

const TOKEN = 'tok_123'
const NONCE = '00000000-0000-4000-8000-000000000015'

afterEach(() => vi.unstubAllGlobals())

describe('bindLinkTapCounter', () => {
  it('counts a tap with an unload-safe fetch without waiting for its response', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response())
    vi.stubGlobal('fetch', fetch)
    const action = vi.fn(async (input) => {
      await input.fetch('/_serverFn/tap', {
        method: 'POST',
        body: 'tap',
        credentials: 'same-origin',
      })
      return new Promise<{ url: string }>(() => {})
    })
    const countTap = bindLinkTapCounter({
      token: TOKEN,
      csrfNonce: NONCE,
      selectSecondaryLink: action,
    })
    expect(countTap?.('link-1')).toBeUndefined()
    expect(action).toHaveBeenCalledExactlyOnceWith({
      data: { token: TOKEN, csrfNonce: NONCE, linkId: 'link-1' },
      fetch: expect.any(Function),
    })
    expect(fetch).toHaveBeenCalledExactlyOnceWith('/_serverFn/tap', {
      method: 'POST',
      body: 'tap',
      credentials: 'same-origin',
      keepalive: true,
    })
  })

  it('drops a rejected action while the guest follows the anchor', async () => {
    const action = vi.fn().mockRejectedValue(new Error('network'))
    const countTap = bindLinkTapCounter({
      token: TOKEN,
      csrfNonce: NONCE,
      selectSecondaryLink: action,
    })
    expect(() => countTap?.('link-1')).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(action).toHaveBeenCalledOnce()
  })

  it.each([
    { token: undefined, csrfNonce: NONCE },
    { token: TOKEN, csrfNonce: undefined },
    { token: TOKEN, csrfNonce: '' },
  ])('gives an inert preview no handler: %o', (input) => {
    const action = vi.fn()
    expect(bindLinkTapCounter({ ...input, selectSecondaryLink: action })).toBeUndefined()
    expect(action).not.toHaveBeenCalled()
  })

  it('gives no handler when there is no action', () => {
    expect(bindLinkTapCounter({ token: TOKEN, csrfNonce: NONCE })).toBeUndefined()
  })
})
