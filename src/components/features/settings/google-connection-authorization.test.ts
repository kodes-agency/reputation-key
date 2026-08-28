import { describe, expect, it } from 'vitest'
import type { GoogleConnectionStatus } from '#/contexts/integration/application/public-api'
import {
  NEW_GOOGLE_CONNECTION_AUTHORIZATION,
  reauthorizationForConnection,
} from './google-connection-authorization'

describe('Google connection settings authorization actions', () => {
  it('starts a normal connection as an untargeted Organization-owned ceremony', () => {
    expect(NEW_GOOGLE_CONNECTION_AUTHORIZATION).toEqual({
      visibility: 'organization',
      connectionMode: 'new',
      targetConnectionId: null,
    })
  })

  it('targets only the exact connection that requires reauthorization', () => {
    expect(
      reauthorizationForConnection({
        id: 'connection-7',
        status: 'reauth_required',
      }),
    ).toEqual({
      visibility: 'organization',
      connectionMode: 'reauth',
      targetConnectionId: 'connection-7',
    })
  })

  it.each<GoogleConnectionStatus>([
    'pending',
    'active',
    'degraded',
    'disconnecting',
    'disconnected',
    'failed',
  ])('does not offer reauthorization for %s connections', (status) => {
    expect(reauthorizationForConnection({ id: 'connection-7', status })).toBeNull()
  })
})
