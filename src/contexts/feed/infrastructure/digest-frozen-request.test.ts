// A retry of a digest the provider may already hold re-sends the frozen request
// verbatim. That is only safe while the stored request is exactly what the
// batch's content digest describes; anything else must read as absent so the
// retry falls back to re-rendering and comparing, which fails closed.

import { describe, expect, it } from 'vitest'
import { digestProviderRequest } from './digest-batch-identity'
import { frozenDigestRequest, readFrozenDigestRequest } from './digest-frozen-request'

const request = {
  to: 'manager@example.com',
  subject: 'Your RepKey digest',
  html: '<p>3 reviews need a reply</p>',
  text: '3 reviews need a reply',
  headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
}
const digest = digestProviderRequest(request)

describe('readFrozenDigestRequest', () => {
  it('returns the stored request when it still fingerprints to the batch', () => {
    expect(readFrozenDigestRequest(request, digest)).toEqual(request)
  })

  it('reads a request that no longer matches the batch as absent', () => {
    expect(readFrozenDigestRequest({ ...request, text: 'edited' }, digest)).toBeNull()
  })

  it.each([
    ['nothing stored', null],
    ['a non-object', 'frozen'],
    ['a missing recipient', { ...request, to: '' }],
    ['headers that are not strings', { ...request, headers: { a: 1 } }],
  ])('reads %s as absent', (_label, stored) => {
    expect(readFrozenDigestRequest(stored, digest)).toBeNull()
  })
})

describe('frozenDigestRequest', () => {
  it('keeps exactly the fields the content digest covers', () => {
    const frozen = frozenDigestRequest({
      ...request,
      extra: 'not covered',
    } as typeof request)

    expect(frozen).toEqual(request)
    expect(digestProviderRequest(frozen)).toBe(digest)
  })

  it('does not share the caller’s headers object', () => {
    const frozen = frozenDigestRequest(request)

    expect(frozen.headers).not.toBe(request.headers)
  })
})
