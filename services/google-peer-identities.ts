import type { DetailedPeerCertificate } from 'node:tls'
import {
  createExactSpiffePeerIdentityResolver,
  type InternalPeerIdentityResolver,
} from './internal-mtls'

export const GOOGLE_WEB_IDENTITY = 'spiffe://repkey.internal/repkey-web'
export const GOOGLE_WORKER_IDENTITY = 'spiffe://repkey.internal/repkey-worker'
export const GOOGLE_HEALTHCHECK_IDENTITY = 'spiffe://repkey.internal/google-healthcheck'
export const GOOGLE_EGRESS_GATEWAY_IDENTITY =
  'spiffe://repkey.internal/google-egress-gateway'

const APPROVED_EGRESS_CALLERS: ReadonlySet<string> = new Set([
  GOOGLE_WEB_IDENTITY,
  GOOGLE_WORKER_IDENTITY,
])

const composeResolvers =
  (
    resolvers: ReadonlyArray<InternalPeerIdentityResolver>,
  ): InternalPeerIdentityResolver =>
  (certificate: DetailedPeerCertificate) => {
    for (const resolve of resolvers) {
      const identity = resolve(certificate)
      if (identity !== null) return identity
    }
    return null
  }

const clientPeer = (uri: string): InternalPeerIdentityResolver =>
  createExactSpiffePeerIdentityResolver({
    uri,
    dnsName: null,
    extendedKeyUsages: ['clientAuth'],
  })

export const createGoogleEgressPeerIdentityResolver = (): InternalPeerIdentityResolver =>
  composeResolvers([
    clientPeer(GOOGLE_WEB_IDENTITY),
    clientPeer(GOOGLE_WORKER_IDENTITY),
    clientPeer(GOOGLE_HEALTHCHECK_IDENTITY),
  ])

export const createGoogleAdmissionPeerIdentityResolver =
  (): InternalPeerIdentityResolver =>
    composeResolvers([
      createExactSpiffePeerIdentityResolver({
        uri: GOOGLE_EGRESS_GATEWAY_IDENTITY,
        dnsName: 'google-egress-gateway',
        extendedKeyUsages: ['clientAuth', 'serverAuth'],
      }),
      clientPeer(GOOGLE_HEALTHCHECK_IDENTITY),
    ])

export const parseGoogleEgressCallerIdentities = (raw: string): ReadonlySet<string> => {
  const values = raw.split(',').map((value) => value.trim())
  const unique = new Set(values)
  if (
    values.length === 0 ||
    values.some((value) => !APPROVED_EGRESS_CALLERS.has(value)) ||
    unique.size !== values.length
  ) {
    throw new Error('egress-gateway caller identities are invalid')
  }
  return unique
}

export const assertGoogleEgressGatewayIdentity = (
  value: string,
): typeof GOOGLE_EGRESS_GATEWAY_IDENTITY => {
  if (value !== GOOGLE_EGRESS_GATEWAY_IDENTITY) {
    throw new Error('execution-admission gateway identity is invalid')
  }
  return value
}
