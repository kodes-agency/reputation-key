import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getLogger } from '#/shared/observability/logger'
import {
  FAILED_WRITE_CONSTRAINT,
  failedFeedbackWrite,
} from '#/shared/db/testing/database-failure-fixtures'
import { catchUntagged } from './server-errors'

const PRIVATE_TEXT = 'a guest wrote their phone number here'

/** Every line pino writes, as the process would write it. */
const lines: string[] = []

function thrownBy(run: () => never): unknown {
  try {
    run()
  } catch (error) {
    return error
  }
  return undefined
}

describe('the log line for an error nothing tagged', () => {
  beforeAll(() => {
    // The logger keeps the destination it was first built with.
    getLogger({
      write: (line: string) => {
        lines.push(line)
      },
    })
  })
  beforeEach(() => {
    lines.length = 0
  })

  it('says what kind of failure a query was and holds none of the values it was bound to', () => {
    const failure = failedFeedbackWrite(PRIVATE_TEXT)

    expect(() => catchUntagged(failure)).toThrow('Internal server error')

    expect(lines).toHaveLength(1)
    const [line = ''] = lines
    expect(JSON.parse(line)).toMatchObject({
      errorType: 'UntaggedError',
      error: {
        name: 'DrizzleQueryError',
        db_code: '23505',
        db_constraint: FAILED_WRITE_CONSTRAINT,
        db_table: 'feedback',
      },
    })
    expect(JSON.parse(line)).not.toHaveProperty('stack')
    for (const leaked of [PRIVATE_TEXT, 'insert into', 'Failed query', 'duplicate key']) {
      expect(line).not.toContain(leaked)
    }
  })

  it('still hands the original error to monitoring as the cause', () => {
    const failure = failedFeedbackWrite(PRIVATE_TEXT)

    expect(thrownBy(() => catchUntagged(failure))).toMatchObject({ cause: failure })
  })

  it('logs something thrown that is not an error as an unknown error, never as text', () => {
    expect(() => catchUntagged(PRIVATE_TEXT)).toThrow('Internal server error')

    const [line = ''] = lines
    expect(JSON.parse(line)).toMatchObject({ error: { name: 'UnknownError' } })
    expect(line).not.toContain(PRIVATE_TEXT)
  })
})
