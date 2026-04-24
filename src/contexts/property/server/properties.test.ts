// Property context — server function error translation tests
// Verifies the error → status mapping and the Error construction used in server functions.
// Per architecture: exhaustive ts-pattern matching ensures new error codes
// are caught at compile time.

import { describe, it, expect } from 'vitest'
import { propertyError, isPropertyError } from '#/contexts/property/domain/errors'
import type { PropertyError, PropertyErrorCode } from '#/contexts/property/domain/errors'
import { match } from 'ts-pattern'
import { z } from 'zod/v4'

// ── Error → status mapping (mirrors server/properties.ts) ──────────

const propertyErrorStatus = (code: PropertyErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('property_not_found', () => 404)
    .with('slug_taken', () => 409)
    .with('invalid_slug', 'invalid_name', 'invalid_timezone', () => 400)
    .exhaustive()

// ── Error construction (mirrors server/properties.ts) ──────────────

const throwPropertyError = (e: PropertyError): never => {
  const status = propertyErrorStatus(e.code)
  const error = new Error(e.message)
  error.name = 'PropertyError'
  ;(error as unknown as Record<string, unknown>).code = e.code
  ;(error as unknown as Record<string, unknown>).status = status
  throw error
}

// ── Tests ──────────────────────────────────────────────────────────

describe('propertyErrorStatus (error code → HTTP status mapping)', () => {
  it('maps forbidden → 403', () => {
    expect(propertyErrorStatus('forbidden')).toBe(403)
  })

  it('maps property_not_found → 404', () => {
    expect(propertyErrorStatus('property_not_found')).toBe(404)
  })

  it('maps slug_taken → 409', () => {
    expect(propertyErrorStatus('slug_taken')).toBe(409)
  })

  it('maps invalid_slug → 400', () => {
    expect(propertyErrorStatus('invalid_slug')).toBe(400)
  })

  it('maps invalid_name → 400', () => {
    expect(propertyErrorStatus('invalid_name')).toBe(400)
  })

  it('maps invalid_timezone → 400', () => {
    expect(propertyErrorStatus('invalid_timezone')).toBe(400)
  })

  it('all error codes are covered (exhaustive check)', () => {
    const codes: PropertyErrorCode[] = [
      'forbidden',
      'property_not_found',
      'slug_taken',
      'invalid_slug',
      'invalid_name',
      'invalid_timezone',
    ]
    for (const code of codes) {
      const status = propertyErrorStatus(code)
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(500)
    }
  })
})

describe('throwPropertyError (Error construction for TanStack Start)', () => {
  it('throws an Error with the domain message', () => {
    const e = propertyError('invalid_slug', 'slug must be URL-friendly')
    expect(() => throwPropertyError(e)).toThrow('slug must be URL-friendly')
  })

  it('sets error.name to PropertyError', () => {
    const e = propertyError('forbidden', 'Insufficient role')
    try {
      throwPropertyError(e)
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('PropertyError')
    }
  })

  it('attaches code and status as custom properties', () => {
    const e = propertyError('slug_taken', 'Slug already exists')
    try {
      throwPropertyError(e)
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.code).toBe('slug_taken')
      expect(error.status).toBe(409)
    }
  })

  it('preserves the correct status for each error code', () => {
    const cases: Array<[PropertyErrorCode, number]> = [
      ['forbidden', 403],
      ['property_not_found', 404],
      ['slug_taken', 409],
      ['invalid_slug', 400],
      ['invalid_name', 400],
      ['invalid_timezone', 400],
    ]
    for (const [code, expectedStatus] of cases) {
      const e = propertyError(code, `test ${code}`)
      try {
        throwPropertyError(e)
      } catch (err) {
        const error = err as Error & { code: string; status: number }
        expect(error.status).toBe(expectedStatus)
        expect(error.code).toBe(code)
      }
    }
  })
})

describe('isPropertyError type guard', () => {
  it('returns true for PropertyError', () => {
    const error = propertyError('forbidden', 'test')
    expect(isPropertyError(error)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isPropertyError(new Error('boom'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isPropertyError(null)).toBe(false)
  })

  it('returns false for plain object', () => {
    expect(isPropertyError({ code: 'forbidden', message: 'test' })).toBe(false)
  })
})

describe('propertyIdSchema validator', () => {
  const schema = z.object({
    propertyId: z.string().min(1, 'Property ID is required'),
  })

  it('accepts valid input', () => {
    const result = schema.safeParse({ propertyId: 'abc-123' })
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.propertyId).toBe('abc-123')
  })

  it('rejects missing propertyId', () => {
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty propertyId', () => {
    const result = schema.safeParse({ propertyId: '' })
    expect(result.success).toBe(false)
  })

  it('rejects non-string propertyId', () => {
    const result = schema.safeParse({ propertyId: 42 })
    expect(result.success).toBe(false)
  })

  it('rejects null', () => {
    const result = schema.safeParse(null)
    expect(result.success).toBe(false)
  })
})
