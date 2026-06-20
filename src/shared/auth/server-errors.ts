// Shared server function error helpers.
// Per conventions: server functions catch tagged errors and throw Error objects
// with .name, .message, .code, and .status properties for TanStack Start's seroval serialization.

import { getLogger } from '#/shared/observability/logger'
import { getRequestContext } from '#/shared/observability/request-context'
import { APIError } from 'better-auth'

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
 * better-auth throws `APIError` (status is a string label like "FORBIDDEN") for
 * every auth/org failure. Map its status name to an HTTP code + a human message
 * so the real reason reaches the client instead of being masked as a 500.
 *
 * Note: the org plugin calls `APIError.from(status, stringValue)` and better-auth's
 * `from()` drops that string, so `body.message` is often empty — hence the
 * status-keyed fallback messages below.
 */
const API_ERROR_HTTP_STATUS: Readonly<Record<string, number>> = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  GONE: 410,
  UNPROCESSABLE_ENTITY: 422,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
}

const API_ERROR_MESSAGE: Readonly<Record<string, string>> = {
  UNAUTHORIZED: 'You must be signed in to do that.',
  FORBIDDEN: "You don't have permission to do that.",
  BAD_REQUEST: 'That request was not valid.',
  NOT_FOUND: 'That was not found.',
  CONFLICT: 'That conflicted with existing data.',
  TOO_MANY_REQUESTS: 'Too many requests — please try again shortly.',
  INTERNAL_SERVER_ERROR: 'Something went wrong. Please try again.',
}

/**
 * Catch-all for server function errors. Surface better-auth `APIError`s with
 * their real status + message; mask everything else (DB errors, etc.) as a
 * generic 500 so raw stacks/SQL never leak to the client.
 */
export function catchUntagged(e: unknown): never {
  const ctx = getRequestContext()
  const logger = getLogger()

  if (e instanceof APIError) {
    const statusName = typeof e.status === 'string' ? e.status : 'INTERNAL_SERVER_ERROR'
    const httpStatus = API_ERROR_HTTP_STATUS[statusName] ?? 500
    // Narrow body with `in` + typeof rather than an unchecked cast —
    // APIError.body is loosely typed, so guard the read (ts-no-inline-cast-access).
    const rawBody: unknown = e.body
    let bodyMessage = ''
    let code = 'api_error'
    if (rawBody && typeof rawBody === 'object') {
      if ('message' in rawBody && typeof rawBody.message === 'string') {
        bodyMessage = rawBody.message.trim()
      }
      if ('code' in rawBody && typeof rawBody.code === 'string') {
        code = rawBody.code
      }
    }
    const errMessage = typeof e.message === 'string' ? e.message.trim() : ''
    const message =
      bodyMessage ||
      (errMessage && errMessage !== statusName ? errMessage : '') ||
      API_ERROR_MESSAGE[statusName] ||
      statusName

    logger.error(
      {
        requestId: ctx?.requestId,
        errorType: 'APIError',
        status: statusName,
        code,
        message,
      },
      `← THROW APIError(${statusName}) → ${httpStatus}`,
    )

    throw new ServerFunctionError('APIError', message, code, httpStatus)
  }

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
