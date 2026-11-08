import { describe, expect, it } from 'vitest'
import { createAuthorizeReviewExpiryApply } from './review-expiry-activation'
import { REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT } from './use-cases/run-source-content-lifecycle'

const approval = {
  approvalId: 'expiry-owner-approval',
  evidenceSha256: 'a'.repeat(64),
  approvedAt: '2026-11-08T00:00:00.000Z',
}
const activation = {
  approval,
  shadowParitySha256: 'b'.repeat(64),
  isolatedRestoreProofSha256: 'd'.repeat(64),
  commandReplayProofSha256: 'c'.repeat(64),
  backups: {
    verifiedAt: '2026-11-07T00:00:00.000Z',
    maximumRetentionDays: 30,
    manualRetentionDays: 30,
  },
}
const input = {
  contract: REVIEW_SOURCE_CONTENT_LIFECYCLE_CONTRACT,
  evaluatedAt: new Date('2026-11-08T00:00:00.000Z'),
  scope: { kind: 'expired' as const },
  priorApproval: null,
}

describe('expiry activation', () => {
  it('ships without any apply approval', async () => {
    await expect(createAuthorizeReviewExpiryApply()(input)).rejects.toMatchObject({
      code: 'review_destructive_lifecycle_quarantined',
    })
  })

  it('reuses the owner approval for subsequent age-based batches', async () => {
    const authorize = createAuthorizeReviewExpiryApply(activation)
    await expect(authorize(input)).resolves.toEqual(approval)
    await expect(authorize({ ...input, priorApproval: approval })).resolves.toEqual(
      approval,
    )
  })

  it.each([
    { ...activation, commandReplayProofSha256: '' },
    { ...activation, isolatedRestoreProofSha256: '' },
    { ...activation, approval: { ...approval, approvedAt: '2026-11-09T00:00:00.000Z' } },
    { ...activation, shadowParitySha256: '' },
    { ...activation, backups: { ...activation.backups, maximumRetentionDays: 31 } },
    { ...activation, backups: { ...activation.backups, manualRetentionDays: Infinity } },
    {
      ...activation,
      backups: { ...activation.backups, verifiedAt: '2026-10-01T00:00:00.000Z' },
    },
    {
      ...activation,
      backups: { ...activation.backups, verifiedAt: '2026-11-09T00:00:00.000Z' },
    },
  ])('refuses missing replay/parity or backup evidence: %j', async (record) => {
    await expect(createAuthorizeReviewExpiryApply(record)(input)).rejects.toMatchObject({
      code: 'review_destructive_lifecycle_quarantined',
    })
  })

  it('never authorizes connection-scoped or other one-off erasure', async () => {
    await expect(
      createAuthorizeReviewExpiryApply(activation)({
        ...input,
        scope: {
          kind: 'connection',
          organizationId: 'tenant' as never,
          connectionId: '00000000-0000-4000-8000-000000000001',
        },
      }),
    ).rejects.toMatchObject({ code: 'review_destructive_lifecycle_quarantined' })
  })
})
