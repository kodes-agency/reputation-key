import { describe, expect, it } from 'vitest'
import { googleAuthUrlInputSchema } from './google-auth-url.contracts'

describe('Google authorization URL input', () => {
  it('keeps a normal connection Organization-owned and untargeted', () => {
    expect(
      googleAuthUrlInputSchema.parse({
        connectionMode: 'new',
        targetConnectionId: null,
      }),
    ).toEqual({
      connectionMode: 'new',
      targetConnectionId: null,
    })
  })

  it('defaults to new/null when the caller sends nothing', () => {
    expect(googleAuthUrlInputSchema.parse({})).toEqual({
      connectionMode: 'new',
      targetConnectionId: null,
    })
  })

  it('accepts reauthorization only with an exact target connection', () => {
    expect(
      googleAuthUrlInputSchema.parse({
        connectionMode: 'reauth',
        targetConnectionId: 'connection-7',
      }),
    ).toEqual({
      connectionMode: 'reauth',
      targetConnectionId: 'connection-7',
    })
  })

  it.each([
    {
      connectionMode: 'new',
      targetConnectionId: 'connection-7',
    },
    {
      connectionMode: 'reauth',
      targetConnectionId: null,
    },
    {
      connectionMode: 'reauth',
      targetConnectionId: '',
    },
    {
      connectionMode: 'reconnect',
      targetConnectionId: 'connection-7',
    },
    {
      // The retired field is no longer an input.
      visibility: 'organization',
      connectionMode: 'new',
      targetConnectionId: null,
    },
  ])('rejects an unsupported or inconsistent ceremony: %#', (input) => {
    expect(googleAuthUrlInputSchema.safeParse(input).success).toBe(false)
  })
})
