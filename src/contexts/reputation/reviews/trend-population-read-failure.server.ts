import type { LoggerPort } from '#/shared/domain/logger.port'

export const TREND_POPULATION_READ_FAILED = 'review_trend_population_read_failed'

const LOG_MESSAGE = 'The Property trend population could not be read'
/** An error sits at most this deep under the one thrown: drizzle wraps the driver's. */
const MAX_CAUSE_DEPTH = 3
const MAX_NAME_LENGTH = 64
/** A SQLSTATE (`25000`) or a system error code (`ECONNRESET`), never a sentence. */
const CODE_SHAPE = /^[A-Za-z0-9_.:-]{1,64}$/u

/**
 * The first code in the cause chain: the SQLSTATE of the server's refusal, which
 * drizzle keeps on the driver error beneath its own.
 */
function codeOf(error: unknown): string | number | undefined {
  let current = error
  for (
    let depth = 0;
    depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null;
    depth += 1
  ) {
    const { code, cause } = current as { code?: unknown; cause?: unknown }
    if (typeof code === 'number' && Number.isSafeInteger(code)) return code
    if (typeof code === 'string' && CODE_SHAPE.test(code)) return code
    current = cause
  }
  return undefined
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, MAX_NAME_LENGTH) : typeof error
}

/**
 * Says why the trend population read failed, without saying what it read.
 *
 * The read answers `policy_unavailable` for any database error, because its
 * callers retry and the insights reader shows "preparing"; that answer names no
 * cause. This warning does: the error's name and its SQLSTATE and nothing else.
 * Not the message or the statement, which hold the Organization, the Property and
 * the timezone, and not the stack.
 */
export function logTrendPopulationReadFailure(
  logger: Pick<LoggerPort, 'warn'> | undefined,
  error: unknown,
): void {
  const errorCode = codeOf(error)
  logger?.warn(
    {
      event: TREND_POPULATION_READ_FAILED,
      errorName: nameOf(error),
      ...(errorCode === undefined ? {} : { errorCode }),
    },
    LOG_MESSAGE,
  )
}
