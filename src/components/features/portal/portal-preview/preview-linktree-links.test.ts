import { describe, expect, it } from 'vitest'
import type { PortalPreviewLink } from '#/contexts/portal/application/public-api'
import { previewLinktreeLink } from './preview-linktree-links'

const READY: PortalPreviewLink = {
  id: 'l-1',
  state: 'ready',
  iconKey: 'waves',
  imageUrl: 'https://media.example.com/spa.jpg',
  label: 'Spa & treatments',
  line: 'Book a time',
  fallbackFrom: 'en',
}

describe('previewLinktreeLink', () => {
  it('hands a ready tile over as the guest page takes it, with no placeholder', () => {
    const tile = previewLinktreeLink(READY)

    expect(tile).toEqual({
      id: 'l-1',
      iconKey: 'waves',
      imageUrl: 'https://media.example.com/spa.jpg',
      label: 'Spa & treatments',
      line: 'Book a time',
      fallbackFrom: 'en',
    })
    expect(tile.placeholder).toBeUndefined()
  })

  it('names a tile that has no label, so the manager can still find it', () => {
    expect(previewLinktreeLink({ ...READY, label: '' }).label).toBe('Untitled link')
  })

  it.each([
    ['awaiting_approval', 'Waiting for approval'],
    ['not_approved', 'Not approved, hidden from guests'],
  ] as const)('turns a %s tile into a placeholder that says why', (state, note) => {
    const tile = previewLinktreeLink({ ...READY, state })

    expect(tile.placeholder).toEqual({ kind: state, note })
    expect(tile.imageUrl).toBeNull()
    expect(tile.line).toBeNull()
    expect(tile.label).toBe('Spa & treatments')
  })
})
