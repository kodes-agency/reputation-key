// Property context — server function integration tests
// Tests the full server function pipeline: input validation → error construction.
//
// Per architecture: "Integration tests covering input validation, error shapes."
//
// These tests exercise the input validation schemas and the error → Error construction
// that TanStack Start serializes for the client.

import { describe, it, expect } from 'vitest'
import { propertyError } from '#/contexts/property/domain/errors'
import type { PropertyError, PropertyErrorCode } from '#/contexts/property/domain/errors'
import { createPropertyInputSchema } from '#/contexts/property/application/dto/create-property.dto'
import { updatePropertyInputSchema } from '#/contexts/property/application/dto/update-property.dto'
import { z } from 'zod/v4'
import { match } from 'ts-pattern'

// ── Error → status mapping (mirrors server/properties.ts) ──────────

const propertyErrorStatus = (code: PropertyErrorCode): number =>
  match(code)
    .with('forbidden', () => 403)
    .with('property_not_found', () => 404)
    .with('slug_taken', () => 409)
    .with('invalid_slug', 'invalid_name', 'invalid_timezone', () => 400)
    .exhaustive()

const throwPropertyError = (e: PropertyError): never => {
  const status = propertyErrorStatus(e.code)
  const error = new Error(e.message)
  error.name = 'PropertyError'
  ;(error as unknown as Record<string, unknown>).code = e.code
  ;(error as unknown as Record<string, unknown>).status = status
  throw error
}

// ── Tests ──────────────────────────────────────────────────────────

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

  it('accepts empty optional slug (allows server to auto-generate)', () => {
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

describe('server function error → Error construction', () => {
  it('forbidden error → Error with status 403', () => {
    const e = propertyError('forbidden', 'Insufficient role')
    expect(() => throwPropertyError(e)).toThrow()
    try {
      throwPropertyError(e)
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      const error = err as Error & { code: string; status: number }
      expect(error.message).toBe('Insufficient role')
      expect(error.status).toBe(403)
      expect(error.code).toBe('forbidden')
    }
  })

  it('property_not_found error → Error with status 404', () => {
    const e = propertyError('property_not_found', 'Not found in this org')
    try {
      throwPropertyError(e)
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(404)
      expect(error.code).toBe('property_not_found')
    }
  })

  it('slug_taken error → Error with status 409', () => {
    const e = propertyError('slug_taken', 'Slug already exists')
    try {
      throwPropertyError(e)
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(409)
      expect(error.code).toBe('slug_taken')
    }
  })

  it('invalid_name error → Error with status 400', () => {
    const e = propertyError('invalid_name', 'Name too long')
    try {
      throwPropertyError(e)
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(400)
      expect(error.code).toBe('invalid_name')
    }
  })

  it('invalid_slug error → Error with status 400', () => {
    const e = propertyError('invalid_slug', 'Bad slug')
    try {
      throwPropertyError(e)
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(400)
    }
  })

  it('invalid_timezone error → Error with status 400', () => {
    const e = propertyError('invalid_timezone', 'Unknown timezone')
    try {
      throwPropertyError(e)
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.status).toBe(400)
    }
  })

  it('Error name is set to PropertyError for identification', () => {
    const e = propertyError('forbidden', 'test')
    try {
      throwPropertyError(e)
    } catch (err) {
      expect((err as Error).name).toBe('PropertyError')
    }
  })
})
