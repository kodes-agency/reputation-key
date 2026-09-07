import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { canonicalizeRfc8785 } from '#/shared/canonical-json'
import {
  REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION,
  loadReviewLifecycleRecoveryApprovalPublicKeys,
  reviewLifecycleRecoveryApprovalSignaturePayload,
  validateReviewLifecycleRecoveryApprovalBundle,
  type ReviewLifecycleRecoveryApprovalBundle,
  type ReviewLifecycleRecoveryApprovalRequest,
} from './review-lifecycle-recovery-approval'

const REPORT_AT = '2026-08-28T10:00:00.000Z'
const APPROVED_AT = '2026-08-28T10:05:00.000Z'
const EXPIRES_AT = '2026-08-28T18:05:00.000Z'

const request = (): ReviewLifecycleRecoveryApprovalRequest => ({
  version: REVIEW_LIFECYCLE_RECOVERY_APPROVAL_VERSION,
  kind: 'review-lifecycle-recovery',
  target: {
    releaseSha: 'a'.repeat(40),
    releaseManifestSha256: 'b'.repeat(64),
    restorePointAt: '2026-08-28T09:00:00.000Z',
    restoreDatabaseServiceName: 'Postgres-restored-20260828-0900',
    railwayProjectId: 'project-us',
    railwayEnvironmentId: 'environment-cell-us',
    recoveryRunId: '10000000-0000-4000-8000-000000000001',
    recoveryGeneration: 7,
  },
  lifecycle: {
    contract: 'review-source-content-lifecycle-v1',
    scope: { kind: 'expired' },
    evaluatedAt: REPORT_AT,
    batchSize: 100,
    sourcePolicyVersion: 1,
    retentionPolicyVersion: 5,
    policySha256: 'c'.repeat(64),
    reportSha256: 'd'.repeat(64),
  },
})

function signedBundle(
  patch: Partial<ReviewLifecycleRecoveryApprovalBundle['approval']> = {},
) {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const approvalRequest = request()
  const requestSha256 = createHash('sha256')
    .update(canonicalizeRfc8785(approvalRequest), 'utf8')
    .digest('hex')
  const unsigned = {
    approvalId: 'REV-01-restore-2026-08-28',
    decision: 'approved' as const,
    approverIdentity: 'privacy-operations@example.com',
    keyId: 'review-lifecycle-approver-1',
    approvedAt: APPROVED_AT,
    expiresAt: EXPIRES_AT,
    requestSha256,
    ...patch,
  }
  const approval = {
    ...unsigned,
    signature: sign(
      null,
      reviewLifecycleRecoveryApprovalSignaturePayload(unsigned),
      privateKey,
    ).toString('base64'),
  }
  const bundle = { request: approvalRequest, requestSha256, approval }
  const content = `${canonicalizeRfc8785(bundle)}\n`
  return {
    bundle,
    content,
    digest: createHash('sha256').update(content, 'utf8').digest('hex'),
    publicKey,
  }
}

describe('Review lifecycle recovery approval', () => {
  it('loads a bounded trusted Ed25519 public keyring from canonical DER', () => {
    const { publicKey } = generateKeyPairSync('ed25519')
    const encoded = publicKey.export({ type: 'spki', format: 'der' }).toString('base64')
    const keys = loadReviewLifecycleRecoveryApprovalPublicKeys(
      JSON.stringify({ 'review-lifecycle-approver-1': encoded }),
    )

    expect(keys.get('review-lifecycle-approver-1')?.asymmetricKeyType).toBe('ed25519')
    expect(() => loadReviewLifecycleRecoveryApprovalPublicKeys('{}')).toThrow(
      /public keyring is invalid/,
    )
  })

  it('accepts only a canonical, digest-pinned, signed approval for the exact runtime request', () => {
    const fixture = signedBundle()

    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        content: fixture.content,
        expectedBundleSha256: fixture.digest,
        trustedPublicKeys: new Map([[fixture.bundle.approval.keyId, fixture.publicKey]]),
        now: new Date('2026-08-28T11:00:00.000Z'),
        expectedRequest: request(),
      }),
    ).toEqual({
      ok: true,
      bundle: fixture.bundle,
      bundleSha256: fixture.digest,
    })
  })

  it.each([
    ['release', { target: { ...request().target, releaseSha: 'e'.repeat(40) } }],
    [
      'restore target',
      {
        target: {
          ...request().target,
          restoreDatabaseServiceName: 'Postgres-live',
        },
      },
    ],
    ['recovery generation', { target: { ...request().target, recoveryGeneration: 8 } }],
    ['policy', { lifecycle: { ...request().lifecycle, policySha256: 'e'.repeat(64) } }],
    [
      'report digest',
      { lifecycle: { ...request().lifecycle, reportSha256: 'e'.repeat(64) } },
    ],
  ])('refuses a signed bundle aimed at a different %s', (_label, expectedPatch) => {
    const fixture = signedBundle()
    const expectedRequest = {
      ...request(),
      ...expectedPatch,
    } as ReviewLifecycleRecoveryApprovalRequest

    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        content: fixture.content,
        expectedBundleSha256: fixture.digest,
        trustedPublicKeys: new Map([[fixture.bundle.approval.keyId, fixture.publicKey]]),
        now: new Date('2026-08-28T11:00:00.000Z'),
        expectedRequest,
      }),
    ).toEqual({ ok: false, code: 'wrong_target' })
  })

  it('refuses non-canonical, substituted, unsigned, denied, and stale input', () => {
    const fixture = signedBundle()
    const base = {
      content: fixture.content,
      expectedBundleSha256: fixture.digest,
      trustedPublicKeys: new Map([[fixture.bundle.approval.keyId, fixture.publicKey]]),
      now: new Date('2026-08-28T11:00:00.000Z'),
      expectedRequest: request(),
    }

    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        ...base,
        content: JSON.stringify(fixture.bundle, null, 2),
      }),
    ).toEqual({ ok: false, code: 'bundle_digest_mismatch' })
    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        ...base,
        expectedBundleSha256: 'f'.repeat(64),
      }),
    ).toEqual({ ok: false, code: 'bundle_digest_mismatch' })
    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        ...base,
        trustedPublicKeys: new Map(),
      }),
    ).toEqual({ ok: false, code: 'untrusted_signer' })

    const denied = signedBundle({ decision: 'denied' })
    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        ...base,
        content: denied.content,
        expectedBundleSha256: denied.digest,
        trustedPublicKeys: new Map([[denied.bundle.approval.keyId, denied.publicKey]]),
      }),
    ).toEqual({ ok: false, code: 'not_approved' })

    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        ...base,
        now: new Date(EXPIRES_AT),
      }),
    ).toEqual({ ok: false, code: 'stale_approval' })
  })

  it('refuses a signature or request digest that was replayed over changed bytes', () => {
    const fixture = signedBundle()
    const changedRequest = {
      ...fixture.bundle.request,
      target: { ...fixture.bundle.request.target, recoveryGeneration: 8 },
    }
    const changedBundle = { ...fixture.bundle, request: changedRequest }
    const content = `${canonicalizeRfc8785(changedBundle)}\n`

    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        content,
        expectedBundleSha256: createHash('sha256').update(content, 'utf8').digest('hex'),
        trustedPublicKeys: new Map([[fixture.bundle.approval.keyId, fixture.publicKey]]),
        now: new Date('2026-08-28T11:00:00.000Z'),
        expectedRequest: changedRequest,
      }),
    ).toEqual({ ok: false, code: 'request_digest_mismatch' })

    const signatureChanged = {
      ...fixture.bundle,
      approval: { ...fixture.bundle.approval, approverIdentity: 'attacker@example.com' },
    }
    const signatureChangedContent = `${canonicalizeRfc8785(signatureChanged)}\n`
    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        content: signatureChangedContent,
        expectedBundleSha256: createHash('sha256')
          .update(signatureChangedContent, 'utf8')
          .digest('hex'),
        trustedPublicKeys: new Map([[fixture.bundle.approval.keyId, fixture.publicKey]]),
        now: new Date('2026-08-28T11:00:00.000Z'),
        expectedRequest: request(),
      }),
    ).toEqual({ ok: false, code: 'invalid_signature' })
  })

  it('refuses an approval ID that the bounded lifecycle cannot persist or continue', () => {
    const fixture = signedBundle({ approvalId: 'reviewer@example.com' })
    expect(
      validateReviewLifecycleRecoveryApprovalBundle({
        content: fixture.content,
        expectedBundleSha256: fixture.digest,
        trustedPublicKeys: new Map([[fixture.bundle.approval.keyId, fixture.publicKey]]),
        now: new Date('2026-08-28T11:00:00.000Z'),
        expectedRequest: request(),
      }),
    ).toEqual({ ok: false, code: 'malformed_bundle' })
  })
})
