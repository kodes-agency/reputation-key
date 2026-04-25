// Property context — domain errors tests
// Per architecture: 100% coverage on errors.

import { describe, it, expect } from 'vitest'
import { propertyError, isPropertyError } from './errors'

describe('propertyError', () => {
  it('creates a tagged error with _tag, code, and message', () => {
    const err = propertyError('invalid_slug', 'bad slug')
    expect(err._tag).toBe('PropertyError')
    expect(err.code).toBe('invalid_slug')
    expect(err.message).toBe('bad slug')
  })

  it('includes context when provided', () => {
    const err = propertyError('slug_taken', 'taken', { slug: 'test' })
    expect(err.context).toEqual({ slug: 'test' })
  })

  it('omits context when not provided', () => {
    const err = propertyError('forbidden', 'nope')
    expect(err.context).toBeUndefined()
  })

  it('every error code produces a valid error', () => {
    const codes = [
      'forbidden',
      'invalid_slug',
      'invalid_name',
      'invalid_timezone',
      'slug_taken',
      'property_not_found',
    ] as const
    for (const code of codes) {
      const err = propertyError(code, `test ${code}`)
      expect(err._tag).toBe('PropertyError')
      expect(err.code).toBe(code)
    }
  })
})

describe('isPropertyError', () => {
  it('returns true for PropertyError', () => {
    const err = propertyError('forbidden', 'nope')
    expect(isPropertyError(err)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isPropertyError(new Error('nope'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isPropertyError(null)).toBe(false)
  })

  it('returns false for plain object', () => {
    expect(isPropertyError({ _tag: 'OtherError' })).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isPropertyError(undefined)).toBe(false)
  })
})
