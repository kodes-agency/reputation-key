// Portal context — domain errors tests

import { describe, it, expect } from 'vitest'
import { portalError, isPortalError } from './errors'

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
