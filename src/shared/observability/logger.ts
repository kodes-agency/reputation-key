// Logger — structured logging via pino
import pino from 'pino'
import { getEnv } from '#/shared/config/env'

let _logger: pino.Logger | undefined

export function getLogger(): pino.Logger {
  if (!_logger) {
    const env = getEnv()
    _logger = pino({
      level: env.LOG_LEVEL,
      ...(env.NODE_ENV === 'development'
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
