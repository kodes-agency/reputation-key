import { describe, expect, it, vi } from 'vitest'
import { organizationId } from '#/shared/domain/ids'
import {
  applyRecentActivityVocabularyReconciliation,
  classifyRecentActivityVocabulary,
  reportRecentActivityVocabulary,
} from './reconcile-recent-activity-vocabulary'
import type { RecentActivityVocabularyReconciliationStore } from '../../ports/recent-activity-vocabulary-reconciliation.port'

const ORG = organizationId('org-vocabulary-report')
const fingerprint = 'a'.repeat(64)

const store = (): RecentActivityVocabularyReconciliationStore => ({
  report: vi.fn(async () => [
    {
      action: 'created',
      resourceType: 'property',
      count: 2,
      targetFingerprintSha256: fingerprint,
    },
    {
      action: 'approved',
      resourceType: 'property',
      count: 1,
      targetFingerprintSha256: 'b'.repeat(64),
    },
    {
      action: 'mystery',
      resourceType: 'legacy_thing',
      count: 3,
      targetFingerprintSha256: 'c'.repeat(64),
    },
  ]),
  apply: vi.fn(async () => ({ status: 'applied' as const, updatedCount: 3 })),
})

const command = {
  operationId: 'f2000000-0000-4000-8000-000000000001',
  organizationId: ORG,
  source: { action: 'mystery', resourceType: 'legacy_thing' },
  target: { action: 'created', resourceType: 'property' },
  expectedTargetCount: 3,
  expectedTargetFingerprintSha256: 'c'.repeat(64),
  authorizedBy: 'operator-1',
  authorizationEvidenceRef: 'support:ACT-01:decision-1',
} as const

describe('Recent Activity vocabulary reconciliation', () => {
  it('reports content-minimal groups and classifies unknown pairs without guessing', async () => {
    const report = await reportRecentActivityVocabulary({
      store: store(),
      clock: () => new Date('2026-08-28T12:00:00.000Z'),
    })(ORG)

    expect(report.groups).toEqual([
      expect.objectContaining({ classification: 'recognized_noncanonical' }),
      expect.objectContaining({ classification: 'canonical' }),
      expect.objectContaining({ classification: 'unmappable' }),
    ])
    expect(report.totalEntryCount).toBe(6)
    expect(report.reportFingerprintSha256).toMatch(/^[0-9a-f]{64}$/u)
    expect(JSON.stringify(report)).not.toContain('resource-id')
    expect(classifyRecentActivityVocabulary(command.source)).toBe('unmappable')
  })

  it('requires a separate authorization verdict before any apply call', async () => {
    const reconciliationStore = store()
    const authority = { authorize: vi.fn(async () => false) }
    const apply = applyRecentActivityVocabularyReconciliation({
      store: reconciliationStore,
      authority,
      clock: () => new Date('2026-08-28T12:00:00.000Z'),
    })

    await expect(apply(command)).resolves.toEqual({ status: 'unauthorized' })
    expect(authority.authorize).toHaveBeenCalledWith(command)
    expect(reconciliationStore.apply).not.toHaveBeenCalled()
  })

  it('applies only the explicitly reviewed source-to-canonical target mapping', async () => {
    const reconciliationStore = store()
    const apply = applyRecentActivityVocabularyReconciliation({
      store: reconciliationStore,
      authority: { authorize: vi.fn(async () => true) },
      clock: () => new Date('2026-08-28T12:00:00.000Z'),
    })

    await expect(apply(command)).resolves.toEqual({
      status: 'applied',
      updatedCount: 3,
    })
    expect(reconciliationStore.apply).toHaveBeenCalledWith({
      ...command,
      appliedAt: new Date('2026-08-28T12:00:00.000Z'),
    })
  })

  it('rejects a proposed destination outside the active exact vocabulary', async () => {
    const apply = applyRecentActivityVocabularyReconciliation({
      store: store(),
      authority: { authorize: vi.fn(async () => true) },
      clock: () => new Date('2026-08-28T12:00:00.000Z'),
    })

    await expect(
      apply({
        ...command,
        target: { action: 'approved', resourceType: 'property' },
      }),
    ).rejects.toThrow('recent_activity_vocabulary_target_not_canonical')
  })
})
