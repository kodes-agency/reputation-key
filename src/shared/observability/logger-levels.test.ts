import { describe, expect, it } from 'vitest'
import { getLogger } from './logger'

describe('log level labels', () => {
  // Railway indexes a JSON line's level only when it is a string label; pino's
  // default numeric levels ({"level":50}) fell back to the stdout default, so
  // every error — "← THROW InternalError → 500", "[alert] … firing" — was
  // shown as INFO and a @level:error filter found none of them.
  it('writes the level as its label so the log platform can filter errors', () => {
    const lines: Record<string, unknown>[] = []
    const logger = getLogger({
      write: (line: string) => {
        lines.push(JSON.parse(line) as Record<string, unknown>)
      },
    })

    logger.error({ errorType: 'UntaggedError' }, '← THROW InternalError → 500')
    logger.warn('Digest entry retired as stale')
    logger.info('REQ ok')

    expect(lines.map((line) => line.level)).toEqual(['error', 'warn', 'info'])
  })
})
