// Portal context — domain errors tests

import { describe, it, expect } from 'vitest'
import { portalError, isPortalError } from './errors'
import type { PortalErrorCode } from './errors'

describe('portalError', () => {
  it('creates a tagged error', () => {
    const err = portalError('forbidden', 'not allowed')
    expect(err._tag).toBe('PortalError')
    expect(err.code).toBe('forbidden')
    expect(err.message).toBe('not allowed')
  })

  it('includes context when provided', () => {
    const err = portalError('invalid_slug', 'bad slug', { slug: 'foo' })
    expect(err.context).toEqual({ slug: 'foo' })
  })

  it('omits context when not provided', () => {
    const err = portalError('forbidden', 'nope')
    expect(err.context).toBeUndefined()
  })
})

describe('isPortalError', () => {
  it('returns true for portal errors', () => {
    const err = portalError('portal_not_found', 'gone')
    expect(isPortalError(err)).toBe(true)
  })

  it('returns false for plain errors', () => {
    expect(isPortalError(new Error('nope'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isPortalError(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isPortalError(undefined)).toBe(false)
  })
})

describe('portalError exhaustive codes', () => {
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
    'group_not_found',
    'group_name_taken',
    'portal_already_grouped',
    'portal_not_in_group',
    'portal_inactive',
    'upload_failed',
  ]

  it('creates error with every code in the union', () => {
    for (const code of codes) {
      const err = portalError(code, `test ${code}`)
      expect(err._tag).toBe('PortalError')
      expect(err.code).toBe(code)
    }
  })

  it('covers all codes (fails if a new code is added but not listed here)', () => {
    expect(codes).toHaveLength(20)
  })
})
