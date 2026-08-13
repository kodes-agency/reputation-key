import { describe, expect, it } from 'vitest'
import { isPubliclyAvailable, transitionPortalPublication } from './portal-publication'

describe('portal publication lifecycle', () => {
  it('publishes drafts and republishes disabled portals', () => {
    expect(transitionPortalPublication('draft', 'published')).toBe('published')
    expect(transitionPortalPublication('disabled', 'published')).toBe('published')
  })

  it('does not allow a published portal to return to draft', () => {
    expect(transitionPortalPublication('published', 'draft')).toEqual({
      code: 'invalid_publication_transition',
      from: 'published',
      to: 'draft',
    })
  })

  it('makes archive terminal', () => {
    expect(transitionPortalPublication('archived', 'published')).toEqual({
      code: 'invalid_publication_transition',
      from: 'archived',
      to: 'published',
    })
  })

  it('exposes only published portals publicly', () => {
    expect(isPubliclyAvailable('published')).toBe(true)
    expect(isPubliclyAvailable('draft')).toBe(false)
    expect(isPubliclyAvailable('disabled')).toBe(false)
    expect(isPubliclyAvailable('archived')).toBe(false)
  })
})
