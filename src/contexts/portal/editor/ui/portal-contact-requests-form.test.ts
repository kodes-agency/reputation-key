import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PortalContactRequestsForm } from './portal-contact-requests-form'
import { PortalDraftAutosaveProvider } from './portal-draft-autosave-context'
import { action, portal } from './__fixtures__/portal-editor-fixtures'

const render = (contactRequestsEnabled: boolean, noticeInForce: boolean) =>
  renderToStaticMarkup(
    createElement(PortalDraftAutosaveProvider, {
      children: createElement(PortalContactRequestsForm, {
        portal: { ...portal, contactRequestsEnabled },
        mutation: action(async () => undefined),
        noticeInForce,
      }),
    }),
  )

describe('contact requests switch', () => {
  it('shows the saved setting', () => {
    expect(render(true, true)).toContain('aria-checked="true"')
    expect(render(false, true)).toContain('aria-checked="false"')
  })

  it('says contact requests are not available yet while no notice covers them', () => {
    expect(render(false, false)).toContain('not available yet')
    expect(render(false, true)).not.toContain('not available yet')
  })
})
