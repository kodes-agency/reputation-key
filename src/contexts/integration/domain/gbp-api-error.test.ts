// Integration context — GBP API error tests

import { describe, it, expect } from 'vitest'
import { createGbpApiError } from './gbp-api-error'

describe('createGbpApiError', () => {
  it('creates an Error instance', () => {
    const err = createGbpApiError('fetchAccounts', 403, 'Forbidden')
    expect(err).toBeInstanceOf(Error)
  })

  it('sets _tag to "GbpApiError"', () => {
    const err = createGbpApiError('fetchAccounts', 403, 'Forbidden')
    expect(err._tag).toBe('GbpApiError')
  })

  it('sets operation, status, and body', () => {
    const err = createGbpApiError('fetchAccounts', 429, 'Rate limited')
    expect(err.operation).toBe('fetchAccounts')
    expect(err.status).toBe(429)
    expect(err.body).toBe('Rate limited')
  })

  it('formats message as "GBP API {operation} failed: {status} {body}"', () => {
    const err = createGbpApiError('fetchAccounts', 403, 'Forbidden')
    expect(err.message).toBe('GBP API fetchAccounts failed: 403 Forbidden')
  })

  it('includes a stack trace', () => {
    const err = createGbpApiError('fetchAccounts', 500, 'Internal')
    expect(err.stack).toBeDefined()
    expect(typeof err.stack).toBe('string')
  })

  it('handles 500 status', () => {
    const err = createGbpApiError('updateLocation', 500, 'Internal Server Error')
    expect(err.status).toBe(500)
    expect(err.message).toBe('GBP API updateLocation failed: 500 Internal Server Error')
  })

  it('handles empty body', () => {
    const err = createGbpApiError('fetchReviews', 200, '')
    expect(err.body).toBe('')
    expect(err.message).toBe('GBP API fetchReviews failed: 200 ')
  })

  it('exposes properties as enumerable', () => {
    const err = createGbpApiError('fetchAccounts', 403, 'Forbidden')
    const keys = Object.keys(err)
    expect(keys).toContain('_tag')
    expect(keys).toContain('operation')
    expect(keys).toContain('status')
    expect(keys).toContain('body')
  })
})
