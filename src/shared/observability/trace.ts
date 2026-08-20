// Trace — creates nested spans for request tracing.
// Each span logs timing on success or full error context on failure.
// Reads parent context from ALS — no parameter threading needed.

import {
  getLogger,
  normalizeTelemetryPath,
  sanitizeTelemetryValue,
} from '#/shared/observability/logger'
import { getRequestContext } from '#/shared/observability/request-context'

export interface Span {
  readonly name: string
  readonly requestId?: string
  readonly startedAt: number
}

function createSpan(name: string): Span {
  const ctx = getRequestContext()
  return {
    name,
    requestId: ctx?.requestId,
    startedAt: performance.now(),
  }
}

function endSpan(span: Span, error?: unknown): void {
  const logger = getLogger()
  const duration = Math.round(performance.now() - span.startedAt)

  if (error) {
    logger.error(
      {
        span: span.name,
        requestId: span.requestId,
        duration,
        error: sanitizeTelemetryValue(error),
      },
      `Span ${span.name} failed after ${duration}ms`,
    )
  } else {
    logger.debug(
      { span: span.name, requestId: span.requestId, duration },
      `✓ ${span.name} ${duration}ms`,
    )
  }
}

/**
 * Run `fn` inside a traced span. Logs timing on success, full error on failure.
 * Reads request context from ALS automatically.
 */
export async function trace<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const span = createSpan(name)
  try {
    const result = await fn()
    endSpan(span)
    return result
  } catch (e) {
    endSpan(span, e)
    throw e
  }
}

/**
 * Start a root request span. Returns an end function to call when the request completes.
 * Used by createTracedServerFn and tracedLoader.
 */
export function startRequestSpan(
  requestId: string,
  method: string,
  path: string,
): { end: (error?: unknown) => void } {
  const safePath = normalizeTelemetryPath(path)
  const startedAt = performance.now()
  const logger = getLogger()

  logger.debug(
    { requestId, method, path: safePath },
    `REQ ${requestId} ${method} ${safePath}`,
  )

  return {
    end: (error?: unknown) => {
      const duration = Math.round(performance.now() - startedAt)
      if (error) {
        logger.error(
          {
            requestId,
            method,
            path: safePath,
            duration,
            error: sanitizeTelemetryValue(error),
          },
          `REQ ${requestId} ${method} ${safePath} — FAILED ${duration}ms`,
        )
      } else {
        logger.debug(
          { requestId, method, path: safePath, duration },
          `REQ ${requestId} ${method} ${safePath} — ${duration}ms`,
        )
      }
    },
  }
}
