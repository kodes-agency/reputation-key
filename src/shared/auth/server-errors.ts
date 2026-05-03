// Shared server function error helpers.
// Per conventions: server functions catch tagged errors and throw Error objects
// with .name, .message, .code, and .status properties for TanStack Start's seroval serialization.

import { getLogger } from '#/shared/observability/logger'
import { getRequestContext } from '#/shared/observability/request-context'

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
 * Throw a ServerFunctionError — used by all context server functions
 * to translate tagged domain errors into HTTP-appropriate Error objects.
 * Now logs the error with request context before throwing.
 */
export function throwContextError(
  errorName: string,
  e: { code: string; message: string },
  status: number,
): never {
  const ctx = getRequestContext()
  const logger = getLogger()

  logger.error(
    {
      requestId: ctx?.requestId,
      errorType: errorName,
      code: e.code,
      status,
      message: e.message,
    },
    `← THROW ${errorName}(${e.code}) → ${status}`,
  )

  throw new ServerFunctionError(errorName, e.message, e.code, status)
}

/**
 * Catch-all for untagged errors (DB errors, network errors, etc.).
 * Logs full error detail and throws a generic 500.
 * Prevents raw errors (with stack traces, SQL queries) from leaking to the client.
 */
export function catchUntagged(e: unknown): never {
  const ctx = getRequestContext()
  const logger = getLogger()

  logger.error(
    {
      requestId: ctx?.requestId,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : undefined,
      errorType: 'UntaggedError',
    },
    `← THROW InternalError → 500`,
  )

  throw new ServerFunctionError(
    'InternalError',
    'Internal server error',
    'internal_error',
    500,
  )
}
