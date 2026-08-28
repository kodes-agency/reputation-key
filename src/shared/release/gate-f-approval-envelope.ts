/**
 * The authenticated Gate F approval envelope (REL-01-T7).
 *
 * Before this module `approverIdentity` was a string. Anyone who could write
 * the Gate F index could write `"counsel"` next to a digest and the bundle
 * validated. The strongest control in REL-01 — "counsel and operating owners
 * have signed that exact behaviour" — was a typed-in name.
 *
 * The design, mirroring `googleContentRoleSignaturePayload` in
 * `src/shared/auth/google-content-approval.ts`:
 *
 * - the canonical signature payload covers EXACTLY the six decision-bearing
 *   fields. Nothing else is signed, so nothing else can be smuggled into the
 *   signature, and every one of the six is load-bearing;
 * - `gateFDecisionSha256` is the digest of the Gate F index WITHOUT its
 *   approvals. That is what an approver actually reads: the release identity,
 *   the eighteen gates, the findings register and the cohort. Including the
 *   approvals would make the payload self-referential and unsignable;
 * - verification is fail-CLOSED at every step. No verifier, no enrolled key
 *   for the role, a key that is not the role's key, or a signature that does
 *   not check out are all rejections, each with a distinct code;
 * - this repository holds PUBLIC keys only. There is no signing function here
 *   and no code path that reads a private key. `scripts/release/prepare-gate-f-approval.ts`
 *   prints the bytes; the human signs them with a key this repository never
 *   sees.
 */

import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import { z } from 'zod/v4'
import {
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256Schema,
  releaseEvidenceTimestampSchema,
} from './candidate-bound-evidence'

export const GATE_F_APPROVAL_ENVELOPE_VERSION = 'repkey-gate-f-approval-1' as const
export const GATE_F_APPROVAL_ROLE_KEYS_VERSION = 'repkey-gate-f-approval-roles-1' as const

export const GATE_F_APPROVAL_ROLES = [
  'counsel',
  'founder',
  'operations',
  'product',
  'security',
  'support_incident',
] as const
export type GateFApprovalRole = (typeof GATE_F_APPROVAL_ROLES)[number]

/**
 * Roles that engineering holds. None of them may stand in for counsel: the
 * counsel signature is the one that says the beta is lawful to run, and an
 * engineer signing it is self-approval regardless of intent.
 */
export const GATE_F_ENGINEERING_ROLES = ['operations', 'product', 'security'] as const

/** The exact signed field set. Order is irrelevant; the encoder sorts keys. */
export const GATE_F_APPROVAL_SIGNED_FIELDS = [
  'approvedAt',
  'approverIdentity',
  'gateFDecisionSha256',
  'legalRevisionSetSha256',
  'releaseManifestSha256',
  'role',
] as const

export type GateFApprovalSignedPayload = Readonly<{
  role: GateFApprovalRole
  approverIdentity: string
  approvedAt: string
  releaseManifestSha256: string
  legalRevisionSetSha256: string
  gateFDecisionSha256: string
}>

const PEM_PUBLIC_HEADER = '-----BEGIN PUBLIC KEY-----'

const approvalEnvelopeSchema = z
  .object({
    version: z.literal(GATE_F_APPROVAL_ENVELOPE_VERSION),
    evidenceKind: z.literal('gate-f-approval'),
    role: z.enum(GATE_F_APPROVAL_ROLES),
    approverIdentity: releaseEvidenceIdentitySchema,
    approvedAt: releaseEvidenceTimestampSchema,
    releaseManifestSha256: releaseEvidenceSha256Schema,
    legalRevisionSetSha256: releaseEvidenceSha256Schema,
    gateFDecisionSha256: releaseEvidenceSha256Schema,
    /** SPKI-DER digest of the signing key, so an unknown key is NAMED. */
    publicKeySha256: releaseEvidenceSha256Schema,
    signatureAlgorithm: z.literal('ed25519'),
    signature: z
      .string()
      .min(64)
      .max(512)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/u, 'must be base64'),
  })
  .strict()

export type GateFApprovalEnvelope = z.infer<typeof approvalEnvelopeSchema>

const enrolledRoleKeySchema = z
  .object({
    status: z.literal('enrolled'),
    custodian: releaseEvidenceIdentitySchema,
    enrolledAt: releaseEvidenceTimestampSchema,
    publicKeyPem: z
      .string()
      .min(PEM_PUBLIC_HEADER.length)
      .max(16_384)
      .refine(
        (value) => value.startsWith(PEM_PUBLIC_HEADER),
        'must be a PEM SubjectPublicKeyInfo block',
      ),
    publicKeySha256: releaseEvidenceSha256Schema,
  })
  .strict()

const notEnrolledRoleKeySchema = z
  .object({
    status: z.literal('not_enrolled'),
    custodian: releaseEvidenceIdentitySchema,
    note: z.string().trim().min(1).max(1024),
  })
  .strict()

const roleKeySchema = z.discriminatedUnion('status', [
  enrolledRoleKeySchema,
  notEnrolledRoleKeySchema,
])

/**
 * Roles that must not share a key with counsel or founder.
 *
 * "Engineering cannot self-approve this gate" was a sentence in the program and
 * a constant in this file with no consumer, which meant one keypair enrolled
 * for both `security` and `counsel` would have satisfied both approvals. The
 * refinement below is what makes the sentence true.
 */
const INDEPENDENT_OF_ENGINEERING = ['counsel', 'founder'] as const

const roleKeyMapSchema = z
  .object({
    version: z.literal(GATE_F_APPROVAL_ROLE_KEYS_VERSION),
    roles: z
      .object({
        counsel: roleKeySchema,
        founder: roleKeySchema,
        operations: roleKeySchema,
        product: roleKeySchema,
        security: roleKeySchema,
        support_incident: roleKeySchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const enrolled = Object.entries(value.roles).filter(
      ([, key]) => key.status === 'enrolled',
    ) as ReadonlyArray<
      [string, Extract<z.infer<typeof roleKeySchema>, { status: 'enrolled' }>]
    >

    // One key per role. A shared key makes six approvals one approval.
    const byDigest = new Map<string, string[]>()
    for (const [role, key] of enrolled) {
      byDigest.set(key.publicKeySha256, [
        ...(byDigest.get(key.publicKeySha256) ?? []),
        role,
      ])
    }
    for (const [digest, roles] of byDigest) {
      if (roles.length > 1) {
        ctx.addIssue({
          code: 'custom',
          message: `key ${digest} is enrolled for more than one role (${roles.sort().join(', ')}); each role must sign with its own key`,
        })
      }
    }

    // Belt and braces: name the engineering/counsel collision explicitly, so a
    // future reader sees the rule rather than inferring it from distinctness.
    const engineeringDigests = new Set(
      enrolled
        .filter(([role]) =>
          (GATE_F_ENGINEERING_ROLES as readonly string[]).includes(role),
        )
        .map(([, key]) => key.publicKeySha256),
    )
    for (const role of INDEPENDENT_OF_ENGINEERING) {
      const key = value.roles[role]
      if (key.status === 'enrolled' && engineeringDigests.has(key.publicKeySha256)) {
        ctx.addIssue({
          code: 'custom',
          message: `the ${role} key is also enrolled for an engineering role; engineering cannot approve on behalf of ${role}`,
        })
      }
    }
  })

export type GateFApprovalRoleKeys = z.infer<typeof roleKeyMapSchema>

/**
 * Canonical JSON: sorted keys, no whitespace. Byte-identical output for
 * byte-identical facts, so a signature over these bytes means one thing.
 */
function canonicalPayloadJson(payload: GateFApprovalSignedPayload): string {
  const record = payload as unknown as Readonly<Record<string, string>>
  return `{${GATE_F_APPROVAL_SIGNED_FIELDS.map(
    (field) => `${JSON.stringify(field)}:${JSON.stringify(record[field])}`,
  ).join(',')}}`
}

/** The exact bytes an approver signs. */
export function gateFApprovalSignaturePayload(
  payload: GateFApprovalSignedPayload,
): Buffer {
  return Buffer.from(canonicalPayloadJson(payload), 'utf8')
}

export function gateFApprovalPayloadSha256(payload: GateFApprovalSignedPayload): string {
  return createHash('sha256').update(gateFApprovalSignaturePayload(payload)).digest('hex')
}

/** SPKI-DER fingerprint of a PEM public key; the identity of the key itself. */
export function gateFApprovalPublicKeySha256(publicKeyPem: string): string {
  const der = createPublicKey(publicKeyPem).export({ type: 'spki', format: 'der' })
  return createHash('sha256').update(der).digest('hex')
}

export function parseGateFApprovalRoleKeys(
  input: unknown,
):
  | Readonly<{ ok: true; roleKeys: GateFApprovalRoleKeys }>
  | Readonly<{ ok: false; errors: readonly string[] }> {
  const parsed = roleKeyMapSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'roleKeys'}: ${issue.message}`,
      ),
    }
  }
  return { ok: true, roleKeys: parsed.data }
}

export function parseGateFApprovalEnvelope(
  content: string,
):
  | Readonly<{ ok: true; envelope: GateFApprovalEnvelope }>
  | Readonly<{ ok: false; errors: readonly string[] }> {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['Gate F approval envelope is not valid JSON'] }
  }
  const parsed = approvalEnvelopeSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'approval'}: ${issue.message}`,
      ),
    }
  }
  return { ok: true, envelope: parsed.data }
}

export const GATE_F_APPROVAL_FAILURE_CODES = [
  'role_key_not_enrolled',
  'unknown_key',
  'unsigned',
  'signature_invalid',
] as const
export type GateFApprovalFailureCode = (typeof GATE_F_APPROVAL_FAILURE_CODES)[number]

export type GateFApprovalVerification =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: GateFApprovalFailureCode; message: string }>

export type GateFApprovalVerifier = (
  envelope: GateFApprovalEnvelope,
) => GateFApprovalVerification

/**
 * Fail-closed verifier. Every rejection carries a distinct code so a bundle
 * signed with the wrong role's key reads differently from a tampered payload.
 */
export function createGateFApprovalVerifier(
  roleKeys: GateFApprovalRoleKeys,
): GateFApprovalVerifier {
  return (envelope) => {
    const roleKey = roleKeys.roles[envelope.role]
    if (roleKey.status !== 'enrolled') {
      return {
        ok: false,
        code: 'role_key_not_enrolled',
        message: `no enrolled public key for role ${envelope.role} (custodian ${roleKey.custodian})`,
      }
    }
    if (envelope.signature.length === 0) {
      return { ok: false, code: 'unsigned', message: 'approval carries no signature' }
    }
    if (envelope.publicKeySha256 !== roleKey.publicKeySha256) {
      return {
        ok: false,
        code: 'unknown_key',
        message: `approval is signed by key ${envelope.publicKeySha256}, which is not the enrolled key for role ${envelope.role}`,
      }
    }
    let verified: boolean
    try {
      verified = verifySignature(
        null,
        gateFApprovalSignaturePayload(envelope),
        createPublicKey(roleKey.publicKeyPem),
        Buffer.from(envelope.signature, 'base64'),
      )
    } catch {
      verified = false
    }
    return verified
      ? { ok: true }
      : {
          ok: false,
          code: 'signature_invalid',
          message: `signature does not cover this approval payload for role ${envelope.role}`,
        }
  }
}

/** The tracked role key map, relative to the repository root. */
export const GATE_F_APPROVAL_ROLE_KEYS_PATH = 'security/gate-f-approval-roles.json'
