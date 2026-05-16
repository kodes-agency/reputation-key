// Integration context — GBP import server function tests
// Tests input validation for the GBP import server functions and verifies
// the shared integrationErrorStatus is accessible from this module.
//
// Per architecture: server functions are thin wrappers — resolve auth →
// validate input → call use case → translate errors → return.

import { describe, it, expect } from 'vitest'
import { integrationErrorStatus } from './shared'
import { listLocationsInputSchema } from '../application/dto/list-locations.dto'
import { importPropertiesInputSchema } from '../application/dto/import-properties.dto'
import { importStatusInputSchema } from '../application/dto/import-status.dto'

// ── integrationErrorStatus re-exported from shared ────────────────

describe('integrationErrorStatus (re-exported via shared)', () => {
  it('is accessible and maps codes correctly', () => {
    expect(integrationErrorStatus('forbidden')).toBe(403)
    expect(integrationErrorStatus('connection_not_found')).toBe(404)
    expect(integrationErrorStatus('import_not_found')).toBe(404)
    expect(integrationErrorStatus('gbp_api_rate_limited')).toBe(429)
  })
})

// ── listLocations input validation ────────────────────────────────

describe('listLocationsInputSchema', () => {
  it('accepts valid input', () => {
    const result = listLocationsInputSchema.safeParse({
      connectionId: 'conn-123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing connectionId', () => {
    const result = listLocationsInputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty connectionId', () => {
    const result = listLocationsInputSchema.safeParse({
      connectionId: '',
    })
    expect(result.success).toBe(false)
  })
})

// ── importProperties input validation ─────────────────────────────

describe('importPropertiesInputSchema', () => {
  it('accepts valid input with locations', () => {
    const result = importPropertiesInputSchema.safeParse({
      connectionId: 'conn-123',
      locations: [
        {
          gbpPlaceId: 'ChIJ_test',
          businessName: 'Test Business',
          address: '123 Main St',
          primaryCategory: 'Restaurant',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts locations with null address', () => {
    const result = importPropertiesInputSchema.safeParse({
      connectionId: 'conn-123',
      locations: [
        {
          gbpPlaceId: 'ChIJ_test',
          businessName: 'Test Business',
          address: null,
          primaryCategory: 'Restaurant',
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('accepts locations with null primaryCategory', () => {
    const result = importPropertiesInputSchema.safeParse({
      connectionId: 'conn-123',
      locations: [
        {
          gbpPlaceId: 'ChIJ_test',
          businessName: 'Test Business',
          address: '123 Main St',
          primaryCategory: null,
        },
      ],
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing connectionId', () => {
    const result = importPropertiesInputSchema.safeParse({
      locations: [
        {
          gbpPlaceId: 'ChIJ_test',
          businessName: 'Test Business',
          address: '123 Main St',
          primaryCategory: 'Restaurant',
        },
      ],
    })
    expect(result.success).toBe(false)
  })

  it('rejects empty locations array', () => {
    const result = importPropertiesInputSchema.safeParse({
      connectionId: 'conn-123',
      locations: [],
    })
    expect(result.success).toBe(false)
  })

  it('rejects missing locations', () => {
    const result = importPropertiesInputSchema.safeParse({
      connectionId: 'conn-123',
    })
    expect(result.success).toBe(false)
  })
})

// ── importStatus input validation ─────────────────────────────────

describe('importStatusInputSchema', () => {
  it('accepts valid input', () => {
    const result = importStatusInputSchema.safeParse({
      importId: 'import-123',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing importId', () => {
    const result = importStatusInputSchema.safeParse({})
    expect(result.success).toBe(false)
  })

  it('rejects empty importId', () => {
    const result = importStatusInputSchema.safeParse({
      importId: '',
    })
    expect(result.success).toBe(false)
  })
})
