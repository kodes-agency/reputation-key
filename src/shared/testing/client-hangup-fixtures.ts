// Failures as Node 22 and Chrome raise them, for the suites that decide which
// failures reach error monitoring (client-hangup.test.ts, the server and Nitro
// wiring tests, and browser-error-event.test.ts). The two Node stacks were
// captured from a real socket: a client that closes its connection while the
// server is still answering, and a server that closes the connection while this
// process is still reading its response.

export const INCOMING_ABORT_STACK = [
  'Error: aborted',
  '    at abortIncoming (node:_http_server:838:17)',
  '    at socketOnClose (node:_http_server:832:3)',
  '    at Socket.emit (node:events:531:35)',
  '    at TCP.<anonymous> (node:net:347:12)',
].join('\n')

const RESPONSE_CUT_STACK = [
  'Error: aborted',
  '    at Socket.socketCloseListener (node:_http_client:535:19)',
  '    at Socket.emit (node:events:531:35)',
  '    at TCP.<anonymous> (node:net:347:12)',
].join('\n')

/** An error carrying exactly the fields given, with the stack a real one had. */
export function resetError(
  message: string,
  stack: string,
  extra: Readonly<Record<string, unknown>> = {},
): Error {
  const error = Object.assign(new Error(message), { code: 'ECONNRESET' }, extra)
  error.stack = stack
  return error
}

/** A visitor closed the connection while the server was still answering. */
export const incomingRequestAbort = (): Error =>
  resetError('aborted', INCOMING_ABORT_STACK)

/** The same words and code, from a server cutting a response this process read. */
export const responseCutByServer = (): Error => resetError('aborted', RESPONSE_CUT_STACK)

/** A reset on one of our own sockets (Postgres, Redis, Google). */
export const outboundSocketReset = (): Error =>
  resetError(
    'read ECONNRESET',
    'Error: read ECONNRESET\n    at TCP.onStreamRead (node:internal/stream_base_commons:216:20)',
    { errno: -104, syscall: 'read' },
  )

/** What Chrome rejects a pending fetch with when its signal is aborted. */
export const cancelledLoad = (): DOMException =>
  new DOMException('signal is aborted without reason', 'AbortError')

/** The event the browser SDK builds for a promise rejection nothing handled. */
export const unhandledRejectionEvent = (
  mechanism = 'auto.browser.global_handlers.onunhandledrejection',
) => ({
  exception: {
    values: [{ type: 'AbortError', mechanism: { type: mechanism, handled: false } }],
  },
})
