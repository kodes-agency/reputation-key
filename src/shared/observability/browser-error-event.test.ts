import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  cancelledLoad,
  unhandledRejectionEvent,
} from '#/shared/testing/client-hangup-fixtures'
import {
  beforeSend,
  isCancelledLoadRejection,
  withBrowserFacts,
} from './browser-error-event'
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

describe('isCancelledLoadRejection', () => {
  it('recognises a cancelled load that nothing handled', () => {
    expect(
      isCancelledLoadRejection(unhandledRejectionEvent(), {
        originalException: cancelledLoad(),
      }),
    ).toBe(true)
  })

  it('recognises the same rejection under the SDK older mechanism name', () => {
    expect(
      isCancelledLoadRejection(unhandledRejectionEvent('onunhandledrejection'), {
        originalException: cancelledLoad(),
      }),
    ).toBe(true)
  })

  it.each([
    [
      'an AbortError thrown into the page error handler',
      unhandledRejectionEvent('auto.browser.global_handlers.onerror'),
      cancelledLoad(),
    ],
    [
      'an AbortError a component reported itself',
      unhandledRejectionEvent('generic'),
      cancelledLoad(),
    ],
    [
      'an error that application code named AbortError (not the browser abort)',
      unhandledRejectionEvent(),
      Object.assign(new Error('stopped by the app'), { name: 'AbortError' }),
    ],
    [
      'an unhandled rejection that is a TypeError',
      unhandledRejectionEvent(),
      new TypeError('x is undefined'),
    ],
    [
      'an unhandled timeout',
      unhandledRejectionEvent(),
      new DOMException('signal timed out', 'TimeoutError'),
    ],
    ['an unhandled rejection of a plain string', unhandledRejectionEvent(), 'AbortError'],
    ['an event with no exception', {}, cancelledLoad()],
  ])('keeps reporting %s', (_label, event, exception) => {
    expect(isCancelledLoadRejection(event, { originalException: exception })).toBe(false)
  })

  it('keeps reporting an event that arrives without its exception', () => {
    expect(isCancelledLoadRejection(unhandledRejectionEvent(), undefined)).toBe(false)
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

  it('never sends a load the page cancelled and nothing handled', () => {
    expect(
      beforeSend(unhandledRejectionEvent(), { originalException: cancelledLoad() }),
    ).toBeNull()
  })

  it('still sends an unhandled rejection that is not a cancelled load', () => {
    vi.stubGlobal('navigator', { userAgent: CHROME_ON_MAC })

    expect(
      beforeSend(unhandledRejectionEvent(), {
        originalException: new TypeError('x is undefined'),
      }),
    ).not.toBeNull()
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
