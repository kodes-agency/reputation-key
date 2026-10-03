// The one inline failure surface for a submit. A dialog that already holds its
// failure as a sentence (an upload refusal) hands that sentence in; a mutation
// hands in its error.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { GENERIC_ACTION_ERROR_MESSAGE } from '#/components/hooks/use-action-mutation'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { FormErrorBanner } from './form-error-banner'

const render = (error: unknown) =>
  renderToStaticMarkup(createElement(FormErrorBanner, { error }))

const refusal = (status: number, message: string) =>
  new ServerFunctionError('SomeError', message, 'some_code', status)

describe('FormErrorBanner', () => {
  it.each([400, 403, 404, 409, 422])(
    'shows the sentence of a %i refusal, which a context wrote for the reader',
    (status) => {
      expect(render(refusal(status, 'Name must be at least 2 characters'))).toContain(
        'Name must be at least 2 characters',
      )
    },
  )

  it.each([500, 502, 503])(
    'hides the text of a %i, which may name internal state, behind the generic sentence',
    (status) => {
      const html = render(refusal(status, 'duplicate key value violates "pk_members"'))

      expect(html).toContain(GENERIC_ACTION_ERROR_MESSAGE)
      expect(html).not.toContain('duplicate key')
    },
  )

  it('hides the text of an error that is not a server-function error', () => {
    const html = render(new Error('ECONNRESET at db-primary.internal:5432'))

    expect(html).toContain(GENERIC_ACTION_ERROR_MESSAGE)
    expect(html).not.toContain('ECONNRESET')
  })

  it('hides the message of a plain object with a message key', () => {
    const html = render({ message: 'select * from members where id = 7' })

    expect(html).toContain(GENERIC_ACTION_ERROR_MESSAGE)
    expect(html).not.toContain('select *')
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

  it('lists the issues of a rejected schema even when the server tagged it a 400', () => {
    const html = render(
      refusal(400, JSON.stringify([{ path: ['slug'], message: 'Use letters only' }])),
    )

    expect(html).toContain('slug: Use letters only')
  })
})
