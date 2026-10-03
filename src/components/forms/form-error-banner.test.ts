// The one inline failure surface for a submit. A dialog that already holds its
// failure as a sentence (an upload refusal) hands that sentence in; a mutation
// hands in its error.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { FormErrorBanner } from './form-error-banner'

const render = (error: unknown) =>
  renderToStaticMarkup(createElement(FormErrorBanner, { error }))

describe('FormErrorBanner', () => {
  it('shows the message of an Error', () => {
    expect(render(new Error('Name must be at least 2 characters'))).toContain(
      'Name must be at least 2 characters',
    )
  })

  it('shows a sentence handed in as text', () => {
    const html = render('Use a JPEG, PNG or WebP photo.')

    expect(html).toContain('role="alert"')
    expect(html).toContain('Use a JPEG, PNG or WebP photo.')
  })

  it.each([null, undefined, false, ''])('draws nothing for %j', (error) => {
    expect(render(error)).toBe('')
  })

  it('lists the issues of a rejected schema instead of dumping its JSON', () => {
    const html = render(
      new Error(JSON.stringify([{ path: ['name'], message: 'Too short' }])),
    )

    expect(html).toContain('name: Too short')
    expect(html).not.toContain('&quot;path&quot;')
  })
})
