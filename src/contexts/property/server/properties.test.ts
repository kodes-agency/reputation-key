// Property context — server function tests
// Tests the actual error→status mapping and throwContextError construction used by
// the server functions. Imports the real propertyErrorStatus from the server module
// to ensure tests break when production code changes.
//
// Per architecture: exhaustive ts-pattern matching ensures new error codes
// are caught at compile time.

import { describe, it, expect } from 'vitest'
import { propertyError, isPropertyError } from '#/contexts/property/domain/errors'
import type { PropertyErrorCode } from '#/contexts/property/domain/errors'
import { propertyErrorStatus } from '#/contexts/property/server/properties'
import { throwContextError } from '#/shared/auth/server-errors'
import { createPropertyInputSchema } from '#/contexts/property/application/dto/create-property.dto'
import { updatePropertyInputSchema } from '#/contexts/property/application/dto/update-property.dto'
import { z } from 'zod/v4'

// ── Error → HTTP status mapping (production code) ─────────────────

describe('propertyErrorStatus (imported from server module)', () => {
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

// ── throwContextError (shared server error helper) ─────────────────

describe('throwContextError with PropertyError', () => {
  it('throws an Error with the domain message', () => {
    const e = propertyError('invalid_slug', 'slug must be URL-friendly')
    expect(() =>
      throwContextError('PropertyError', e, propertyErrorStatus(e.code)),
    ).toThrow('slug must be URL-friendly')
  })

  it('sets error.name to PropertyError', () => {
    const e = propertyError('forbidden', 'Insufficient role')
    try {
      throwContextError('PropertyError', e, propertyErrorStatus(e.code))
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('PropertyError')
    }
  })

  it('attaches code and status as custom properties', () => {
    const e = propertyError('slug_taken', 'Slug already exists')
    try {
      throwContextError('PropertyError', e, propertyErrorStatus(e.code))
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.code).toBe('slug_taken')
      expect(error.status).toBe(409)
    }
  })

  it('preserves the correct status for every error code', () => {
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
        throwContextError('PropertyError', e, propertyErrorStatus(e.code))
      } catch (err) {
        const error = err as Error & { code: string; status: number }
        expect(error.status).toBe(expectedStatus)
        expect(error.code).toBe(code)
      }
    }
  })
})

// ── isPropertyError type guard ─────────────────────────────────────

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

// ── Input validation (DTO schemas) ─────────────────────────────────

describe('createProperty input validation', () => {
  it('accepts valid create input', () => {
    const result = createPropertyInputSchema.safeParse({
      name: 'Grand Hotel',
      timezone: 'America/New_York',
    })
    expect(result.success).toBe(true)
  })

  it('accepts create input with all fields', () => {
    const result = createPropertyInputSchema.safeParse({
      name: 'Grand Hotel',
      slug: 'grand-hotel',
      timezone: 'UTC',
      gbpPlaceId: 'ChIJN1t_tDeuEmsRUsoyG83frY4',
    })
    expect(result.success).toBe(true)
  })

  it('rejects create input missing required name', () => {
    const result = createPropertyInputSchema.safeParse({
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects create input missing required timezone', () => {
    const result = createPropertyInputSchema.safeParse({
      name: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('rejects name over 100 characters', () => {
    const result = createPropertyInputSchema.safeParse({
      name: 'a'.repeat(101),
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug under 2 characters', () => {
    const result = createPropertyInputSchema.safeParse({
      name: 'Test',
      slug: 'a',
      timezone: 'UTC',
    })
    expect(result.success).toBe(false)
  })

  it('accepts undefined optional slug (server auto-generates)', () => {
    const result = createPropertyInputSchema.safeParse({
      name: 'Test',
      timezone: 'UTC',
      slug: undefined,
    })
    expect(result.success).toBe(true)
  })
})

describe('updateProperty input validation', () => {
  it('accepts update with propertyId only', () => {
    const result = updatePropertyInputSchema.safeParse({
      propertyId: 'abc-123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts update with all fields', () => {
    const result = updatePropertyInputSchema.safeParse({
      propertyId: 'abc-123',
      name: 'New Name',
      slug: 'new-slug',
      timezone: 'Europe/London',
      gbpPlaceId: 'ChIJ_test',
    })
    expect(result.success).toBe(true)
  })

  it('rejects update without propertyId', () => {
    const result = updatePropertyInputSchema.safeParse({
      name: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('accepts null gbpPlaceId (to clear it)', () => {
    const result = updatePropertyInputSchema.safeParse({
      propertyId: 'abc-123',
      gbpPlaceId: null,
    })
    expect(result.success).toBe(true)
  })
})

describe('deleteProperty input validation', () => {
  const schema = z.object({
    propertyId: z.string().min(1, 'Property ID is required'),
  })

  it('accepts valid input', () => {
    const result = schema.safeParse({ propertyId: 'abc-123' })
    expect(result.success).toBe(true)
  })

  it('rejects missing propertyId', () => {
    const result = schema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty propertyId', () => {
    const result = schema.safeParse({ propertyId: '' })
    expect(result.success).toBe(false)
  })
})
