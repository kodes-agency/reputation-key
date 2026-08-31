// shared/domain/errors — DomainError factory + predicate tests.
// Covers the ADR 0005 hybrid pattern: a real Error (instanceof + stack) carrying
// the tagged DomainError shape, discriminated via isDomainError.

import { describe, it, expect } from 'vitest'
import {
  createErrorFactory,
  createTaggedError,
  domainError,
  isDomainError,
} from './errors'

describe('domainError', () => {
  it('returns a real Error so `instanceof Error` holds', () => {
    const err = domainError('unknown_role', 'boom')
    expect(err).toBeInstanceOf(Error)
  })

  it('carries the tagged DomainError shape', () => {
    const err = domainError('unknown_role', 'boom')
    expect(err._tag).toBe('DomainError')
    expect(err.code).toBe('unknown_role')
    expect(err.message).toBe('boom')
    expect(err.name).toBe('DomainError')
  })

  it('captures a stack trace', () => {
    const err = domainError('assertion_failed', 'boom')
    expect(typeof err.stack).toBe('string')
    expect(err.stack).toContain('errors.test.ts')
  })

  it('attaches context when provided', () => {
    const err = domainError('unknown_role', 'boom', { value: 'owner-x' })
    expect(err.context).toEqual({ value: 'owner-x' })
  })

  it('omits context when not provided', () => {
    const err = domainError('unknown_role', 'boom')
    expect(err.context).toBeUndefined()
    expect('context' in err).toBe(false)
  })

  it('is recognised by isDomainError', () => {
    const err = domainError('assertion_failed', 'boom')
    expect(isDomainError(err)).toBe(true)
  })

  it('still builds a tagged error when Error.captureStackTrace is unavailable', () => {
    // Non-V8 hosts lack Error.captureStackTrace — the guard must skip, not throw.
    const original = Object.getOwnPropertyDescriptor(Error, 'captureStackTrace')
    delete (Error as { captureStackTrace?: unknown }).captureStackTrace
    try {
      const err = domainError('unknown_role', 'boom')
      expect(err).toBeInstanceOf(Error)
      expect(err._tag).toBe('DomainError')
      expect(err.code).toBe('unknown_role')
    } finally {
      if (original) Object.defineProperty(Error, 'captureStackTrace', original)
    }
  })
})

describe('isDomainError', () => {
  it('returns false for a plain Error', () => {
    expect(isDomainError(new Error('nope'))).toBe(false)
  })

  it('returns false for a tagged error with a different _tag', () => {
    const otherTagged = createErrorFactory('OtherError')('x', 'msg')
    expect(isDomainError(otherTagged)).toBe(false)
  })

  it('returns false for null, undefined, and primitives', () => {
    expect(isDomainError(null)).toBe(false)
    expect(isDomainError(undefined)).toBe(false)
    expect(isDomainError('DomainError')).toBe(false)
    expect(isDomainError(42)).toBe(false)
  })

  it('returns false for an object missing _tag', () => {
    expect(isDomainError({ code: 'x', message: 'y' })).toBe(false)
  })
})

describe('createErrorFactory', () => {
  it('builds real errors with enumerable tagged identity', () => {
    const makeError = createErrorFactory<'ExampleError', 'invalid'>('ExampleError')
    const error = makeError('invalid', 'Invalid example', { field: 'name' })

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('ExampleError')
    expect(error.stack).toContain('errors.test.ts')
    expect(Object.keys(error)).toEqual(['name', '_tag', 'code', 'context'])
    expect(error).toMatchObject({
      _tag: 'ExampleError',
      code: 'invalid',
      message: 'Invalid example',
      context: { field: 'name' },
    })
  })

  it('omits absent context instead of serializing an undefined field', () => {
    const error = createErrorFactory('ExampleError')('invalid', 'Invalid example')

    expect('context' in error).toBe(false)
  })

  it('rejects extras that could replace the error identity', () => {
    expect(() =>
      createTaggedError('ExampleError', 'invalid', 'Invalid example', undefined, {
        code: 'overridden',
      }),
    ).toThrowError('Tagged error extra cannot override reserved field: code')
  })
})
