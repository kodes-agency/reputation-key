import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DATA_FATE_AUTHORITY, dataFateKey } from './data-fate-authority'

const SCHEMA_DIRECTORY = join(process.cwd(), 'src/shared/db/schema')
const TABLE_DECLARATION = /^export const ([A-Za-z0-9_]+)\s*=\s*pgTable\(/gm

function discoverPersistedModels(): readonly string[] {
  return readdirSync(SCHEMA_DIRECTORY)
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .flatMap((schemaFile) => {
      const source = readFileSync(join(SCHEMA_DIRECTORY, schemaFile), 'utf8')
      return [...source.matchAll(TABLE_DECLARATION)].map((match) =>
        dataFateKey(schemaFile, match[1]!),
      )
    })
    .sort()
}

describe('persisted-model lifecycle authority', () => {
  it('classifies every Drizzle table exactly once and rejects stale rows', () => {
    const catalogued = DATA_FATE_AUTHORITY.map((row) =>
      dataFateKey(row.schemaFile, row.exportName),
    )

    expect(new Set(catalogued).size).toBe(catalogued.length)
    expect([...catalogued].sort()).toEqual(discoverPersistedModels())
  })

  it('pins the accepted lifecycle for representative active, private, quarantined, and legacy data', () => {
    const byKey = new Map(
      DATA_FATE_AUTHORITY.map((row) => [
        dataFateKey(row.schemaFile, row.exportName),
        row.disposition,
      ]),
    )

    expect(byKey.get('review.schema.ts#reviews')).toBe('active_authority')
    expect(byKey.get('dashboard.schema.ts#setupChecklistMilestones')).toBe(
      'active_authority',
    )
    expect(byKey.get('review.schema.ts#reviewSourceContents')).toBe(
      'erasable_source_content',
    )
    expect(byKey.get('recovery.schema.ts#reviewLifecycleRecoveryExecutions')).toBe(
      'recoverable_archive',
    )
    expect(byKey.get('review.schema.ts#replyPublicationAuthorizations')).toBe(
      'active_authority',
    )
    expect(byKey.get('review.schema.ts#replyPublicationAttempts')).toBe(
      'active_authority',
    )
    expect(byKey.get('review.schema.ts#googleReplyObservationHeads')).toBe(
      'active_authority',
    )
    expect(byKey.get('review.schema.ts#googleReplyObservations')).toBe(
      'recoverable_archive',
    )
    expect(byKey.get('guest.schema.ts#guestResponsePrivateFeedback')).toBe(
      'erasable_source_content',
    )
    expect(byKey.get('guest.schema.ts#guestNetworkPressureRecords')).toBe(
      'active_authority',
    )
    expect(byKey.get('metric.schema.ts#metricQuarantine')).toBe(
      'quarantined_reconciliation_input',
    )
    expect(byKey.get('metric.schema.ts#portalMetricLifetimeAggregates')).toBe(
      'active_authority',
    )
    expect(
      byKey.get('google-import-discovery.schema.ts#googleImportDiscoveryRecords'),
    ).toBe('erasable_source_content')
    expect(byKey.get('portal.schema.ts#propertyPortalBrandContents')).toBe(
      'erasable_source_content',
    )
    expect(byKey.get('portal.schema.ts#portalHealthIntervals')).toBe(
      'recoverable_archive',
    )
    expect(
      byKey.get(
        'context-organization-lifecycle-receipts.schema.ts#contextOrganizationLifecycleReceipts',
      ),
    ).toBe('recoverable_archive')
    expect(byKey.get('inbox.schema.ts#inboxEscalationHistory')).toBe(
      'recoverable_archive',
    )
    expect(byKey.get('badge.schema.ts#badgeAwards')).toBe('bounded_contraction')
    expect(byKey.get('leaderboard.schema.ts#leaderboardEntries')).toBe(
      'bounded_contraction',
    )
    expect(byKey.get('team.schema.ts#teams')).toBe('bounded_contraction')
    expect(byKey.get('people-access.schema.ts#propertyAccessGrants')).toBe(
      'bounded_contraction',
    )
    expect(byKey.get('policy.schema.ts#propertyAccessGrant')).toBe('active_authority')
    expect(
      byKey.get('organization-lifecycle.schema.ts#organizationLifecycleAuthority'),
    ).toBe('active_authority')
    expect(
      byKey.get('organization-lifecycle.schema.ts#organizationLifecycleCommandReceipts'),
    ).toBe('recoverable_archive')
    expect(byKey.get('activity.schema.ts#recentActivityVocabularyReconciliations')).toBe(
      'recoverable_archive',
    )
  })

  it('keeps lifecycle and vocabulary receipts content-free, recovery-bounded facts', () => {
    const byKey = new Map(
      DATA_FATE_AUTHORITY.map((row) => [
        dataFateKey(row.schemaFile, row.exportName),
        row,
      ]),
    )

    expect(
      byKey.get('organization-lifecycle.schema.ts#organizationLifecycleCommandReceipts'),
    ).toMatchObject({ owner: 'identity', authority: 'LIF-01' })
    expect(
      byKey.get('activity.schema.ts#recentActivityVocabularyReconciliations'),
    ).toMatchObject({ owner: 'activity', authority: 'ACT-01' })
    for (const key of [
      'organization-lifecycle.schema.ts#organizationLifecycleCommandReceipts',
      'activity.schema.ts#recentActivityVocabularyReconciliations',
    ]) {
      expect(byKey.get(key)?.exitCriteria, key).toMatch(
        /content-(?:free|minimal)[\s\S]*(?:retry|recovery)[\s\S]*(?:export|restore)/iu,
      )
    }
  })

  it('requires non-authoritative rows to state how they leave or remain bounded', () => {
    for (const row of DATA_FATE_AUTHORITY) {
      if (row.disposition === 'active_authority') continue
      expect(row.exitCriteria, dataFateKey(row.schemaFile, row.exportName)).not.toBe('')
    }
  })

  it('gives every non-active row a substantive exit criterion and no active row a stray one', () => {
    // CNV-01: whitespace or a one-word placeholder would satisfy a bare
    // non-empty check while telling an operator nothing about how the rows
    // leave. An active_authority row carrying exit text is the opposite
    // failure — a half-made contraction decision hiding inside live data.
    for (const row of DATA_FATE_AUTHORITY) {
      const key = dataFateKey(row.schemaFile, row.exportName)
      if (row.disposition === 'active_authority') {
        expect(row.exitCriteria, key).toBe('')
        continue
      }
      expect(row.exitCriteria.trim(), key).not.toBe('')
      expect(row.exitCriteria.trim().split(/\s+/u).length, key).toBeGreaterThanOrEqual(8)
    }
  })

  it('routes every contraction candidate through the CNV-01 authority', () => {
    // The inventory registry derives its command coverage from these rows, so
    // a candidate classified without naming CNV-01 would be a table nobody has
    // agreed to inventory.
    const candidates = DATA_FATE_AUTHORITY.filter(
      ({ disposition }) =>
        disposition === 'bounded_contraction' || disposition === 'compatibility_read',
    )

    expect(candidates).toHaveLength(29)
    expect(
      candidates.filter(({ disposition }) => disposition === 'compatibility_read'),
    ).toHaveLength(7)
    for (const row of candidates) {
      expect(row.authority, dataFateKey(row.schemaFile, row.exportName)).toContain(
        'CNV-01',
      )
    }
  })
})
