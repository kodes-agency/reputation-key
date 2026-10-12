import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { Action } from '#/components/hooks/use-action'
import type {
  GoogleAuthUrlInput,
  GoogleConnectionDto,
} from '#/contexts/integration/application/public-api'
import { IntegrationsSettingsPage } from './integrations-settings-page'

type AuthorizeInput = Readonly<{ data: GoogleAuthUrlInput }>
type DisconnectInput = Readonly<{ data: Readonly<{ connectionId: string }> }>

function action<TInput, TOutput>(output: TOutput): Action<TInput, TOutput> {
  return Object.assign(async (_input: TInput) => output, {
    isPending: false,
    error: null,
    isSuccess: false,
    data: null,
  })
}

function connection(status: GoogleConnectionDto['status']): GoogleConnectionDto {
  return {
    id: 'connection-7',
    organizationId: 'organization-1',
    accountEmail: null,
    scopes: [],
    connectedBy: 'user-1',
    visibility: 'organization',
    status,
    createdAt: new Date('2026-08-27T00:00:00Z'),
    updatedAt: new Date('2026-08-27T00:00:00Z'),
  }
}

const renderPageWith = (connections: readonly GoogleConnectionDto[]) =>
  renderToStaticMarkup(
    createElement(IntegrationsSettingsPage, {
      connections,
      connectGoogle: action<AuthorizeInput, { url: string }>({
        url: 'https://accounts.google.test/oauth',
      }),
      disconnectGoogle: action<DisconnectInput, { connection: GoogleConnectionDto }>({
        connection: connection('disconnected'),
      }),
    }),
  )

const renderPage = (status: GoogleConnectionDto['status']) =>
  renderPageWith([connection(status)])

describe('IntegrationsSettingsPage Google reauthorization', () => {
  it('gently offers reauthorization when the connection needs fresh permission', () => {
    const html = renderPage('reauth_required')

    expect(html).toContain('Needs attention')
    expect(html).toContain('Google needs your permission again')
    expect(html).toContain('Reauthorize')
  })

  it('does not offer reauthorization for an active connection', () => {
    expect(renderPage('active')).not.toContain('Reauthorize')
  })
})

// One button starts every Google authorization (UI consistency scan: FORM-13, ACT-09):
// the same wording and glyph where there is no account and where there is one already.
describe('IntegrationsSettingsPage Google connect', () => {
  it('offers "Connect Google" when no account is connected', () => {
    const html = renderPageWith([])

    expect(html).toContain('>Connect Google<')
    expect(html).not.toContain('Connect another account')
  })

  it('offers "Connect another account" beside an account that is connected', () => {
    const html = renderPage('active')

    expect(html).toContain('>Connect another account<')
    expect(html).not.toContain('>Connect Google<')
  })

  it('does not rename the button while it connects, and has no second wording', () => {
    for (const html of [renderPageWith([]), renderPage('active')]) {
      expect(html).not.toContain('Connecting…')
      expect(html).not.toContain('Connect Google Account')
    }
  })

  it('draws the reauthorization as the same button, not a bespoke one', () => {
    const html = renderPage('reauth_required')

    expect(html).toMatch(
      /<button[^>]*data-variant="outline"[^>]*>(?:(?!<\/button>).)*Reauthorize/u,
    )
  })
})
