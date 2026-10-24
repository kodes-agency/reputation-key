// The address for websites, emails and messages (ADR 0069). The QR address counts
// a visit as a scan, so it is never turned into the public one: the server sends
// the public one as its own field.

import { describe, expect, it } from 'vitest'
import { directAddressOf } from './portal-share-state'

const SHORT_QR = 'HTTPS://AP.UP.RAILWAY.APP/p/7K3QZ0VD9MWX4HT2BN6R'

describe('directAddressOf', () => {
  it('is the server direct address, never worked out from the short print address', () => {
    // The print code stands for the marker, so a visit through the short address
    // is counted as a scan; the long address with no marker is the only one a
    // website may carry.
    expect(
      directAddressOf({
        publicUrl: SHORT_QR,
        publicUrls: { direct: 'https://portal.example.com/p/9f3c' },
      }),
    ).toBe('https://portal.example.com/p/9f3c')
  })

  it('strips the marker from a held long QR address that came with no direct one', () => {
    expect(
      directAddressOf({
        publicUrl: 'https://portal.example.com/p/9f3c?accessArtifact=art-qr-1',
      }),
    ).toBe('https://portal.example.com/p/9f3c')
  })

  it('is nothing before any address is held', () => {
    expect(directAddressOf(null)).toBeNull()
  })
})
