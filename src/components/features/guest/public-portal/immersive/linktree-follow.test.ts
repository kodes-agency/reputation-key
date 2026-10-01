// How a Linktree tile is followed. Before a rating the tile is a plain link to
// the navigation-only click route: the server action that records a qualified
// link action refuses a guest who has not rated (it answers 404), so it is never
// called. After a rating the action runs first and the guest is sent to the
// destination it resolves, falling back to the click route if it fails.

import { describe, expect, it, vi } from 'vitest'
import {
  bindLinkSelector,
  followLinktreeLink,
  isPlainPrimaryClick,
} from './linktree-follow'

const TOKEN = 'tok_123'
const NONCE = '00000000-0000-4000-8000-000000000015'

describe('bindLinkSelector', () => {
  it('gives no selector before a rating, so the action cannot be called', () => {
    const action = vi.fn()
    expect(
      bindLinkSelector({
        afterRating: false,
        token: TOKEN,
        csrfNonce: NONCE,
        selectSecondaryLink: action,
      }),
    ).toBeUndefined()
    expect(action).not.toHaveBeenCalled()
  })

  it('gives no selector for a manager preview, which has no token or session nonce', () => {
    const action = vi.fn()
    for (const input of [
      { token: undefined, csrfNonce: NONCE },
      { token: TOKEN, csrfNonce: undefined },
      { token: TOKEN, csrfNonce: '' },
    ]) {
      expect(
        bindLinkSelector({ afterRating: true, selectSecondaryLink: action, ...input }),
      ).toBeUndefined()
    }
  })

  it('gives no selector when the page has no action to bind', () => {
    expect(
      bindLinkSelector({ afterRating: true, token: TOKEN, csrfNonce: NONCE }),
    ).toBeUndefined()
  })

  it('binds the token, the session nonce and the link to the action after a rating', async () => {
    const action = vi.fn().mockResolvedValue({ url: 'https://example.com/spa' })
    const select = bindLinkSelector({
      afterRating: true,
      token: TOKEN,
      csrfNonce: NONCE,
      selectSecondaryLink: action,
    })
    expect(select).toBeTypeOf('function')
    await expect(select?.('link-1')).resolves.toEqual({ url: 'https://example.com/spa' })
    expect(action).toHaveBeenCalledExactlyOnceWith({
      data: { token: TOKEN, csrfNonce: NONCE, linkId: 'link-1' },
    })
  })
})

describe('followLinktreeLink', () => {
  const HREF = '/api/public/p/tok_123/click/link-1'

  it('goes to the destination the qualified action resolved', async () => {
    const navigate = vi.fn()
    const select = vi.fn().mockResolvedValue({ url: 'https://example.com/spa' })
    await followLinktreeLink({ linkId: 'link-1', href: HREF, select, navigate })
    expect(select).toHaveBeenCalledExactlyOnceWith('link-1')
    expect(navigate).toHaveBeenCalledExactlyOnceWith('https://example.com/spa')
  })

  it('falls back to the click route when the action fails, so the guest still arrives', async () => {
    const navigate = vi.fn()
    const select = vi.fn().mockRejectedValue(new Error('network'))
    await followLinktreeLink({ linkId: 'link-1', href: HREF, select, navigate })
    expect(navigate).toHaveBeenCalledExactlyOnceWith(HREF)
  })

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://example.com/insecure',
    '//example.com/protocol-relative',
    '/relative/path',
    'not a url',
    '',
  ])(
    'goes to the click route, not to %j, when the action resolves a non-https URL',
    async (url) => {
      const navigate = vi.fn()
      const select = vi.fn().mockResolvedValue({ url })
      await followLinktreeLink({ linkId: 'link-1', href: HREF, select, navigate })
      expect(navigate).toHaveBeenCalledExactlyOnceWith(HREF)
    },
  )

  it('does not navigate twice when the destination is resolved', async () => {
    const navigate = vi.fn()
    await followLinktreeLink({
      linkId: 'link-1',
      href: HREF,
      select: async () => ({ url: 'https://example.com/spa' }),
      navigate,
    })
    expect(navigate).toHaveBeenCalledTimes(1)
  })
})

describe('isPlainPrimaryClick', () => {
  const click = (overrides: Partial<Parameters<typeof isPlainPrimaryClick>[0]> = {}) =>
    isPlainPrimaryClick({
      button: 0,
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
      defaultPrevented: false,
      ...overrides,
    })

  it('accepts a plain left click', () => {
    expect(click()).toBe(true)
  })

  it.each([
    { button: 1 },
    { button: 2 },
    { metaKey: true },
    { ctrlKey: true },
    { shiftKey: true },
    { altKey: true },
    { defaultPrevented: true },
  ])('leaves %o to the browser, which opens the click route itself', (overrides) => {
    expect(click(overrides)).toBe(false)
  })
})
