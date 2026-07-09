import { describe, it, expect } from 'vitest'
import { assert, assertLiteral, assertNever, UnreachableError } from './assert'
import { isDomainError } from './errors'

describe('assertNever', () => {
  it('throws UnreachableError', () => {
    expect(() => assertNever('test', 'unexpected' as never)).toThrow(UnreachableError)
    expect(() => assertNever('test', 'unexpected' as never)).toThrow(
      'Unreachable: unexpected value in test',
    )
  })
})

describe('assert', () => {
  it('does not throw when the condition is truthy', () => {
    expect(() => assert(true, 'should not fire')).not.toThrow()
    expect(() => assert(1, 'should not fire')).not.toThrow()
    expect(() => assert('s', 'should not fire')).not.toThrow()
  })

  it('is a real Error and a typed DomainError when the condition is falsy', () => {
    let caught: unknown
    try {
      assert(false, 'invariant broken')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(isDomainError(caught)).toBe(true)
    expect((caught as { code: string }).code).toBe('assertion_failed')
  })

  it('includes the message in both .message and .context', () => {
    let caught: unknown
    try {
      assert(false, 'invariant broken')
    } catch (e) {
      caught = e
    }
    const err = caught as { message: string; context?: { message?: string } }
    expect(err.message).toBe('Assertion failed: invariant broken')
    expect(err.context?.message).toBe('invariant broken')
  })

  it('acts as an assertion guard that narrows the type', () => {
    const x: string | null = 'present'
    assert(x !== null, 'x must be present')
    // Without narrowing this would be a type error.
    expect(x.length).toBe(7)
  })
})

describe('assertLiteral', () => {
  const STATUSES = ['active', 'completed', 'cancelled'] as const

  it('returns the value when it belongs to the valid set', () => {
    expect(assertLiteral('active', STATUSES, 'status')).toBe('active')
    expect(assertLiteral('completed', STATUSES, 'status')).toBe('completed')
  })

  it('throws a typed DomainError carrying value/label/valid context for an invalid value', () => {
    let caught: unknown
    try {
      assertLiteral('paused', STATUSES, 'status')
    } catch (e) {
      caught = e
    }
    expect(caught).toBeInstanceOf(Error)
    expect(isDomainError(caught)).toBe(true)
    const err = caught as {
      code: string
      message: string
      context?: Record<string, unknown>
    }
    expect(err.code).toBe('invalid_literal')
    expect(err.message).toBe('Invalid status: paused')
    expect(err.context?.value).toBe('paused')
    expect(err.context?.label).toBe('status')
    expect(err.context?.valid).toEqual([...STATUSES])
  })
})
