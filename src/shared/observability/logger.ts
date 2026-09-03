// Logger — structured logging via pino
import { createRequire } from 'node:module'
import pino from 'pino'
import { getEnv } from '#/shared/config/env'
import { getSpanAttrs } from '#/shared/observability/request-context'
import { isSensitiveObservabilityField } from '#/shared/observability/sensitive-field-policy'

const REDACTED = '[Redacted]'

function safeError(error: Error): Readonly<Record<string, unknown>> {
  const code =
    'code' in error && (typeof error.code === 'string' || typeof error.code === 'number')
      ? error.code
      : undefined
  return {
    name: error.name,
    ...(code === undefined ? {} : { code }),
  }
}

/**
 * Copies telemetry data while removing credential, OAuth, provider-resource,
 * request-body, URL/query, referrer, and session material at any nesting
 * depth. It intentionally matches field names rather than value substrings so
 * harmless code-only fields remain observable.
 */
export function sanitizeTelemetryValue(
  value: unknown,
  seen = new WeakMap<object, unknown>(),
): unknown {
  if (value instanceof Error) return safeError(value)
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
      copy[key] = isSensitiveObservabilityField(key)
        ? REDACTED
        : sanitizeTelemetryValue(entry, seen)
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
        hooks: {
          logMethod(args, method) {
            method.apply(this, sanitizeLogArgs(args) as Parameters<typeof method>)
          },
        },
        // Mixin merges request-scoped span attrs (role/useCase — content-free,
        // loggers. Read dynamically from ALS at log-call time, so attrs
        // enriched after logger creation (e.g. after resolveTenantContext)
        // still appear.
        mixin: () => getSpanAttrs(),
        ...(usePretty
          ? {
              transport: {
                target: 'pino-pretty',
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
