import type { DetailedPeerCertificate } from 'node:tls'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  GOOGLE_EGRESS_GATEWAY_IDENTITY,
  GOOGLE_HEALTHCHECK_IDENTITY,
  GOOGLE_WEB_IDENTITY,
  GOOGLE_WORKER_IDENTITY,
  assertGoogleEgressGatewayIdentity,
  createGoogleAdmissionPeerIdentityResolver,
  createGoogleEgressPeerIdentityResolver,
  parseGoogleEgressCallerIdentities,
} from './google-peer-identities'

const certificate = (
  altNames: string,
  usages: ReadonlyArray<string>,
): DetailedPeerCertificate =>
  ({
    subjectaltname: altNames,
    ext_key_usage: [...usages],
    subject: { CN: 'legacy-common-name-must-not-authorize' },
  }) as unknown as DetailedPeerCertificate

const CLIENT_AUTH = ['1.3.6.1.5.5.7.3.2'] as const
const DUAL_USE = ['1.3.6.1.5.5.7.3.1', '1.3.6.1.5.5.7.3.2'] as const

describe('Google sidecar peer identities', () => {
  it('accepts only exact web, worker, and healthcheck client certificates at egress', () => {
    const resolve = createGoogleEgressPeerIdentityResolver()

    for (const identity of [
      GOOGLE_WEB_IDENTITY,
      GOOGLE_WORKER_IDENTITY,
      GOOGLE_HEALTHCHECK_IDENTITY,
    ]) {
      expect(resolve(certificate(`URI:${identity}`, CLIENT_AUTH))).toBe(identity)
    }
    expect(resolve(certificate('', CLIENT_AUTH))).toBeNull()
    expect(
      resolve(certificate(`DNS:repkey-web, URI:${GOOGLE_WEB_IDENTITY}`, CLIENT_AUTH)),
    ).toBeNull()
    expect(resolve(certificate(`URI:${GOOGLE_WEB_IDENTITY}`, DUAL_USE))).toBeNull()
  })

  it('accepts only the exact dual-use gateway or healthcheck at admission', () => {
    const resolve = createGoogleAdmissionPeerIdentityResolver()

    expect(
      resolve(
        certificate(
          `DNS:google-egress-gateway, URI:${GOOGLE_EGRESS_GATEWAY_IDENTITY}`,
          DUAL_USE,
        ),
      ),
    ).toBe(GOOGLE_EGRESS_GATEWAY_IDENTITY)
    expect(resolve(certificate(`URI:${GOOGLE_HEALTHCHECK_IDENTITY}`, CLIENT_AUTH))).toBe(
      GOOGLE_HEALTHCHECK_IDENTITY,
    )
    expect(
      resolve(
        certificate(`DNS:google-egress-gateway, URI:${GOOGLE_EGRESS_GATEWAY_IDENTITY}`, [
          '1.3.6.1.5.5.7.3.1',
        ]),
      ),
    ).toBeNull()
    expect(resolve(certificate('', DUAL_USE))).toBeNull()
  })

  it('allows deployment configuration to select only known workload callers', () => {
    expect(
      parseGoogleEgressCallerIdentities(
        `${GOOGLE_WEB_IDENTITY},${GOOGLE_WORKER_IDENTITY}`,
      ),
    ).toEqual(new Set([GOOGLE_WEB_IDENTITY, GOOGLE_WORKER_IDENTITY]))
    expect(() => parseGoogleEgressCallerIdentities('repkey-web-e2e')).toThrow(
      /caller identities/i,
    )
    expect(() => parseGoogleEgressCallerIdentities(GOOGLE_HEALTHCHECK_IDENTITY)).toThrow(
      /caller identities/i,
    )
  })

  it('refuses a non-SPIFFE gateway identity', () => {
    expect(assertGoogleEgressGatewayIdentity(GOOGLE_EGRESS_GATEWAY_IDENTITY)).toBe(
      GOOGLE_EGRESS_GATEWAY_IDENTITY,
    )
    expect(() => assertGoogleEgressGatewayIdentity('google-egress-gateway-1')).toThrow(
      /gateway identity/i,
    )
  })

  it('wires exact resolvers and SPIFFE deployment identities into both sidecars', () => {
    const egress = readFileSync('services/google-egress-gateway/index.ts', 'utf8')
    const admission = readFileSync('services/google-execution-admission/index.ts', 'utf8')
    const compose = readFileSync('compose.local.yml', 'utf8')
    const localStack = readFileSync('scripts/local-stack/stack.ts', 'utf8')

    expect(egress).toContain(
      'resolvePeerIdentity: createGoogleEgressPeerIdentityResolver()',
    )
    expect(admission).toContain(
      'resolvePeerIdentity: createGoogleAdmissionPeerIdentityResolver()',
    )
    expect(compose).not.toContain('GOOGLE_EGRESS_GATEWAY_IDENTITY: google-')
    expect(compose).toContain(GOOGLE_EGRESS_GATEWAY_IDENTITY)
    for (const identity of [
      GOOGLE_WEB_IDENTITY,
      GOOGLE_WORKER_IDENTITY,
      GOOGLE_HEALTHCHECK_IDENTITY,
    ]) {
      expect(localStack).toContain(identity)
    }
  })
})
