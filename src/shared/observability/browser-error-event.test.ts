import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { beforeSend, withBrowserFacts } from './browser-error-event'
import { setBrowserRouteSource } from './browser-route'

const CHROME_ON_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36'

describe('withBrowserFacts', () => {
  it('marks the event as a browser one and adds the route and browser it happened in', () => {
    expect(
      withBrowserFacts(
        { tags: { level: 'error' }, contexts: { trace: { trace_id: 't' } } },
        { route: '/_authenticated/inbox/', userAgent: CHROME_ON_MAC },
      ),
    ).toEqual({
      tags: { level: 'error', service: 'browser', route: '/_authenticated/inbox/' },
      contexts: {
        trace: { trace_id: 't' },
        browser: { name: 'Chrome', version: '141' },
        os: { name: 'macOS' },
      },
    })
  })

  it('leaves out what it does not know', () => {
    expect(withBrowserFacts({}, {})).toEqual({
      tags: { service: 'browser' },
      contexts: {},
    })
  })
})

describe('the browser beforeSend', () => {
  afterEach(() => {
    setBrowserRouteSource(undefined)
    vi.unstubAllGlobals()
  })

  it('sends the route, browser and error code, and still replaces the message', () => {
    const marker = 'guest-wrote-this@example.invalid'
    setBrowserRouteSource(() => '/_authenticated/properties/$propertyId/inbox/')
    vi.stubGlobal('navigator', { userAgent: CHROME_ON_MAC })

    const sent = beforeSend(
      { exception: { values: [{ type: 'FeedbackError', value: marker }] } },
      {
        originalException: new ServerFunctionError(
          'FeedbackError',
          marker,
          'temporarily_unavailable',
          503,
        ),
      },
    ) as Record<string, unknown>

    expect(sent.tags).toEqual({
      service: 'browser',
      route: '/_authenticated/properties/$propertyId/inbox/',
      error_code: 'temporarily_unavailable',
    })
    expect(sent.contexts).toEqual({
      browser: { name: 'Chrome', version: '141' },
      os: { name: 'macOS' },
    })
    expect(JSON.stringify(sent)).not.toContain(marker)
  })

  it('never sends an expected refusal', () => {
    expect(
      beforeSend(
        { message: 'refused' },
        {
          originalException: new ServerFunctionError(
            'AuthError',
            'x',
            'unauthorized',
            401,
          ),
        },
      ),
    ).toBeNull()
  })
})
