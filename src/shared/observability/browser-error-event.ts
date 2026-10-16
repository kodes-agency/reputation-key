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

export function beforeSend<T>(event: T, hint?: SentryEventHint): T | null {
  return dropExpectedRefusals<T>((candidate, candidateHint) =>
    scrubErrorEvent(withBrowserFacts(candidate, currentFacts()), candidateHint),
  )(event, hint)
}

export { scrubSentryBreadcrumb as beforeBreadcrumb }
