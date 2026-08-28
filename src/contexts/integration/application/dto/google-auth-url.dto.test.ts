import { describe, expect, it } from 'vitest'
import { googleAuthUrlInputSchema } from './google-auth-url.dto'

describe('Google authorization URL input', () => {
  it('keeps a normal connection Organization-owned and untargeted', () => {
    expect(
      googleAuthUrlInputSchema.parse({
        visibility: 'organization',
        connectionMode: 'new',
        targetConnectionId: null,
      }),
    ).toEqual({
      visibility: 'organization',
      connectionMode: 'new',
      targetConnectionId: null,
    })
  })

  it('keeps the retained connect caller compatible while defaulting to new/null', () => {
    expect(googleAuthUrlInputSchema.parse({ visibility: 'organization' })).toEqual({
      visibility: 'organization',
      connectionMode: 'new',
      targetConnectionId: null,
    })
  })

  it('accepts reauthorization only with an exact target connection', () => {
    expect(
      googleAuthUrlInputSchema.parse({
        visibility: 'organization',
        connectionMode: 'reauth',
        targetConnectionId: 'connection-7',
      }),
    ).toEqual({
      visibility: 'organization',
      connectionMode: 'reauth',
      targetConnectionId: 'connection-7',
    })
  })

  it.each([
    {
      visibility: 'organization',
      connectionMode: 'new',
      targetConnectionId: 'connection-7',
    },
    {
      visibility: 'organization',
      connectionMode: 'reauth',
      targetConnectionId: null,
    },
    {
      visibility: 'organization',
      connectionMode: 'reauth',
      targetConnectionId: '',
    },
    {
      visibility: 'organization',
      connectionMode: 'reconnect',
      targetConnectionId: 'connection-7',
    },
    {
      visibility: 'private',
      connectionMode: 'new',
      targetConnectionId: null,
    },
  ])('rejects an unsupported or inconsistent ceremony: %#', (input) => {
    expect(googleAuthUrlInputSchema.safeParse(input).success).toBe(false)
  })
})
