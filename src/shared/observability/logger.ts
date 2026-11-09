// Logger — structured logging via pino
import { createRequire } from 'node:module'
import pino from 'pino'
import { getEnv } from '#/shared/config/env'
import { getSpanAttrs } from '#/shared/observability/request-context'
import { sanitizeTelemetryValue } from '#/shared/observability/telemetry-sanitize'

export {
  normalizeTelemetryPath,
  sanitizeTelemetryValue,
} from '#/shared/observability/telemetry-sanitize'

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
