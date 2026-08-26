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
    expect(byKey.get('review.schema.ts#reviewSourceContents')).toBe(
      'erasable_source_content',
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
    expect(byKey.get('metric.schema.ts#metricQuarantine')).toBe(
      'quarantined_reconciliation_input',
    )
    expect(byKey.get('badge.schema.ts#badgeAwards')).toBe('bounded_contraction')
    expect(byKey.get('leaderboard.schema.ts#leaderboardEntries')).toBe(
      'bounded_contraction',
    )
    expect(byKey.get('team.schema.ts#teams')).toBe('bounded_contraction')
  })

  it('requires non-authoritative rows to state how they leave or remain bounded', () => {
    for (const row of DATA_FATE_AUTHORITY) {
      if (row.disposition === 'active_authority') continue
      expect(row.exitCriteria, dataFateKey(row.schemaFile, row.exportName)).not.toBe('')
    }
  })
})
