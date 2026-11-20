import { describe, expect, it } from 'vitest'
import {
  PACKS,
  renderResponse as renderWithStyles,
} from './__fixtures__/immersive-response-fixtures'
import { text } from '../__fixtures__/markup-walk'

const renderResponse: typeof renderWithStyles = (...args) =>
  renderWithStyles(...args).replace(/<style[\s\S]*?<\/style>/gu, '')
const pack = PACKS[0]
if (!pack) throw new Error('A guest language pack is required')

describe('direct Google response states', () => {
  it('does not offer a new note for an earlier low rating, but keeps an existing note', () => {
    const earlier = renderResponse(
      pack,
      { kind: 'rated', rating: 2 },
      { skipPrivateRating: true },
    )
    expect(earlier).not.toContain('class="ih-note')
    expect(text(earlier)).not.toContain(pack.copy.noteOfferTitle)
    const sent = renderResponse(
      pack,
      { kind: 'done', rating: 2 },
      { skipPrivateRating: true },
    )
    expect(sent).toContain('class="ih-note')
    expect(sent).not.toContain('<textarea')
  })

  it('keeps the response-area spacing wrapper', () => {
    expect(renderResponse(pack, { kind: 'direct' })).toContain(
      'class="ih-response" data-ih-response="direct"',
    )
  })

  it.each(['started-over', 'started-over-after-removal'] as const)(
    'keeps the live notice and focus target after %s',
    (notice) => {
      const html = renderResponse(pack, { kind: 'direct' }, { notice })
      expect(html).toContain('role="status" tabindex="-1" class="ih-yr__ready"')
      expect(text(html)).toContain(
        notice === 'started-over'
          ? pack.copy.startOverDone
          : pack.copy.startOverDoneAfterRemoval,
      )
      expect(html).not.toContain('type="radio"')
    },
  )

  it.each(['loading', 'unavailable'] as const)(
    'offers Google independently of guest-response availability: %s',
    (availability) => {
      const html = renderResponse(pack, { kind: 'direct' }, { availability })
      expect(text(html)).toContain(pack.copy.googleAction)
      expect(html).not.toContain('ih-placeholder')
      expect(text(html)).not.toContain(pack.copy.ratingUnavailableTitle)
    },
  )

  it('keeps existing-response availability behavior', () => {
    const html = renderResponse(
      pack,
      { kind: 'rated', rating: 2 },
      { skipPrivateRating: true, availability: 'unavailable' },
    )
    expect(text(html)).toContain(pack.copy.ratingUnavailableTitle)
    expect(text(html)).not.toContain(pack.copy.googleAction)
  })
})
