// Shared auth — Pub/Sub push JWT verification utility
// Google Pub/Sub push endpoints receive OIDC JWT bearer tokens.
// This verifies the token against Google's public keys.
// Moved to shared/ to allow webhook routes (in routes/) to import without
// violating architectural boundary rules.

import { createRemoteJWKSet, jwtVerify } from 'jose'

const GOOGLE_ISSUER = 'https://accounts.google.com'
const JWKS_URI = 'https://www.googleapis.com/oauth2/v3/certs'

let jwks: ReturnType<typeof createRemoteJWKSet> | undefined
let jwksCreatedAt = 0
const JWKS_CACHE_TTL = 24 * 60 * 60 * 1000 // 24 hours

const getJwks = () => {
  const now = Date.now()
  if (!jwks || (now - jwksCreatedAt) > JWKS_CACHE_TTL) {
    jwks = createRemoteJWKSet(new URL(JWKS_URI))
    jwksCreatedAt = now
  }
  return jwks
}

export type VerifiedPubSubToken = Readonly<{
  sub: string
  email: string
  aud: string
  iat: number
  exp: number
}>

export const verifyPubSubJwt = async (
  token: string,
  expectedAudience: string,
): Promise<VerifiedPubSubToken> => {
  const { payload } = await jwtVerify(token, getJwks(), {
    issuer: GOOGLE_ISSUER,
    audience: expectedAudience,
    clockTolerance: '30s',
  })

  return {
    sub: payload.sub ?? '',
    email: payload.email as string ?? '',
    aud: payload.aud as string ?? '',
    iat: payload.iat ?? 0,
    exp: payload.exp ?? 0,
  }
}
