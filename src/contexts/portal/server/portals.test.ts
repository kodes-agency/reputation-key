// Portal context — server function tests
// Tests the actual error→status mapping and throwContextError construction used by
// the server functions. Imports the real portalErrorStatus from the server module
// to ensure tests break when production code changes.
//
// Per architecture: exhaustive ts-pattern matching ensures new error codes
// are caught at compile time.

import { describe, it, expect } from 'vitest'
import { portalError, isPortalError } from '#/contexts/portal/domain/errors'
import type { PortalErrorCode } from '#/contexts/portal/domain/errors'
import { portalErrorStatus } from '#/contexts/portal/server/portals'
import { throwContextError } from '#/shared/auth/server-errors'
import { createPortalInputSchema } from '#/contexts/portal/application/dto/create-portal.dto'
import { updatePortalInputSchema } from '#/contexts/portal/application/dto/update-portal.dto'

// ── Error → HTTP status mapping (production code) ─────────────────

describe('portalErrorStatus (imported from server module)', () => {
  it('maps forbidden → 403', () => {
    expect(portalErrorStatus('forbidden')).toBe(403)
  })

  it('maps portal_not_found → 404', () => {
    expect(portalErrorStatus('portal_not_found')).toBe(404)
  })

  it('maps property_not_found → 404', () => {
    expect(portalErrorStatus('property_not_found')).toBe(404)
  })

  it('maps category_not_found → 404', () => {
    expect(portalErrorStatus('category_not_found')).toBe(404)
  })

  it('maps link_not_found → 404', () => {
    expect(portalErrorStatus('link_not_found')).toBe(404)
  })

  it('maps slug_taken → 409', () => {
    expect(portalErrorStatus('slug_taken')).toBe(409)
  })

  it('maps upload_failed → 422', () => {
    expect(portalErrorStatus('upload_failed')).toBe(422)
  })

  it('maps invalid_slug → 400', () => {
    expect(portalErrorStatus('invalid_slug')).toBe(400)
  })

  it('maps invalid_name → 400', () => {
    expect(portalErrorStatus('invalid_name')).toBe(400)
  })

  it('maps invalid_description → 400', () => {
    expect(portalErrorStatus('invalid_description')).toBe(400)
  })

  it('maps invalid_theme → 400', () => {
    expect(portalErrorStatus('invalid_theme')).toBe(400)
  })

  it('maps invalid_threshold → 400', () => {
    expect(portalErrorStatus('invalid_threshold')).toBe(400)
  })

  it('maps invalid_url → 400', () => {
    expect(portalErrorStatus('invalid_url')).toBe(400)
  })

  it('maps invalid_label → 400', () => {
    expect(portalErrorStatus('invalid_label')).toBe(400)
  })

  it('maps invalid_title → 400', () => {
    expect(portalErrorStatus('invalid_title')).toBe(400)
  })

  it('all error codes are covered (exhaustive check)', () => {
    const codes: PortalErrorCode[] = [
      'forbidden',
      'invalid_slug',
      'invalid_name',
      'invalid_description',
      'invalid_theme',
      'invalid_threshold',
      'invalid_url',
      'invalid_label',
      'invalid_title',
      'slug_taken',
      'portal_not_found',
      'category_not_found',
      'link_not_found',
      'property_not_found',
      'upload_failed',
    ]
    for (const code of codes) {
      const status = portalErrorStatus(code)
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(500)
    }
  })
})

// ── throwContextError (shared server error helper) ─────────────────

describe('throwContextError with PortalError', () => {
  it('throws an Error with the domain message', () => {
    const e = portalError('invalid_slug', 'slug must be URL-friendly')
    expect(() =>
      throwContextError('PortalError', e, portalErrorStatus(e.code)),
    ).toThrow('slug must be URL-friendly')
  })

  it('sets error.name to PortalError', () => {
    const e = portalError('forbidden', 'Insufficient role')
    try {
      throwContextError('PortalError', e, portalErrorStatus(e.code))
    } catch (err) {
      expect(err).toBeInstanceOf(Error)
      expect((err as Error).name).toBe('PortalError')
    }
  })

  it('attaches code and status as custom properties', () => {
    const e = portalError('slug_taken', 'Slug already exists')
    try {
      throwContextError('PortalError', e, portalErrorStatus(e.code))
    } catch (err) {
      const error = err as Error & { code: string; status: number }
      expect(error.code).toBe('slug_taken')
      expect(error.status).toBe(409)
    }
  })

  it('preserves the correct status for every error code', () => {
    const cases: Array<[PortalErrorCode, number]> = [
      ['forbidden', 403],
      ['portal_not_found', 404],
      ['property_not_found', 404],
      ['category_not_found', 404],
      ['link_not_found', 404],
      ['slug_taken', 409],
      ['upload_failed', 422],
      ['invalid_slug', 400],
      ['invalid_name', 400],
      ['invalid_description', 400],
      ['invalid_theme', 400],
      ['invalid_threshold', 400],
      ['invalid_url', 400],
      ['invalid_label', 400],
      ['invalid_title', 400],
    ]
    for (const [code, expectedStatus] of cases) {
      const e = portalError(code, `test ${code}`)
      try {
        throwContextError('PortalError', e, portalErrorStatus(e.code))
      } catch (err) {
        const error = err as Error & { code: string; status: number }
        expect(error.status).toBe(expectedStatus)
        expect(error.code).toBe(code)
      }
    }
  })
})

// ── isPortalError type guard ───────────────────────────────────────

describe('isPortalError type guard', () => {
  it('returns true for PortalError', () => {
    const error = portalError('forbidden', 'test')
    expect(isPortalError(error)).toBe(true)
  })

  it('returns false for plain Error', () => {
    expect(isPortalError(new Error('boom'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isPortalError(null)).toBe(false)
  })

  it('returns false for plain object', () => {
    expect(isPortalError({ code: 'forbidden', message: 'test' })).toBe(false)
  })
})

// ── Input validation (DTO schemas) ─────────────────────────────────

describe('createPortal input validation', () => {
  it('accepts valid create input with required fields', () => {
    const result = createPortalInputSchema.safeParse({
      name: 'Guest Portal',
      propertyId: 'prop-123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts create input with all fields', () => {
    const result = createPortalInputSchema.safeParse({
      name: 'Guest Portal',
      slug: 'guest-portal',
      description: 'Welcome to our property',
      propertyId: 'prop-123',
      entityType: 'property',
      entityId: 'prop-123',
      theme: { primaryColor: '#6366F1', backgroundColor: '#FFFFFF' },
      smartRoutingEnabled: true,
      smartRoutingThreshold: 3,
    })
    expect(result.success).toBe(true)
  })

  it('rejects create input missing required name', () => {
    const result = createPortalInputSchema.safeParse({
      propertyId: 'prop-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects create input missing required propertyId', () => {
    const result = createPortalInputSchema.safeParse({
      name: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('rejects name over 100 characters', () => {
    const result = createPortalInputSchema.safeParse({
      name: 'a'.repeat(101),
      propertyId: 'prop-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects slug under 2 characters', () => {
    const result = createPortalInputSchema.safeParse({
      name: 'Test',
      slug: 'a',
      propertyId: 'prop-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects description over 500 characters', () => {
    const result = createPortalInputSchema.safeParse({
      name: 'Test',
      description: 'a'.repeat(501),
      propertyId: 'prop-123',
    })
    expect(result.success).toBe(false)
  })

  it('rejects smartRoutingThreshold below 1', () => {
    const result = createPortalInputSchema.safeParse({
      name: 'Test',
      propertyId: 'prop-123',
      smartRoutingThreshold: 0,
    })
    expect(result.success).toBe(false)
  })

  it('rejects smartRoutingThreshold above 4', () => {
    const result = createPortalInputSchema.safeParse({
      name: 'Test',
      propertyId: 'prop-123',
      smartRoutingThreshold: 5,
    })
    expect(result.success).toBe(false)
  })
})

describe('updatePortal input validation', () => {
  it('accepts update with portalId only', () => {
    const result = updatePortalInputSchema.safeParse({
      portalId: 'portal-123',
    })
    expect(result.success).toBe(true)
  })

  it('accepts update with all fields', () => {
    const result = updatePortalInputSchema.safeParse({
      portalId: 'portal-123',
      name: 'Updated Name',
      slug: 'updated-slug',
      description: 'Updated description',
      theme: { primaryColor: '#FF5500' },
      smartRoutingEnabled: false,
      smartRoutingThreshold: 2,
      isActive: false,
    })
    expect(result.success).toBe(true)
  })

  it('rejects update without portalId', () => {
    const result = updatePortalInputSchema.safeParse({
      name: 'Test',
    })
    expect(result.success).toBe(false)
  })

  it('accepts null description (to clear it)', () => {
    const result = updatePortalInputSchema.safeParse({
      portalId: 'portal-123',
      description: null,
    })
    expect(result.success).toBe(true)
  })
})
