// One way to start a Google authorization (UI consistency scan: FORM-13, ACT-09).
//
// "Connect Google" was built twice: a Button with a spinner and "Connect Google Account"
// on the import page, two Buttons with a Plus, "Connect Google" / "Connect another
// account" and a renamed "Connecting…" label on the Integrations page, and two more for
// Reauthorize and Show account email with a failure sentence of their own. The button
// owns the request, the icon, the pending state and the failure; a place chooses the
// label and the look.
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ConnectGoogleButton } from './connect-google-button'
import {
  connectFailureMessage,
  NEW_GOOGLE_CONNECTION_AUTHORIZATION,
} from './connect-google-request'

const getAuthUrl = async () => ({ url: 'https://accounts.google.test/oauth' })

const render = (props: object = {}) =>
  renderToStaticMarkup(createElement(ConnectGoogleButton, { getAuthUrl, ...props }))

describe('the request', () => {
  it('starts a normal connection as an untargeted Organization-owned ceremony', () => {
    expect(NEW_GOOGLE_CONNECTION_AUTHORIZATION).toEqual({
      visibility: 'organization',
      connectionMode: 'new',
      targetConnectionId: null,
    })
  })
})

describe('connectFailureMessage', () => {
  it('names the connection when a new one could not be started', () => {
    expect(connectFailureMessage(NEW_GOOGLE_CONNECTION_AUTHORIZATION)).toBe(
      "Couldn't connect your Google account.",
    )
  })

  it('names the reauthorization when one could not be started', () => {
    expect(
      connectFailureMessage({
        visibility: 'organization',
        connectionMode: 'reauth',
        targetConnectionId: 'connection-7',
      }),
    ).toBe("Couldn't reauthorize your Google account.")
  })
})

describe('ConnectGoogleButton', () => {
  it('is "Connect Google" with the one glyph for adding an account, wherever it stands', () => {
    const html = render()

    expect(html).toContain('>Connect Google<')
    expect(html).toMatch(/<svg[^>]*lucide-plus/u)
    expect(html).not.toContain('Connect Google Account')
  })

  it('takes the label of a place where it is another account', () => {
    expect(render({ label: 'Connect another account' })).toContain(
      '>Connect another account<',
    )
  })

  it('is a reauthorization when the request says so, with no glyph to add an account', () => {
    const html = render({
      label: 'Reauthorize',
      variant: 'outline',
      size: 'sm',
      request: {
        visibility: 'organization',
        connectionMode: 'reauth',
        targetConnectionId: 'connection-7',
      },
    })

    expect(html).toContain('>Reauthorize<')
    expect(html).not.toContain('lucide-plus')
    expect(html).toContain('data-variant="outline"')
    expect(html).toContain('data-size="sm"')
  })

  it('can be disabled by the page while another authorization starts', () => {
    expect(render({ disabled: true })).toMatch(/<button[^>]*disabled/u)
  })

  it('is a button that never submits a form around it', () => {
    expect(render()).toContain('type="button"')
  })
})
