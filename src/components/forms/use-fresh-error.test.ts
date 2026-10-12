// A dialog's body mounts when it opens, so an error that was already on its
// mutation when it mounted belongs to an earlier time it was open (UI
// consistency scan: SURF-07). `useFreshError` hides exactly that one.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { useFreshError } from './use-fresh-error'

function Probe({ error }: Readonly<{ error: unknown }>) {
  const fresh = useFreshError(error)
  return createElement('output', null, fresh === null ? 'none' : String(fresh))
}

const render = (error: unknown) => renderToStaticMarkup(createElement(Probe, { error }))

describe('useFreshError', () => {
  it('shows nothing for an error the mutation already held when the body mounted', () => {
    expect(render(new Error('Refused earlier'))).toContain('none')
  })

  it('shows nothing when there is no error', () => {
    expect(render(null)).toContain('none')
  })
})
