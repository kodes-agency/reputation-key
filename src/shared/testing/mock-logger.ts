import type { Logger } from 'pino'

/**
 * Creates a mock Logger suitable for use in tests.
 * All methods are no-op functions.
 */
export function createMockLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
    trace: () => {},
    silent: () => {},
    level: 'silent',
    msgPrefix: undefined,
  } as unknown as Logger
}
