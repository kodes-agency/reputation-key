import { describe, expect, it } from 'vitest'
import { transitionPortalPublication } from './portal-publication'

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

  it('restores an archived Portal to Disabled without publishing it', () => {
    expect(transitionPortalPublication('archived', 'disabled')).toBe('disabled')
  })

  it('does not let restore bypass deliberate republication', () => {
    expect(transitionPortalPublication('archived', 'published')).toEqual({
      code: 'invalid_publication_transition',
      from: 'archived',
      to: 'published',
    })
  })
})
