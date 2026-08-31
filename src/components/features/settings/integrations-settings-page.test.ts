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
    scopes: [],
    connectedBy: 'user-1',
    visibility: 'organization',
    status,
    createdAt: new Date('2026-08-27T00:00:00Z'),
    updatedAt: new Date('2026-08-27T00:00:00Z'),
  }
}

const renderPage = (status: GoogleConnectionDto['status']) =>
  renderToStaticMarkup(
    createElement(IntegrationsSettingsPage, {
      connections: [connection(status)],
      connectGoogle: action<AuthorizeInput, { url: string }>({
        url: 'https://accounts.google.test/oauth',
      }),
      disconnectGoogle: action<DisconnectInput, { connection: GoogleConnectionDto }>({
        connection: connection('disconnected'),
      }),
    }),
  )

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
