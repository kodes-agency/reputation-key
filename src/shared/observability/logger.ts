// Logger — structured logging via pino
import pino from 'pino'
import { getEnv } from '#/shared/config/env'

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
