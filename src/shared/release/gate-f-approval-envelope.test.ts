import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GATE_F_APPROVAL_ENVELOPE_VERSION,
  GATE_F_APPROVAL_ROLES,
  GATE_F_APPROVAL_ROLE_KEYS_PATH,
  GATE_F_APPROVAL_SIGNED_FIELDS,
  createGateFApprovalVerifier,
  gateFApprovalPublicKeySha256,
  gateFApprovalSignaturePayload,
  parseGateFApprovalEnvelope,
  parseGateFApprovalRoleKeys,
  type GateFApprovalEnvelope,
} from './gate-f-approval-envelope'
import { gateFApprovalKeyRing } from './gate-f-complete-evidence.test-fixtures'

const ROOT = resolve(import.meta.dirname, '../../..')

const PAYLOAD = {
  role: 'counsel' as const,
  approverIdentity: 'A. Counsel',
  approvedAt: '2026-08-28T11:00:00.000Z',
  releaseManifestSha256: 'a'.repeat(64),
  legalRevisionSetSha256: 'b'.repeat(64),
  gateFDecisionSha256: 'c'.repeat(64),
}

function envelopeFor(
  keyRing: ReturnType<typeof gateFApprovalKeyRing>,
  overrides: Partial<GateFApprovalEnvelope> = {},
): GateFApprovalEnvelope {
  const role = overrides.role ?? PAYLOAD.role
  const entry = keyRing.roleKeys.roles[role]
  if (entry.status !== 'enrolled') throw new Error('fixture key not enrolled')
  return {
    version: GATE_F_APPROVAL_ENVELOPE_VERSION,
    evidenceKind: 'gate-f-approval',
    ...PAYLOAD,
    role,
    publicKeySha256: entry.publicKeySha256,
    signatureAlgorithm: 'ed25519',
    signature: keyRing.sign(role, gateFApprovalSignaturePayload({ ...PAYLOAD, role })),
    ...overrides,
  }
}

describe('Gate F approval signature payload', () => {
  it('covers exactly the six decision-bearing fields', () => {
    expect([...GATE_F_APPROVAL_SIGNED_FIELDS].sort()).toEqual([
      'approvedAt',
      'approverIdentity',
      'gateFDecisionSha256',
      'legalRevisionSetSha256',
      'releaseManifestSha256',
      'role',
    ])
    const encoded = gateFApprovalSignaturePayload(PAYLOAD).toString('utf8')

    expect(JSON.parse(encoded)).toEqual(PAYLOAD)
    expect(Object.keys(JSON.parse(encoded) as object)).toEqual([
      ...GATE_F_APPROVAL_SIGNED_FIELDS,
    ])
  })

  it.each(Object.keys(PAYLOAD))(
    'invalidates the signature when %s changes by one byte',
    (field) => {
      const keyRing = gateFApprovalKeyRing()
      const verify = createGateFApprovalVerifier(keyRing.roleKeys)
      const envelope = envelopeFor(keyRing)

      expect(verify(envelope)).toEqual({ ok: true })

      const current = envelope[field as keyof GateFApprovalEnvelope] as string
      const tampered =
        field === 'role'
          ? envelope
          : {
              ...envelope,
              [field]: `${current.slice(0, -1)}${current.endsWith('0') ? '1' : '0'}`,
            }
      if (field === 'role') {
        // `role` cannot be flipped without also changing the enrolled key, so
        // the substitution is caught one step earlier, as an unknown key.
        const other = { ...envelope, role: 'founder' as const }
        expect(verify(other)).toMatchObject({ ok: false, code: 'unknown_key' })
        return
      }
      expect(verify(tampered as GateFApprovalEnvelope)).toMatchObject({
        ok: false,
        code: 'signature_invalid',
      })
    },
  )
})

describe('Gate F approval verification', () => {
  it('rejects an approval signed by a key not mapped to that role', () => {
    const keyRing = gateFApprovalKeyRing()
    const verify = createGateFApprovalVerifier(keyRing.roleKeys)
    const payload = gateFApprovalSignaturePayload(PAYLOAD)
    const envelope = envelopeFor(keyRing, {
      publicKeySha256: keyRing.strangerPublicKeySha256,
      signature: keyRing.signWithStranger(payload),
    })

    expect(verify(envelope)).toMatchObject({ ok: false, code: 'unknown_key' })
  })

  it('rejects an approval signed by another ROLE key', () => {
    const keyRing = gateFApprovalKeyRing()
    const verify = createGateFApprovalVerifier(keyRing.roleKeys)
    const envelope = envelopeFor(keyRing, {
      signature: keyRing.sign('operations', gateFApprovalSignaturePayload(PAYLOAD)),
    })

    expect(verify(envelope)).toMatchObject({ ok: false, code: 'signature_invalid' })
  })

  it('rejects an approval whose signature is not real', () => {
    const keyRing = gateFApprovalKeyRing()
    const verify = createGateFApprovalVerifier(keyRing.roleKeys)

    expect(verify(envelopeFor(keyRing, { signature: 'A'.repeat(88) }))).toMatchObject({
      ok: false,
      code: 'signature_invalid',
    })
  })

  it('fails closed for a role with no enrolled key', () => {
    const keyRing = gateFApprovalKeyRing()
    const verify = createGateFApprovalVerifier({
      ...keyRing.roleKeys,
      roles: {
        ...keyRing.roleKeys.roles,
        counsel: {
          status: 'not_enrolled',
          custodian: 'external-counsel-of-record',
          note: 'counsel has not enrolled a key',
        },
      },
    })

    expect(verify(envelopeFor(keyRing))).toMatchObject({
      ok: false,
      code: 'role_key_not_enrolled',
    })
  })

  it('refuses a malformed envelope rather than guessing', () => {
    expect(parseGateFApprovalEnvelope('not json')).toMatchObject({ ok: false })
    expect(parseGateFApprovalEnvelope('{"role":"counsel"}')).toMatchObject({ ok: false })
  })
})

describe('security/gate-f-approval-roles.json', () => {
  const raw = readFileSync(resolve(ROOT, GATE_F_APPROVAL_ROLE_KEYS_PATH), 'utf8')

  const enrolled = (custodian: string, digest: string) => ({
    status: 'enrolled' as const,
    custodian,
    enrolledAt: '2026-08-29T00:00:00.000Z',
    publicKeyPem: `-----BEGIN PUBLIC KEY-----\n${'A'.repeat(60)}\n-----END PUBLIC KEY-----`,
    publicKeySha256: digest,
  })
  const notEnrolled = (custodian: string) => ({
    status: 'not_enrolled' as const,
    custodian,
    note: 'awaiting enrolment',
  })
  const roleMap = (
    overrides: Partial<Record<(typeof GATE_F_APPROVAL_ROLES)[number], unknown>>,
  ) => ({
    version: 'repkey-gate-f-approval-roles-1',
    roles: {
      counsel: notEnrolled('counsel'),
      founder: notEnrolled('founder'),
      operations: notEnrolled('operations'),
      product: notEnrolled('product'),
      security: notEnrolled('security'),
      support_incident: notEnrolled('support'),
      ...overrides,
    },
  })

  it('refuses one key enrolled for two roles — six approvals would be one approval', () => {
    const shared = 'a'.repeat(64)
    const parsed = parseGateFApprovalRoleKeys(
      roleMap({
        operations: enrolled('same person', shared),
        product: enrolled('same person', shared),
      }),
    )

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toMatch(/enrolled for more than one role/u)
    }
  })

  it('refuses an engineering key standing in for counsel', () => {
    // The program says engineering cannot self-approve the legal gate. Before
    // this refinement that was a sentence, not a control.
    const shared = 'b'.repeat(64)
    const parsed = parseGateFApprovalRoleKeys(
      roleMap({
        security: enrolled('an engineer', shared),
        counsel: enrolled('an engineer', shared),
      }),
    )

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.errors.join('\n')).toMatch(
        /engineering cannot approve on behalf of counsel/u,
      )
    }
  })

  it('accepts distinct keys per role', () => {
    const parsed = parseGateFApprovalRoleKeys(
      roleMap({
        counsel: enrolled('external counsel', 'c'.repeat(64)),
        security: enrolled('security owner', 'd'.repeat(64)),
      }),
    )

    expect(parsed.ok ? [] : parsed.errors).toEqual([])
  })

  it('parses and names every required role', () => {
    const parsed = parseGateFApprovalRoleKeys(JSON.parse(raw))

    expect(parsed.ok).toBe(true)
    if (parsed.ok) {
      expect(Object.keys(parsed.roleKeys.roles).sort()).toEqual(
        [...GATE_F_APPROVAL_ROLES].sort(),
      )
    }
  })

  it('contains PUBLIC keys only — no private key material of any kind', () => {
    // The whole control collapses if a signing key ever lands in the tree, so
    // this is checked at the BYTES, not at the schema.
    expect(raw).not.toMatch(/PRIVATE KEY/u)
    expect(raw).not.toMatch(/BEGIN OPENSSH PRIVATE/u)
    // An Ed25519 seed is 32 bytes; base64 (44 chars) or hex (64 chars) both
    // decode to exactly 32 bytes and neither may appear here.
    for (const candidate of raw.match(/[A-Za-z0-9+/]{40,}={0,2}/gu) ?? []) {
      const decoded = Buffer.from(candidate, 'base64')
      expect(decoded.length).not.toBe(32)
      expect(decoded.length).not.toBe(64)
    }
    for (const candidate of raw.match(/\b[0-9a-fA-F]{64}\b/gu) ?? []) {
      expect(candidate).toBe('there must be no 32-byte hex seed in this file')
    }
  })

  it('ships fail-closed: no role is enrolled until a human enrols one', () => {
    // This is the honest default. Until counsel and the operating owners
    // enrol real public keys, every Gate F bundle fails on approvals — which
    // is exactly the state of the program today.
    const parsed = parseGateFApprovalRoleKeys(JSON.parse(raw))

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    for (const role of GATE_F_APPROVAL_ROLES) {
      expect(parsed.roleKeys.roles[role].status).toBe('not_enrolled')
    }
  })
})

describe('public key fingerprints', () => {
  it('are the sha256 of the SPKI DER, so two roles cannot share an identity', () => {
    const keyRing = gateFApprovalKeyRing()
    const fingerprints = GATE_F_APPROVAL_ROLES.map((role) => {
      const entry = keyRing.roleKeys.roles[role]
      if (entry.status !== 'enrolled') throw new Error('fixture key not enrolled')
      expect(gateFApprovalPublicKeySha256(entry.publicKeyPem)).toBe(entry.publicKeySha256)
      return entry.publicKeySha256
    })

    expect(new Set(fingerprints).size).toBe(GATE_F_APPROVAL_ROLES.length)
  })
})
