// The one error shape a server function throws to its caller, and the adapter
// that carries it across the server/client boundary intact.
//
// This module has no server imports so `src/start.ts` (isomorphic) and client
// boundaries can share the class. TanStack Start's default `ShallowErrorPlugin`
// serializes only `message`, which turned every 401/404 into a bare `Error` on
// client-side navigations: routes could not tell an expired session from a
// failure, and the browser reported each refusal to Sentry.

import { createSerializationAdapter } from '@tanstack/react-router'

export class ServerFunctionError extends Error {
  readonly _tag: string
  readonly code: string
  readonly status: number

  constructor(errorName: string, message: string, code: string, status: number) {
    super(message)
    this.name = errorName
    this._tag = errorName
    this.code = code
    this.status = status
  }
}

/**
 * Recognise a server-function error by its shape, not by class identity.
 *
 * `instanceof` was load-bearing in three places (this adapter's `test`,
 * `catchUntagged`, and the traced-server-fn wrapper) and it is not reliable
 * here: this module is imported both as `#/shared/auth/server-function-error`
 * and as `./server-function-error`, which the dev SSR module graph can resolve
 * to two distinct module instances - and therefore two distinct classes. When
 * that happened, an error the domain had already classified
 * (`GoogleImportDiscoveryError(temporarily_unavailable)`, logged as such and
 * thrown with a 503) reached the browser as `InternalError` /
 * `internal_error` / 500, so the whole discovery error vocabulary collapsed
 * into one generic sentence with no action. The `_tag` marker exists precisely
 * so recognition can be structural.
 */
export function isServerFunctionError(value: unknown): value is ServerFunctionError {
  if (!(value instanceof Error)) return false
  const candidate = value as Partial<ServerFunctionError>
  return (
    typeof candidate._tag === 'string' &&
    candidate._tag.length > 0 &&
    typeof candidate.code === 'string' &&
    typeof candidate.status === 'number'
  )
}

export const serverFunctionErrorAdapter = createSerializationAdapter({
  key: 'repkey:server-function-error',
  test: (value): value is ServerFunctionError => isServerFunctionError(value),
  toSerializable: (error) => ({
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.status,
  }),
  fromSerializable: (wire) =>
    new ServerFunctionError(wire.name, wire.message, wire.code, wire.status),
})
