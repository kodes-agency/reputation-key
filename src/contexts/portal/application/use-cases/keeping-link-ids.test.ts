import { describe, expect, it } from 'vitest'
import { keepingLinkIds } from './update-personal-guest-page'

describe('keepingLinkIds', () => {
  const copied = (id: string, destinationId: string) => ({ id, destinationId }) as never
  const content = {
    links: [
      copied('new-menu', 'menu'),
      copied('new-spa', 'spa'),
      copied('new-bar', 'bar'),
    ],
    linkTexts: [
      { linkId: 'new-menu', locale: 'en', label: 'Menu' },
      { linkId: 'new-bar', locale: 'en', label: 'Bar' },
    ],
  } as never

  it('gives a link the id it already had at that destination, and its texts with it', () => {
    const kept = keepingLinkIds(content, [
      { id: 'old-menu', destinationId: 'menu' },
      { id: 'old-gone', destinationId: 'gone' },
      { id: 'old-legacy', destinationId: null },
    ] as never)
    expect(kept.links.map((link) => link.id)).toEqual(['old-menu', 'new-spa', 'new-bar'])
    expect(kept.linkTexts.map((text) => text.linkId)).toEqual(['old-menu', 'new-bar'])
  })

  it('uses each old id once when two links share a destination', () => {
    const kept = keepingLinkIds(
      { links: [copied('a', 'menu'), copied('b', 'menu')], linkTexts: [] } as never,
      [{ id: 'old', destinationId: 'menu' }] as never,
    )
    expect(kept.links.map((link) => link.id)).toEqual(['old', 'b'])
  })
})
