import type { LoggerPort } from '#/shared/domain/logger.port'

/**
 * Creates a mock LoggerPort suitable for use in tests.
 * All methods are no-op functions.
 */
export function createMockLogger(): LoggerPort {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    child: () => createMockLogger(),
  }
}
