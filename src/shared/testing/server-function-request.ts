// The Start request a harness call runs inside: the caller's session cookie,
// any extra request headers, and the response headers the call sets.

import { AsyncLocalStorage } from 'node:async_hooks'
import { H3Event } from 'nitro/h3'
import { getEnv } from '#/shared/config/env'

// Start's request event and request context. Both are keyed by Symbol.for
// because the production build bundles their modules twice.
const EVENT_STORAGE_KEY = Symbol.for('tanstack-start:event-storage')
const START_STORAGE_KEY = Symbol.for('tanstack-start:start-storage-context')

type ProcessSlots = Record<symbol, unknown>

/** Whoever makes the call: anything signed in carries a session cookie. */
export type TestCaller = Readonly<{ cookie: string }>

export type CallRequest = Readonly<{
  /** Extra request headers (user-agent, accept-language, x-forwarded-for, ...). */
  headers?: Readonly<Record<string, string>>
  /** Cookie pairs (`name=value`) sent beside the caller's session cookie. */
  cookies?: readonly string[]
  /** The Origin header; `null` sends none. Defaults to the app's own origin. */
  origin?: string | null
}>

/** What a call answered with, and the response it left on the request. */
export type CallResponse<T> = Readonly<
  {
    status: number
    /** The response headers the call set: Set-Cookie, Cache-Control, Retry-After. */
    headers: Headers
  } & ({ ok: true; value: T } | { ok: false; error: unknown })
>

function storageFor<T>(key: symbol): AsyncLocalStorage<T> {
  const slots = globalThis as ProcessSlots
  if (!slots[key]) slots[key] = new AsyncLocalStorage<T>()
  return slots[key] as AsyncLocalStorage<T>
}

function requestFrom(caller: TestCaller | null, options: CallRequest): Request {
  const { BETTER_AUTH_URL } = getEnv()
  const headers = new Headers({ 'sec-fetch-site': 'same-origin', ...options.headers })
  const origin =
    options.origin === undefined ? new URL(BETTER_AUTH_URL).origin : options.origin
  if (origin !== null) headers.set('origin', origin)
  const cookies = [...(caller ? [caller.cookie] : []), ...(options.cookies ?? [])]
  if (cookies.length > 0) headers.set('cookie', cookies.join('; '))
  return new Request(new URL('/_serverFn/harness', BETTER_AUTH_URL), {
    method: 'POST',
    headers,
  })
}

/** Run `call` in a Start request from `caller` and keep what it answered. */
export async function respond<T>(
  caller: TestCaller | null,
  call: () => Promise<T>,
  options: CallRequest = {},
): Promise<CallResponse<T>> {
  const request = requestFrom(caller, options)
  const event = new H3Event(request)
  const run = () =>
    storageFor<{ h3Event: H3Event }>(EVENT_STORAGE_KEY).run({ h3Event: event }, () =>
      storageFor(START_STORAGE_KEY).run(
        { startOptions: {}, request, contextAfterGlobalMiddlewares: {} },
        call,
      ),
    )
  const response = () => ({ status: event.res.status ?? 200, headers: event.res.headers })
  try {
    const value = await run()
    return { ...response(), ok: true, value }
  } catch (error) {
    return { ...response(), ok: false, error }
  }
}

/** The session cookie pair a Better Auth sign-in set. */
export function sessionCookie(headers: Headers): string {
  const pairs = headers.getSetCookie().map((cookie) => cookie.split(';')[0] ?? '')
  const session = pairs.find((pair) =>
    /^(__Secure-)?better-auth\.session_token=./.test(pair),
  )
  if (!session) throw new Error('Sign-in returned no session cookie')
  return session
}
