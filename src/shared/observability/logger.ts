// Logger — structured logging via pino
import pino from 'pino'
import { getEnv } from '#/shared/config/env'
import { getSpanAttrs } from '#/shared/observability/request-context'

let _logger: pino.Logger | undefined

/** Check if pino-pretty is resolvable without throwing. */
function isPrettyTransportAvailable(): boolean {
  try {
    require.resolve('pino-pretty')
    return true
  } catch {
    return false
  }
}

export function getLogger(): pino.Logger {
  if (!_logger) {
    const env = getEnv()
    const usePretty = env.NODE_ENV === 'development' && isPrettyTransportAvailable()
    _logger = pino({
      level: env.LOG_LEVEL,
      // Mixin merges request-scoped span attrs (organizationId/userId/role/
      // useCase/resource) into every log line — including child loggers.
      // Read dynamically from ALS at log-call time, so attrs enriched after
      // logger creation (e.g. after resolveTenantContext) still appear.
      mixin: () => getSpanAttrs(),
      ...(usePretty
        ? {
            transport: {
              target: 'pino-pretty',
              options: { colorize: true },
            },
          }
        : {}),
    })
  }
  return _logger
}
