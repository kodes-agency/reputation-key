import { describe, expect, it } from 'vitest'
import { sqlStateOf, unclassifiedFailureCause } from './failure-cause'

describe('sqlStateOf', () => {
  it('reads the SQLSTATE of a refusal the query error wraps', () => {
    const refusal = Object.assign(new Error('connection lost'), { code: '08006' })
    const wrapped = new Error('Failed query', { cause: refusal })

    expect(sqlStateOf(wrapped)).toBe('08006')
  })

  it('reads the SQLSTATE of the error itself', () => {
    expect(sqlStateOf(Object.assign(new Error('check'), { code: '23514' }))).toBe('23514')
  })

  it('ignores a code that is not a SQLSTATE', () => {
    const notSqlState = Object.assign(new Error('nope'), { code: 'ECONNRESET' })

    expect(sqlStateOf(notSqlState)).toBeNull()
  })

  it('answers nothing for a value that is not an error object', () => {
    expect(sqlStateOf('23514')).toBeNull()
    expect(sqlStateOf(null)).toBeNull()
  })
})

describe('unclassifiedFailureCause', () => {
  it('names a database refusal by its SQLSTATE, never its message', () => {
    const refusal = Object.assign(new Error('relation "secret_tenant" is gone'), {
      code: '42P01',
    })

    expect(unclassifiedFailureCause(new Error('Failed query', { cause: refusal }))).toBe(
      'sqlstate_42P01',
    )
  })

  it('names any other error by its class', () => {
    expect(unclassifiedFailureCause(new TypeError('x is undefined'))).toBe('TypeError')
  })

  it('answers unknown for a thrown value that is not an error', () => {
    expect(unclassifiedFailureCause('boom')).toBe('unknown')
  })
})
