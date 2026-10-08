// What the response area shows after the guest removed their whole response, and
// when only the rating cannot be sent. Rendered to markup and read back; the
// focus that follows a start over is covered in the stories.
//
// The removed state used to be a dead end: the notice, no rating card and no
// "Start over", which lives only in the "Your response" section that the removal
// takes away. The session cannot rate again, so the page offers the way on that
// the server now allows: a fresh session.

import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { withoutStyleElements } from '../__fixtures__/markup-walk'
import { PACKS } from './__fixtures__/immersive-response-fixtures'
import { immersiveResponseProps } from './immersive-response-preview'
import {
  ImmersiveResponseView,
  type ImmersiveResponseViewProps,
} from './immersive-response-view'

const DISPLAY_NAME = 'Avela Resort'
const body = withoutStyleElements

function rated(pack: (typeof PACKS)[number]) {
  return immersiveResponseProps(
    { kind: 'rated', rating: 2 },
    { pack, displayName: DISPLAY_NAME },
  )
}

function removed(
  pack: (typeof PACKS)[number],
  overrides: Partial<ImmersiveResponseViewProps> = {},
  status: 'deleted' | 'submitted' = 'deleted',
) {
  const props = rated(pack)
  return body(
    renderToStaticMarkup(
      createElement(ImmersiveResponseView, {
        ...props,
        response: props.response && { ...props.response, status, rating: null },
        ...overrides,
      }),
    ),
  )
}

describe.each(PACKS)('a removed response [$locale]', (pack) => {
  it('says it was removed and shows no rating card, no Google card and no note', () => {
    const html = removed(pack)
    expect(html).toContain(pack.copy.responseRemoveAllDoneTitle)
    expect(html).toContain(pack.copy.responseRemoveAllDoneBody)
    expect(html).not.toContain(pack.copy.googleTitle)
    expect(html).not.toContain(pack.copy.noteOfferTitle)
    expect(html).not.toContain('type="radio"')
  })

  it('offers "Start over" under the notice, in the shared-device words', () => {
    const html = removed(pack)
    expect(html).toContain(pack.copy.sharedDeviceTitle)
    expect(html).toContain(pack.copy.sharedDeviceBody)
    expect(html).toMatch(
      new RegExp(
        `<button[^>]*type="button"[^>]*>[\\s\\S]*${pack.copy.startOverAction}</button>`,
        'u',
      ),
    )
    expect(html.indexOf(pack.copy.startOverAction)).toBeGreaterThan(
      html.indexOf(pack.copy.responseRemoveAllDoneBody),
    )
    expect(html.match(/<button\b/gu)).toHaveLength(1)
  })

  it('keeps the notice a status message and puts the button outside it', () => {
    const html = removed(pack)
    const notice =
      html.match(/<section[^>]*role="status"[^>]*>[\s\S]*?<\/section>/u)?.[0] ?? ''
    expect(notice).toContain(pack.copy.responseRemoveAllDoneTitle)
    expect(notice).not.toContain('<button')
  })

  it('waits while a call is on its way, and says when the last start over failed', () => {
    expect(removed(pack, { pending: true })).toMatch(/<button[^>]*disabled=""/u)
    const failed = removed(pack, { failure: 'start-over' })
    expect(failed).toContain(pack.copy.startOverFailed)
    expect(failed).toContain('role="alert"')
    expect(removed(pack)).not.toContain(pack.copy.startOverFailed)
  })

  it('offers no way on where nothing can start over (a preview with no handlers)', () => {
    const html = removed(pack, { yourResponse: undefined })
    expect(html).toContain(pack.copy.responseRemoveAllDoneTitle)
    expect(html).not.toContain('<button')
    expect(html).not.toContain(pack.copy.startOverAction)
  })

  it('offers it only for a response the guest withdrew, as the server decides', () => {
    const html = removed(pack, {}, 'submitted')
    expect(html).toContain(pack.copy.responseRemoveAllDoneTitle)
    expect(html).not.toContain(pack.copy.startOverAction)
  })
})

describe.each(PACKS)('a fresh page after a start over [$locale]', (pack) => {
  const arrival = (notice: ImmersiveResponseViewProps['notice']) =>
    body(
      renderToStaticMarkup(
        createElement(ImmersiveResponseView, {
          ...immersiveResponseProps(
            { kind: 'arrival' },
            { pack, displayName: DISPLAY_NAME },
          ),
          notice,
        }),
      ),
    )

  it('says "ready for the next guest" and that the earlier response remains saved, after a rating', () => {
    const html = arrival('started-over')
    expect(html).toContain(pack.copy.startOverDone)
    expect(html).toContain('type="radio"')
  })

  it('says only that it is ready after a removal, because nothing earlier remains', () => {
    const html = arrival('started-over-after-removal')
    expect(html).toContain(`>${pack.copy.startOverDoneAfterRemoval}</p>`)
    expect(html).not.toContain(pack.copy.startOverDone)
    expect(html).toContain('type="radio"')
  })

  it('says nothing without a notice', () => {
    const html = arrival(null)
    expect(html).not.toContain(pack.copy.startOverDoneAfterRemoval)
    expect(html).not.toContain(pack.copy.startOverDone)
  })
})

describe.each(PACKS)('a rating that cannot be sent [$locale]', (pack) => {
  const html = body(
    renderToStaticMarkup(
      createElement(ImmersiveResponseView, {
        ...immersiveResponseProps(
          { kind: 'arrival' },
          { pack, displayName: DISPLAY_NAME },
        ),
        availability: 'unavailable',
      }),
    ),
  )

  it('talks about the rating only, not about the whole page being gone', () => {
    expect(html).toContain(pack.copy.ratingUnavailableTitle)
    expect(html).toContain(pack.copy.ratingUnavailableBody)
    expect(html).not.toContain(pack.copy.unavailableTitle)
  })

  it('shows no rating card, since none can be sent', () => {
    expect(html).not.toContain('type="radio"')
  })
})

describe('a rating that cannot be sent, in English', () => {
  it('reads as a limit of this card, followed by a way on', () => {
    const english = PACKS.find((pack) => pack.locale === 'en')
    if (!english) throw new Error('no English pack')
    const html = body(
      renderToStaticMarkup(
        createElement(ImmersiveResponseView, {
          ...immersiveResponseProps(
            { kind: 'arrival' },
            { pack: english, displayName: DISPLAY_NAME },
          ),
          availability: 'unavailable',
        }),
      ),
    )
    expect(html).toContain('Ratings can’t be sent from here right now.')
    expect(html).toContain('Please try again later.')
    expect(html).not.toContain('This page isn’t available')
  })
})
