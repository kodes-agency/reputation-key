// A visitor closing the connection while the server answers is no failure of
// ours, so it does not become an issue.
//
// This sits beside the expected-refusal rule (src/shared/security/expected-
// refusal.ts) and is applied at the same server places: the server SDK's
// `beforeSend` and the Nitro error hook. The rule keys on the shape of ONE
// failure and not on a broad class: a reset on our own Postgres, Redis or
// Google sockets must still report, so a rule wider than its evidence is a bug.
//
// Server only. The browser has its own rule for the one browser failure it
// drops (browser-error-event.ts), and this module is not importable from
// browser code (vite.config.ts importProtection).

import type { SentryEventHint } from './sentry-event-scrub'

type BeforeSend<T> = (event: T, hint?: SentryEventHint) => T | null

// The frame Node 22 raises it from: `abortIncoming` in the HTTP *server*. The
// same message and code come out of the HTTP *client* when an upstream cuts a
// response this process was reading (`socketCloseListener` in
// `node:_http_client`), and that one is a real upstream failure.
const INCOMING_ABORT_FRAME = /\babortIncoming \(node:_http_server:/u

/**
 * The error Node raises on a request when the peer closes its connection
 * before the server has finished: a visitor who navigated away, lost signal or
 * closed the tab while the page was still being answered. There is nothing to
 * fix, so it is not reported.
 *
 * Keyed on the whole shape and not on `ECONNRESET`: the code and the words
 * `aborted`, no `syscall` (a socket reset on our own Postgres, Redis or Google
 * connection carries one), and the server-side frame it is raised from.
 */
export function isIncomingRequestAbort(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false
  const fields = error as Readonly<Record<string, unknown>>
  return (
    fields.code === 'ECONNRESET' &&
    fields.message === 'aborted' &&
    fields.syscall === undefined &&
    typeof fields.stack === 'string' &&
    INCOMING_ABORT_FRAME.test(fields.stack)
  )
}

/** `beforeSend` step: a hang-up never reaches the scrubber, let alone Sentry. */
export function dropClientHangups<T>(next: BeforeSend<T>): BeforeSend<T> {
  return (event, hint) =>
    isIncomingRequestAbort(hint?.originalException) ? null : next(event, hint)
}
