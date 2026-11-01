import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  DISPLAY_NAME,
  PACKS,
  renderResponse,
} from './__fixtures__/immersive-response-fixtures'
import { immersiveResponseProps } from './immersive-response-preview'
import { ImmersiveResponseView } from './immersive-response-view'

const body = (html: string) => html.replace(/<style[\s\S]*?<\/style>/gu, '')

describe('other states', () => {
  const pack = PACKS[0]
  if (!pack) throw new Error('no pack')
  const view = (props: Parameters<typeof immersiveResponseProps>[0]) =>
    body(renderResponse(pack, props))

  it('says the response was removed after a full withdrawal, and offers nothing else', () => {
    const props = immersiveResponseProps(
      { kind: 'rated', rating: 2 },
      { pack, displayName: DISPLAY_NAME },
    )
    const html = body(
      renderToStaticMarkup(
        createElement(ImmersiveResponseView, {
          ...props,
          response: props.response && {
            ...props.response,
            status: 'deleted',
            rating: null,
          },
        }),
      ),
    )
    expect(html).toContain(pack.copy.responseRemoveAllDoneTitle)
    expect(html).not.toContain(pack.copy.googleTitle)
    expect(html).not.toContain('type="radio"')
  })

  it('shows a busy placeholder while the gateway loads, and the rating-only text when it fails', () => {
    const base = immersiveResponseProps(
      { kind: 'arrival' },
      { pack, displayName: DISPLAY_NAME },
    )
    const render = (availability: 'loading' | 'unavailable') =>
      body(
        renderToStaticMarkup(
          createElement(ImmersiveResponseView, { ...base, availability }),
        ),
      )
    expect(render('loading')).toContain('aria-busy="true"')
    expect(render('unavailable')).toContain(pack.copy.ratingUnavailableTitle)
    expect(render('unavailable')).not.toContain('type="radio"')
  })

  it('renders arrival as a single card, with no receipt, Google or note card', () => {
    const html = view({ kind: 'arrival' })
    expect(html).not.toContain(pack.copy.ratingThanks)
    expect(html).not.toContain(pack.copy.googleTitle)
    expect(html).not.toContain(pack.copy.noteOfferTitle)
  })
})
