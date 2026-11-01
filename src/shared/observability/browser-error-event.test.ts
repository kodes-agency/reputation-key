import { afterEach, describe, expect, it, vi } from 'vitest'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import {
  cancelledLoad,
  unhandledRejectionEvent,
} from '#/shared/testing/client-hangup-fixtures'
import {
  beforeSend,
  isCancelledLoadRejection,
  isHydrationOfPageAlreadyLeft,
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

/** What React hands to `window.reportError` when it recovers from a hydration error. */
const hydrationRecovery = (code: number, cause: unknown): Error =>
  new Error(`Minified React error #${code}; visit https://react.dev/errors/${code}`, {
    cause,
  })
const routerInvariant = (): Error => new Error('Invariant failed')

describe('isHydrationOfPageAlreadyLeft', () => {
  const left = { loadedPath: '/properties', currentPath: '/settings/profile' }

  it.each([422, 423])(
    'recognises the page the visitor left while React hydrated it (#%i)',
    (code) => {
      expect(
        isHydrationOfPageAlreadyLeft(hydrationRecovery(code, routerInvariant()), left),
      ).toBe(true)
    },
  )

  it.each([
    [
      'the same error on the page that loaded',
      hydrationRecovery(423, routerInvariant()),
      { loadedPath: '/properties', currentPath: '/properties' },
    ],
    [
      'a hydration recovery caused by anything else',
      hydrationRecovery(423, new TypeError('x is undefined')),
      left,
    ],
    ['a hydration recovery with no cause', hydrationRecovery(423, undefined), left],
    ['a hydration mismatch', hydrationRecovery(418, routerInvariant()), left],
    ['the router invariant on its own', routerInvariant(), left],
    [
      'a page whose loaded address is not known',
      hydrationRecovery(423, routerInvariant()),
      { loadedPath: undefined, currentPath: '/settings/profile' },
    ],
    ['something that is not an error', 'Invariant failed', left],
  ])('keeps reporting %s', (_label, exception, page) => {
    expect(isHydrationOfPageAlreadyLeft(exception, page)).toBe(false)
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

  describe('a page the visitor left while it hydrated', () => {
    const loadedAt = (path: string): void => {
      vi.stubGlobal('performance', {
        getEntriesByType: () => [{ name: `https://app.example.invalid${path}?a=1` }],
      })
    }
    const event = { exception: { values: [{ type: 'Error', value: 'x' }] } }

    it('is never sent', () => {
      loadedAt('/properties')
      vi.stubGlobal('location', { pathname: '/settings/profile' })

      expect(
        beforeSend(event, {
          originalException: hydrationRecovery(423, routerInvariant()),
        }),
      ).toBeNull()
    })

    it('is still sent when the visitor is on the page that loaded', () => {
      loadedAt('/properties')
      vi.stubGlobal('location', { pathname: '/properties' })
      vi.stubGlobal('navigator', { userAgent: CHROME_ON_MAC })

      expect(
        beforeSend(event, {
          originalException: hydrationRecovery(423, routerInvariant()),
        }),
      ).not.toBeNull()
    })
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
