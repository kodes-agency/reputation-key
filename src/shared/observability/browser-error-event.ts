// The browser SDK's `beforeSend` and `beforeBreadcrumb`. instrument.client.ts
// loads this module together with the SDK, so none of it is in first paint.
//
// An error event first gets what only the browser knows (that it came from a
// browser, the route template the page was on, and the browser's name, major
// version and operating system), then the same codes and scrubbing as a server
// event (sentry-event-scrub.ts). The scrubber still decides what leaves.

import { browserFamily } from './browser-family'
import { browserRouteTemplate } from './browser-route'
import {
  dropExpectedRefusals,
  scrubErrorEvent,
  scrubSentryBreadcrumb,
  type SentryEventHint,
} from './sentry-event-scrub'

export type BrowserFacts = Readonly<{ route?: string; userAgent?: string }>

type EventRecord = Readonly<Record<string, unknown>>

function asRecord(value: unknown): EventRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as EventRecord)
    : undefined
}

export function withBrowserFacts<T>(event: T, facts: BrowserFacts): T {
  const record = asRecord(event)
  if (!record) return event
  return {
    ...record,
    tags: {
      ...asRecord(record.tags),
      service: 'browser',
      ...(facts.route ? { route: facts.route } : {}),
    },
    contexts: {
      ...asRecord(record.contexts),
      ...(facts.userAgent ? browserFamily(facts.userAgent) : {}),
    },
  } as T
}

function currentFacts(): BrowserFacts {
  return {
    route: browserRouteTemplate(),
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  }
}

function lastExceptionMechanism(event: unknown): string | undefined {
  const values = asRecord(asRecord(event)?.exception)?.values
  if (!Array.isArray(values)) return undefined
  const mechanism = asRecord(asRecord(values[values.length - 1])?.mechanism)
  return typeof mechanism?.type === 'string' ? mechanism.type : undefined
}

/**
 * A browser request that was cancelled on purpose, whose rejection nobody
 * handled: the page's own code aborted it (a component left the screen and its
 * query was cancelled), and the browser rejected the pending call with an
 * `AbortError`. An `AbortError` is the browser's answer to a cancel, never a
 * fault.
 *
 * Narrow on both sides: only the SDK's unhandled-rejection mechanism, and only
 * the browser's own `DOMException` named `AbortError`. An `Error` that
 * application code named `AbortError` is not a browser cancel and keeps
 * reporting, as do a timeout (`TimeoutError`), a network failure and every
 * other rejection. The server has its own single-shape rule beside this one
 * (client-hangup.ts).
 */
export function isCancelledLoadRejection(
  event: unknown,
  hint?: SentryEventHint,
): boolean {
  if (!isBrowserAbort(hint?.originalException)) return false
  return lastExceptionMechanism(event)?.endsWith('onunhandledrejection') === true
}

function isBrowserAbort(value: unknown): boolean {
  return (
    typeof DOMException !== 'undefined' &&
    value instanceof DOMException &&
    value.name === 'AbortError'
  )
}

export function beforeSend<T>(event: T, hint?: SentryEventHint): T | null {
  if (isCancelledLoadRejection(event, hint)) return null
  return dropExpectedRefusals<T>((candidate, candidateHint) =>
    scrubErrorEvent(withBrowserFacts(candidate, currentFacts()), candidateHint),
  )(event, hint)
}

export { scrubSentryBreadcrumb as beforeBreadcrumb }
