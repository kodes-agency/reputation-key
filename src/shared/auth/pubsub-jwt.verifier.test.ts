// Unit tests for Pub/Sub JWT verification utility
// Tests: successful verification, audience validation, issuer validation, error propagation.
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock jose module
const mockJwtVerify = vi.fn()
const mockCreateRemoteJWKSet = vi.fn()

vi.mock('jose', () => ({
  jwtVerify: mockJwtVerify,
  createRemoteJWKSet: mockCreateRemoteJWKSet,
}))

// Import after mocking — need dynamic import to get fresh module each time
// since the verifier caches the JWKS at module level.
async function importVerifier() {
  // Reset module cache to clear the cached jwks variable
  vi.resetModules()
  return await import('./pubsub-jwt.verifier')
}

const TOKEN = 'fake.jwt.token'
const AUDIENCE = 'https://reputationkey.app/webhooks/gbp'

describe('verifyPubSubJwt', () => {
  beforeEach(() => {
    mockJwtVerify.mockReset()
    mockCreateRemoteJWKSet.mockReset()
    mockCreateRemoteJWKSet.mockReturnValue({} as never)
  })

  it('returns decoded payload fields on successful verification', async () => {
    const { verifyPubSubJwt } = await importVerifier()

    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: '123456789',
        email: 'pubsub-notifications@google.com',
        aud: AUDIENCE,
        iat: 1700000000,
        exp: 1700003600,
      },
    })

    const result = await verifyPubSubJwt(TOKEN, AUDIENCE)

    expect(result).toEqual({
      sub: '123456789',
      email: 'pubsub-notifications@google.com',
      aud: AUDIENCE,
      iat: 1700000000,
      exp: 1700003600,
    })
  })

  it('passes correct issuer and audience to jwtVerify', async () => {
    const { verifyPubSubJwt } = await importVerifier()

    mockJwtVerify.mockResolvedValueOnce({
      payload: { sub: 'sub', email: 'email', aud: AUDIENCE, iat: 1, exp: 2 },
    })

    await verifyPubSubJwt(TOKEN, AUDIENCE)

    expect(mockJwtVerify).toHaveBeenCalledWith(
      TOKEN,
      expect.any(Object),
      {
        issuer: 'https://accounts.google.com',
        audience: AUDIENCE,
        clockTolerance: '30s',
      },
    )
  })

  it('uses defaults for missing payload fields', async () => {
    const { verifyPubSubJwt } = await importVerifier()

    mockJwtVerify.mockResolvedValueOnce({
      payload: {
        sub: undefined,
        email: undefined,
        aud: undefined,
        iat: undefined,
        exp: undefined,
      },
    })

    const result = await verifyPubSubJwt(TOKEN, AUDIENCE)

    expect(result).toEqual({
      sub: '',
      email: '',
      aud: '',
      iat: 0,
      exp: 0,
    })
  })

  it('propagates jwtVerify errors (invalid token)', async () => {
    const { verifyPubSubJwt } = await importVerifier()

    mockJwtVerify.mockRejectedValueOnce(new Error('JWT expired'))

    await expect(verifyPubSubJwt(TOKEN, AUDIENCE)).rejects.toThrow('JWT expired')
  })

  it('propagates jwtVerify errors (wrong audience)', async () => {
    const { verifyPubSubJwt } = await importVerifier()

    mockJwtVerify.mockRejectedValueOnce(new Error('unexpected "aud" claim'))

    await expect(verifyPubSubJwt(TOKEN, 'wrong-audience')).rejects.toThrow('unexpected "aud" claim')
  })

  it('propagates jwtVerify errors (wrong issuer)', async () => {
    const { verifyPubSubJwt } = await importVerifier()

    mockJwtVerify.mockRejectedValueOnce(new Error('unexpected "iss" claim'))

    await expect(verifyPubSubJwt(TOKEN, AUDIENCE)).rejects.toThrow('unexpected "iss" claim')
  })

  it('caches JWKS and reuses it within TTL', async () => {
    vi.useFakeTimers()
    const { verifyPubSubJwt } = await importVerifier()

    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'sub', email: 'email', aud: AUDIENCE, iat: 1, exp: 2 },
    })

    // First call creates the JWKS
    await verifyPubSubJwt(TOKEN, AUDIENCE)
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1)

    // Second call reuses cached JWKS
    await verifyPubSubJwt(TOKEN, AUDIENCE)
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1) // still 1

    vi.useRealTimers()
  })

  it('refreshes JWKS after TTL expires', async () => {
    vi.useFakeTimers()
    const { verifyPubSubJwt } = await importVerifier()

    mockJwtVerify.mockResolvedValue({
      payload: { sub: 'sub', email: 'email', aud: AUDIENCE, iat: 1, exp: 2 },
    })

    // First call
    await verifyPubSubJwt(TOKEN, AUDIENCE)
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1)

    // Advance time past the 24h TTL
    vi.advanceTimersByTime(24 * 60 * 60 * 1000 + 1)

    // Should create a new JWKS
    await verifyPubSubJwt(TOKEN, AUDIENCE)
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})
