import { describe, expect, it } from 'vitest'
import { absoluteUrl, originOf } from './urls'

describe('absoluteUrl', () => {
  it('joins a base and a path', () => {
    expect(absoluteUrl('https://app.test', '/inbox')).toBe('https://app.test/inbox')
  })

  it('normalises a trailing slash on the base — the bug the concatenations had', () => {
    expect(absoluteUrl('https://app.test/', '/inbox')).toBe('https://app.test/inbox')
    expect(absoluteUrl('https://app.test///', '/inbox')).toBe('https://app.test/inbox')
  })

  it('normalises a missing leading slash on the path', () => {
    expect(absoluteUrl('https://app.test', 'inbox')).toBe('https://app.test/inbox')
  })

  it('preserves a path prefix on the base', () => {
    expect(absoluteUrl('https://host.test/app/', 'inbox')).toBe(
      'https://host.test/app/inbox',
    )
  })

  it('returns the bare base for an empty or root path', () => {
    expect(absoluteUrl('https://app.test/', '')).toBe('https://app.test')
    expect(absoluteUrl('https://app.test', '/')).toBe('https://app.test')
  })

  it('encodes query values, including the characters that break a raw href', () => {
    expect(
      absoluteUrl('https://app.test', '/accept-invitation', { id: 'a b&c=d?e#f' }),
    ).toBe('https://app.test/accept-invitation?id=a%20b%26c%3Dd%3Fe%23f')
  })

  it('encodes non-ASCII query values', () => {
    expect(absoluteUrl('https://app.test', '/inbox', { q: 'Rivière' })).toBe(
      'https://app.test/inbox?q=Rivi%C3%A8re',
    )
  })

  it('encodes keys as well as values', () => {
    expect(absoluteUrl('https://app.test', '/x', { 'a key': 'v' })).toBe(
      'https://app.test/x?a%20key=v',
    )
  })

  it('joins multiple parameters in insertion order', () => {
    expect(
      absoluteUrl('https://app.test', '/inbox', { itemId: '1', tab: 'replies' }),
    ).toBe('https://app.test/inbox?itemId=1&tab=replies')
  })

  it('omits the question mark when search is empty or absent', () => {
    expect(absoluteUrl('https://app.test', '/inbox', {})).toBe('https://app.test/inbox')
    expect(absoluteUrl('https://app.test', '/inbox')).toBe('https://app.test/inbox')
  })

  it('reproduces the invitation link the three former call sites built', () => {
    expect(
      absoluteUrl('http://localhost:3000', '/accept-invitation', { id: 'inv-test-1' }),
    ).toBe('http://localhost:3000/accept-invitation?id=inv-test-1')
  })
})

describe('originOf', () => {
  it('extracts the origin of an absolute URL', () => {
    expect(originOf('https://app.test/settings/notifications')).toBe('https://app.test')
    expect(originOf('http://localhost:3000/x?y=1')).toBe('http://localhost:3000')
  })

  it('returns null rather than throwing for a non-URL', () => {
    expect(originOf('/settings/notifications')).toBeNull()
    expect(originOf('')).toBeNull()
  })
})
