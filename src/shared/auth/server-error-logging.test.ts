import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { getLogger } from '#/shared/observability/logger'
import {
  FAILED_WRITE_CONSTRAINT,
  failedFeedbackWrite,
} from '#/shared/db/testing/database-failure-fixtures'
import { APIError } from 'better-auth'
import { runWithContext } from '#/shared/observability/request-context'
import { ServerFunctionError } from './server-function-error'
import { catchUntagged, throwContextError } from './server-errors'

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

describe('the log line for an error nothing tagged', () => {
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

function surface(action: () => never): ServerFunctionError {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(ServerFunctionError)
    return error as ServerFunctionError
  }
  throw new Error('Expected a server function error')
}

describe('server error log safety', () => {
  it('keeps domain messages and context out of logs while preserving the client error', async () => {
    const marker = 'private bound customer value'
    const original = Object.assign(new Error(marker), {
      code: 'revision_conflict',
      context: { detail: marker, revisions: [1, 2] },
    })
    await runWithContext('request-safe-1', async () => {
      const thrown = surface(() => throwContextError('ReplyError', original, 409))
      expect(thrown).toMatchObject({
        name: 'ReplyError',
        message: marker,
        code: 'revision_conflict',
        status: 409,
        cause: original,
      })
    })

    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(marker)
    expect(JSON.parse(lines[0]!)).toMatchObject({
      requestId: 'request-safe-1',
      errorType: 'ReplyError',
      code: 'revision_conflict',
      status: 409,
    })
    expect(JSON.parse(lines[0]!)).not.toHaveProperty('context')
  })

  it('keeps APIError wording out of logs while preserving its client message and cause', () => {
    const marker = 'private bound customer value'
    const original = APIError.fromStatus('FORBIDDEN', { message: marker, code: 'denied' })
    const thrown = surface(() => catchUntagged(original))

    expect(thrown).toMatchObject({
      message: marker,
      code: 'denied',
      status: 403,
      cause: original,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(marker)
    expect(JSON.parse(lines[0]!)).toMatchObject({ errorType: 'APIError', code: 'denied' })
  })

  it('preserves the masked client error and safe database facts for an untagged failure', () => {
    const marker = 'private bound customer value'
    const original = failedFeedbackWrite(marker)
    const thrown = surface(() => catchUntagged(original))

    expect(thrown).toMatchObject({
      message: 'Internal server error',
      code: 'internal_error',
      status: 500,
      cause: original,
    })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(marker)
    expect(JSON.parse(lines[0]!)).toMatchObject({
      error: { name: 'DrizzleQueryError', db_code: '23505', db_table: 'feedback' },
    })
  })

  it('rejects unsafe error names and codes in logs without changing the client contract', () => {
    const marker = 'private bound customer value'
    const thrown = surface(() =>
      throwContextError(marker, { code: marker, message: marker }, 400),
    )

    expect(thrown).toMatchObject({ name: marker, code: marker, message: marker })
    expect(lines).toHaveLength(1)
    expect(lines[0]).not.toContain(marker)
  })
})
