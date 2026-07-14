// Tests for error redaction (B0.7).

import { describe, it, expect } from 'vitest'
import { redactError } from './error-redaction'

describe('redactError', () => {
  it('returns generic message for unknown errors', () => {
    const result = redactError(new Error('postgres://user:pass@host:5432/db'))
    expect(result.code).toBe('internal_error')
    expect(result.message).not.toContain('postgres://')
    expect(result.message).not.toContain('pass')
  })

  it('returns generic message for plain objects', () => {
    const result = redactError({ foo: 'bar' })
    expect(result.code).toBe('internal_error')
  })

  it('preserves code for tagged domain errors', () => {
    const error = {
      _tag: 'IntegrationError',
      code: 'connection_not_found',
      message: 'Not found',
    }
    const result = redactError(error)
    expect(result.code).toBe('connection_not_found')
    expect(result.message).toBe('Not found')
  })

  it('redacts emails from tagged error messages', () => {
    const error = {
      _tag: 'AuthError',
      code: 'forbidden',
      message: 'User admin@example.com not allowed',
    }
    const result = redactError(error)
    expect(result.message).not.toContain('admin@example.com')
    expect(result.message).toContain('[redacted-email]')
  })

  it('redacts URLs with credentials', () => {
    const error = {
      _tag: 'ServerError',
      code: 'db_error',
      message: 'Failed to connect to postgres://user:secret@dbhost:5432/prod',
    }
    const result = redactError(error)
    expect(result.message).not.toContain('secret')
    expect(result.message).not.toContain('dbhost')
    expect(result.message).toContain('[redacted-url]')
  })

  it('redacts bearer tokens', () => {
    const error = {
      _tag: 'AuthError',
      code: 'invalid_token',
      message: 'Bearer abc123xyz expired',
    }
    const result = redactError(error)
    expect(result.message).not.toContain('abc123xyz')
  })

  it('redacts UUIDs', () => {
    const error = {
      _tag: 'ServerError',
      code: 'not_found',
      message: 'Resource 550e8400-e29b-41d4-a716-446655440000 not found',
    }
    const result = redactError(error)
    expect(result.message).not.toContain('550e8400-e29b-41d4-a716-446655440000')
    expect(result.message).toContain('[redacted-id]')
  })

  it('returns fallback message for empty tagged error', () => {
    const error = { _tag: 'DomainError', code: 'validation_error', message: '' }
    const result = redactError(error)
    expect(result.code).toBe('validation_error')
    expect(result.message).toBe('Request could not be completed.')
  })

  it('does not expose stack traces', () => {
    const error = new Error('Something broke')
    error.stack = 'Error: Something broke\n    at some/file.ts:42:5'
    const result = redactError(error)
    expect(result.message).not.toContain('stack')
    expect(result.message).not.toContain('file.ts')
  })
})
