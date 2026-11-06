// Logger — structured logging via pino
import { createRequire } from 'node:module'
import pino from 'pino'
import { getEnv } from '#/shared/config/env'
import { getSpanAttrs } from '#/shared/observability/request-context'
import { isSensitiveObservabilityField } from '#/shared/observability/sensitive-field-policy'
import { summarizeError } from './error-summary'

const REDACTED = '[Redacted]'

/**
 * What a flattened error leaves behind: its stack opens with the message, and
 * a Drizzle query error carries the values it was bound to as `params`.
 */
const ERROR_CONTENT_FIELDS: ReadonlySet<string> = new Set([
  'message',
  'errormessage',
  'failurereason',
  'stack',
  'params',
])

function sanitizeErrorField(value: unknown, seen: WeakMap<object, unknown>): unknown {
  if (value instanceof Error) return summarizeError(value)
  if (value && typeof value === 'object' && 'message' in value) {
    const status = 'status' in value ? value.status : undefined
    return {
      ...summarizeError(value),
      ...(typeof status === 'number' &&
      Number.isInteger(status) &&
      status >= 100 &&
      status <= 599
        ? { status }
        : {}),
    }
  }
  return typeof value === 'string' ? REDACTED : sanitizeTelemetryValue(value, seen)
}

function sanitizeTelemetryField(
  key: string,
  value: unknown,
  seen: WeakMap<object, unknown>,
): unknown {
  const field = key.toLowerCase().replaceAll(/[^a-z0-9]/gu, '')
  if (isSensitiveObservabilityField(key) || ERROR_CONTENT_FIELDS.has(field)) {
    return REDACTED
  }
  if (field === 'error' || field === 'err') return sanitizeErrorField(value, seen)
  return sanitizeTelemetryValue(value, seen)
}

/**
 * Copies telemetry data while removing credential, OAuth, provider-resource,
 * request-body, URL/query, referrer, and session material at any nesting
 * depth. It intentionally matches field names rather than value substrings so
 * harmless code-only fields remain observable. An error becomes its allowlisted
 * summary (error-summary.ts), never its message or stack.
 */
export function sanitizeTelemetryValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value instanceof Error) return summarizeError(value)
  if (Array.isArray(value)) {
    const existing = seen.get(value)
    if (existing) return existing
    const copy: unknown[] = []
    seen.set(value, copy)
    for (const item of value) copy.push(sanitizeTelemetryValue(item, seen))
    return copy
  }
  if (value && typeof value === 'object') {
    const existing = seen.get(value)
    if (existing) return existing
    const copy: Record<string, unknown> = {}
    seen.set(value, copy)
    for (const [key, entry] of Object.entries(value)) {
      copy[key] = sanitizeTelemetryField(key, entry, seen)
    }
    return copy
  }
  return value
}

export function normalizeTelemetryPath(value: string): string {
  try {
    return new URL(value, 'https://telemetry.invalid').pathname
  } catch {
    return value.split(/[?#]/u, 1)[0] || '/'
  }
}

function sanitizeLogArgs(args: unknown[]): unknown[] {
  return args.map((arg) =>
    arg && typeof arg === 'object' ? sanitizeTelemetryValue(arg) : arg,
  )
}

let _logger: pino.Logger | undefined
const resolveFromLoggerModule = createRequire(import.meta.url).resolve

/** Check if pino-pretty is resolvable from this ESM module without throwing. */
export function isPrettyTransportAvailable(
  resolveModule: (specifier: string) => string = resolveFromLoggerModule,
): boolean {
  try {
    resolveModule('pino-pretty')
    return true
  } catch {
    return false
  }
}

export function getLogger(destination?: pino.DestinationStream): pino.Logger {
  if (!_logger) {
    const env = getEnv()
    const usePretty =
      destination === undefined &&
      env.NODE_ENV === 'development' &&
      isPrettyTransportAvailable()
    _logger = pino(
      {
        level: env.LOG_LEVEL,
        // The label, not pino's number: Railway reads a JSON line's level only
        // as a string and files {"level":50} under the stdout default, INFO —
        // so no error or warning was findable by level.
        formatters: { level: (label) => ({ level: label }) },
        hooks: {
          logMethod(args, method) {
            method.apply(this, sanitizeLogArgs(args) as Parameters<typeof method>)
          },
        },
        // Mixin merges request-scoped span attrs (role/useCase — content-free,
        // loggers. Read dynamically from ALS at log-call time, so attrs
        // enriched after logger creation (e.g. after resolveTenantContext)
        // still appear. A copy: pino merges each call's fields into the object
        // the mixin returns, so the live attrs would carry them into every
        // later line of the same request or job.
        mixin: () => ({ ...getSpanAttrs() }),
        // The resolved path, not the bare name: pino resolves a bare target
        // from its callers' stack files, and under the Vite dev module runner
        // those are `eval` frames when the first logger is created inside a
        // request handler — every request then fails with "unable to
        // determine transport target".
        ...(usePretty
          ? {
              transport: {
                target: resolveFromLoggerModule('pino-pretty'),
                options: { colorize: true },
              },
            }
          : {}),
      },
      destination,
    )
  }
  return _logger
}
