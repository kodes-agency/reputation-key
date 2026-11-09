import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortalPrivateNoteForm } from './portal-private-note-form'
import { PortalDraftAutosaveProvider } from './portal-draft-autosave-context'
import { action, portal } from './__fixtures__/portal-editor-fixtures'

const render = (skipPrivateRating: boolean) =>
  renderToStaticMarkup(
    createElement(PortalDraftAutosaveProvider, {
      children: createElement(PortalPrivateNoteForm, {
        portal: { ...portal, skipPrivateRating },
        mutation: action(async () => undefined),
      }),
    }),
  )

describe('private rating editor switch', () => {
  it('shows the canonical switch and hides the threshold when on', () => {
    const html = render(true)
    expect(html).toContain('Skip the private rating')
    expect(html).toContain('Guests go straight to the Google button.')
    expect(html).toContain('data-slot="setting-switch-row"')
    expect(html).toContain('aria-checked="true"')
    expect(html).not.toContain('Offer a private note at')
  })
  it('keeps the threshold when off', () => {
    expect(render(false)).toContain('Offer a private note at')
  })
})
