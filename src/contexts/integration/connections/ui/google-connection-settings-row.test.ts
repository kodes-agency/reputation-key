import { createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { ConfirmationDialog } from '#/components/ui/confirmation-dialog'
import type { GoogleConnectionDto } from '#/contexts/integration/application/public-api'
import { GoogleConnectionSettingsRow } from './google-connection-settings-row'

// Render the confirmation's message without a browser portal. The dialog's
// confirmation and cancellation interactions are covered by the row's stories.
vi.mock('#/components/ui/confirmation-dialog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('#/components/ui/confirmation-dialog')>()),
  ConfirmationDialog: ({
    title,
    description,
  }: ComponentProps<typeof ConfirmationDialog>) =>
    createElement(
      'section',
      { role: 'alertdialog' },
      title,
      createElement('p', null, description),
    ),
}))

const connection: GoogleConnectionDto = {
  id: 'connection-7',
  organizationId: 'organization-1',
  accountEmail: 'owner@harborline.test',
  scopes: [],
  connectedBy: 'user-1',
  visibility: 'organization',
  status: 'active',
  createdAt: new Date('2026-08-27T00:00:00Z'),
  updatedAt: new Date('2026-08-27T00:00:00Z'),
}

describe('GoogleConnectionSettingsRow disconnect confirmation', () => {
  it('explains stopped work and the unchanged fetch-based expiry without deleting on Google', () => {
    const onDisconnect = vi.fn()
    const html = renderToStaticMarkup(
      createElement(GoogleConnectionSettingsRow, {
        connection,
        getAuthUrl: vi.fn(),
        authorizationPending: false,
        disconnectPending: false,
        onDisconnect,
      }),
    )

    expect(html).toContain(
      'stops syncing and replying through this account for every property that uses it',
    )
    expect(html).toContain('revokes its access')
    expect(html).toContain(
      'Imported reviews and replies stay in the Inbox until 30 days after they were last fetched from Google.',
    )
    expect(html).toContain('Disconnecting does not restart that clock.')
    expect(html).toContain('Nothing is deleted on Google.')
    expect(onDisconnect).not.toHaveBeenCalled()
  })
})
