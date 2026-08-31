// ARC-03-T13 — pins the behavior of the ONE request-context adapter.
//
// Both duplicated implementations this replaced had the same contract: copy
// every header when a server request exists, and return EMPTY headers when
// there is none (worker, job, fixture). The empty-headers path is the one that
// keeps non-web processes working, so it is asserted first.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTanstackRequestContext } from './tanstack-request-context'

const getRequest = vi.fn()

vi.mock('@tanstack/react-start/server', () => ({
  getRequest: () => getRequest(),
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe('createTanstackRequestContext', () => {
  it('returns empty headers when there is no server request context', async () => {
    getRequest.mockImplementation(() => {
      throw new Error('no server context')
    })
    const observeAbsentRequest = vi.fn()

    const headers = await createTanstackRequestContext({
      observeAbsentRequest,
    }).currentRequestHeaders()

    expect([...headers.keys()]).toEqual([])
    expect(observeAbsentRequest).toHaveBeenCalledTimes(1)
  })

  it('returns empty headers when the framework resolves no request', async () => {
    getRequest.mockReturnValue(undefined)

    const headers = await createTanstackRequestContext().currentRequestHeaders()

    expect([...headers.keys()]).toEqual([])
  })

  it('copies every header of the resolved request', async () => {
    getRequest.mockReturnValue({
      headers: new Headers({
        cookie: 'session=abc',
        'x-forwarded-for': '203.0.113.7',
      }),
    })

    const headers = await createTanstackRequestContext().currentRequestHeaders()

    expect(headers.get('cookie')).toBe('session=abc')
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7')
    expect([...headers.keys()].sort()).toEqual(['cookie', 'x-forwarded-for'])
  })

  it('does not report an absent request when one exists', async () => {
    getRequest.mockReturnValue({ headers: new Headers({ cookie: 'session=abc' }) })
    const observeAbsentRequest = vi.fn()

    await createTanstackRequestContext({ observeAbsentRequest }).currentRequestHeaders()

    expect(observeAbsentRequest).not.toHaveBeenCalled()
  })
})
