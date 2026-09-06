import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto'
import { z } from 'zod/v4'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'

export const REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION =
  'review-lifecycle-recovery-approval-v1' as const

const MAX_APPROVAL_WINDOW_MS = 24 * 60 * 60 * 1_000
const SHA = /^[0-9a-f]{40}$/u
const SHA256 = /^[0-9a-f]{64}$/u
const SUBJECT = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,254}$/u
const APPROVAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u
const KEY_ID = /^[a-z][a-z0-9_-]{0,63}$/u
const CANONICAL_BASE64 = /^[A-Za-z0-9+/]+={0,2}$/u
const MAX_TRUSTED_KEYS = 4
const ED25519_SPKI_DER_BYTES = 44

const instant = z.iso.datetime({ offset: true })
const sha = z.string().regex(SHA)
const sha256 = z.string().regex(SHA256)
const subject = z.string().regex(SUBJECT)
const postgresPositiveInteger = z.number().int().positive().max(2_147_483_647)

const requestSchema = z
  .object({
    version: z.literal(REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION),
    kind: z.literal('review-lifecycle-recovery'),
    target: z
      .object({
        releaseSha: sha,
        releaseManifestSha256: sha256,
        restorePointAt: instant,
        restoreDatabaseServiceName: subject,
        railwayProjectId: subject.nullable(),
        railwayEnvironmentId: subject.nullable(),
        recoveryRunId: z.uuid(),
        recoveryGeneration: postgresPositiveInteger,
      })
      .strict(),
    lifecycle: z
      .object({
        contract: z.literal('review-source-content-lifecycle-v1'),
        scope: z.object({ kind: z.literal('expired') }).strict(),
        evaluatedAt: instant,
        batchSize: z.literal(100),
        sourcePolicyVersion: postgresPositiveInteger,
        retentionPolicyVersion: postgresPositiveInteger,
        policySha256: sha256,
        reportSha256: sha256,
      })
      .strict(),
  })
  .strict()

const approvalSchema = z
  .object({
    approvalId: z.string().regex(APPROVAL_ID),
    decision: z.enum(['approved', 'denied']),
    approverIdentity: subject,
    keyId: z.string().regex(KEY_ID),
    approvedAt: instant,
    expiresAt: instant,
    requestSha256: sha256,
    signature: z.string().regex(CANONICAL_BASE64).max(512),
  })
  .strict()

const bundleSchema = z
  .object({
    request: requestSchema,
    requestSha256: sha256,
    approval: approvalSchema,
  })
  .strict()

export type ReviewLifecycleRecoveryApprovalRequest = z.infer<typeof requestSchema>
export type ReviewLifecycleRecoveryApprovalBundle = z.infer<typeof bundleSchema>
export type ReviewLifecycleRecoveryUnsignedApproval = Omit<
  ReviewLifecycleRecoveryApprovalBundle['approval'],
  'signature'
>

/** Runtime-only facts supplied by the isolated restore verifier. */
export type ReviewLifecycleRecoveryRuntimeTarget = Readonly<{
  releaseSha: string
  releaseManifestSha256: string
  restorePointAt: Date
  restoreDatabaseServiceName: string
  railwayProjectId: string | null
  railwayEnvironmentId: string | null
  operatorId: string
  correlationId: string
}>

export type ReviewLifecycleRecoveryApprovalValidationCode =
  | 'malformed_bundle'
  | 'bundle_digest_mismatch'
  | 'non_canonical_bundle'
  | 'request_digest_mismatch'
  | 'not_approved'
  | 'stale_approval'
  | 'untrusted_signer'
  | 'invalid_signature'
  | 'wrong_target'

export type ReviewLifecycleRecoveryApprovalValidationResult =
  | Readonly<{
      ok: true
      bundle: ReviewLifecycleRecoveryApprovalBundle
      bundleSha256: string
    }>
  | Readonly<{
      ok: false
      code: ReviewLifecycleRecoveryApprovalValidationCode
    }>

export type AuthenticatedReviewLifecycleRecoveryApproval = Readonly<{
  ok: true
  bundle: ReviewLifecycleRecoveryApprovalBundle
  bundleSha256: string
}>

function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function canonicalDocument(value: unknown): string {
  return `${canonicalizeRfc8785(value)}\n`
}

/** Load the restore-only trusted keyring; private/self-declared bundle keys are refused. */
export function loadReviewLifecycleRecoveryApprovalPublicKeys(
  encodedJson: string,
): ReadonlyMap<string, KeyObject> {
  let raw: unknown
  try {
    raw = JSON.parse(encodedJson)
  } catch {
    throw new Error('Review lifecycle recovery approval public keyring is invalid')
  }
  if (
    raw == null ||
    typeof raw !== 'object' ||
    Array.isArray(raw) ||
    Object.getPrototypeOf(raw) !== Object.prototype
  ) {
    throw new Error('Review lifecycle recovery approval public keyring is invalid')
  }
  const entries = Object.entries(raw as Record<string, unknown>)
  if (entries.length < 1 || entries.length > MAX_TRUSTED_KEYS) {
    throw new Error('Review lifecycle recovery approval public keyring is invalid')
  }
  const keys = new Map<string, KeyObject>()
  try {
    for (const [keyId, encoded] of entries) {
      if (
        !KEY_ID.test(keyId) ||
        keys.has(keyId) ||
        typeof encoded !== 'string' ||
        !CANONICAL_BASE64.test(encoded)
      ) {
        throw new Error('invalid key entry')
      }
      const bytes = Buffer.from(encoded, 'base64')
      try {
        if (
          bytes.byteLength !== ED25519_SPKI_DER_BYTES ||
          bytes.toString('base64') !== encoded
        ) {
          throw new Error('invalid key bytes')
        }
        const key = createPublicKey({ key: bytes, format: 'der', type: 'spki' })
        if (key.asymmetricKeyType !== 'ed25519') throw new Error('invalid key type')
        keys.set(keyId, key)
      } finally {
        bytes.fill(0)
      }
    }
    return keys
  } catch {
    throw new Error('Review lifecycle recovery approval public keyring is invalid')
  }
}

function reviewLifecycleRecoveryApprovalRequestSha256(
  request: ReviewLifecycleRecoveryApprovalRequest,
): string {
  return sha256Hex(canonicalizeRfc8785(request))
}

/** Runtime-validate and canonicalize a report-first request artifact. */
export function createReviewLifecycleRecoveryApprovalRequest(input: unknown): Readonly<{
  request: ReviewLifecycleRecoveryApprovalRequest
  content: string
  sha256: string
}> {
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    throw new Error('Review lifecycle recovery approval request is invalid')
  }
  return {
    request: parsed.data,
    content: canonicalDocument(parsed.data),
    sha256: reviewLifecycleRecoveryApprovalRequestSha256(parsed.data),
  }
}

export function reviewLifecycleRecoveryApprovalSignaturePayload(
  approval: ReviewLifecycleRecoveryUnsignedApproval,
): Buffer {
  return Buffer.from(canonicalizeRfc8785(approval), 'utf8')
}

function approvalWindowIsCurrent(
  bundle: ReviewLifecycleRecoveryApprovalBundle,
  now: Date,
): boolean {
  const evaluatedAt = Date.parse(bundle.request.lifecycle.evaluatedAt)
  const restorePointAt = Date.parse(bundle.request.target.restorePointAt)
  const approvedAt = Date.parse(bundle.approval.approvedAt)
  const expiresAt = Date.parse(bundle.approval.expiresAt)
  const current = now.getTime()
  return (
    Number.isFinite(current) &&
    restorePointAt <= evaluatedAt &&
    evaluatedAt <= approvedAt &&
    approvedAt <= current &&
    current < expiresAt &&
    expiresAt - approvedAt <= MAX_APPROVAL_WINDOW_MS
  )
}

function sameRequest(
  left: ReviewLifecycleRecoveryApprovalRequest,
  right: ReviewLifecycleRecoveryApprovalRequest,
): boolean {
  return canonicalizeRfc8785(left) === canonicalizeRfc8785(right)
}

/**
 * Validate one immutable approval bundle before the restore executor may write.
 * The caller supplies the trusted keyring and exact runtime request; neither is
 * selected from the untrusted bundle.
 */
export function authenticateReviewLifecycleRecoveryApprovalBundle(
  input: Readonly<{
    content: string
    expectedBundleSha256: string
    trustedPublicKeys: ReadonlyMap<string, KeyObject>
    now: Date
  }>,
):
  | AuthenticatedReviewLifecycleRecoveryApproval
  | Readonly<{ ok: false; code: ReviewLifecycleRecoveryApprovalValidationCode }> {
  if (!SHA256.test(input.expectedBundleSha256)) {
    return { ok: false, code: 'bundle_digest_mismatch' }
  }
  const bundleSha256 = sha256Hex(input.content)
  if (bundleSha256 !== input.expectedBundleSha256) {
    return { ok: false, code: 'bundle_digest_mismatch' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(input.content)
  } catch {
    return { ok: false, code: 'malformed_bundle' }
  }
  const parsed = bundleSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, code: 'malformed_bundle' }
  const bundle = parsed.data
  if (canonicalDocument(bundle) !== input.content) {
    return { ok: false, code: 'non_canonical_bundle' }
  }

  const requestSha256 = reviewLifecycleRecoveryApprovalRequestSha256(bundle.request)
  if (
    requestSha256 !== bundle.requestSha256 ||
    requestSha256 !== bundle.approval.requestSha256
  ) {
    return { ok: false, code: 'request_digest_mismatch' }
  }
  if (bundle.approval.decision !== 'approved') {
    return { ok: false, code: 'not_approved' }
  }
  if (!approvalWindowIsCurrent(bundle, input.now)) {
    return { ok: false, code: 'stale_approval' }
  }

  const trustedKey = input.trustedPublicKeys.get(bundle.approval.keyId)
  if (!trustedKey || trustedKey.asymmetricKeyType !== 'ed25519') {
    return { ok: false, code: 'untrusted_signer' }
  }
  const { signature, ...unsigned } = bundle.approval
  let signatureBytes: Buffer
  try {
    signatureBytes = Buffer.from(signature, 'base64')
    if (signatureBytes.toString('base64') !== signature) {
      return { ok: false, code: 'invalid_signature' }
    }
  } catch {
    return { ok: false, code: 'invalid_signature' }
  }
  try {
    if (
      !verify(
        null,
        reviewLifecycleRecoveryApprovalSignaturePayload(unsigned),
        trustedKey,
        signatureBytes,
      )
    ) {
      return { ok: false, code: 'invalid_signature' }
    }
  } catch {
    return { ok: false, code: 'invalid_signature' }
  } finally {
    signatureBytes.fill(0)
  }

  return { ok: true, bundle, bundleSha256 }
}

export function validateReviewLifecycleRecoveryApprovalBundle(
  input: Readonly<{
    content: string
    expectedBundleSha256: string
    trustedPublicKeys: ReadonlyMap<string, KeyObject>
    now: Date
    expectedRequest: ReviewLifecycleRecoveryApprovalRequest
  }>,
): ReviewLifecycleRecoveryApprovalValidationResult {
  const authenticated = authenticateReviewLifecycleRecoveryApprovalBundle(input)
  if (!authenticated.ok) return authenticated
  if (!sameRequest(authenticated.bundle.request, input.expectedRequest)) {
    return { ok: false, code: 'wrong_target' }
  }
  return authenticated
}
