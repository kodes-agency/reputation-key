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

export const serverFunctionErrorAdapter = createSerializationAdapter({
  key: 'repkey:server-function-error',
  test: (value): value is ServerFunctionError => value instanceof ServerFunctionError,
  toSerializable: (error) => ({
    name: error.name,
    message: error.message,
    code: error.code,
    status: error.status,
  }),
  fromSerializable: (wire) =>
    new ServerFunctionError(wire.name, wire.message, wire.code, wire.status),
})
