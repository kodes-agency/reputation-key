import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contractionCandidateTableNames } from './contraction-inventory-registry'
import {
  ACTIVITY_RESOURCE_REFERENTS,
  NON_FK_REFERENCE_SURFACES,
  NON_FK_SURROGATE_IDENTIFIED_CANDIDATES,
  NON_FK_UNREFERENCEABLE_CANDIDATES,
  buildNonFkReferenceScanReport,
  nonFkReferenceCoverage,
  resolveNonFkProbes,
} from './non-fk-reference-surfaces'

const ROOT = process.cwd()
const CANDIDATES = contractionCandidateTableNames()

function surface(id: string) {
  const found = NON_FK_REFERENCE_SURFACES.find((entry) => entry.id === id)
  expect(found, id).toBeDefined()
  return found!
}

describe('non-FK reference surfaces', () => {
  it('declares the concrete columns schema inspection found', () => {
    // people-access.schema.ts:227 and :331 — both are uuid('team_id').notNull()
    // with no .references(), so PostgreSQL will never refuse a dangling value.
    expect(surface('team_memberships.team_id')).toMatchObject({
      schema: 'public',
      table: 'team_memberships',
      columns: ['team_id'],
      kind: 'uuid_column',
      identifierColumn: 'team_id',
      declaredReferents: ['teams'],
    })
    expect(surface('team_portal_group_scopes.team_id')).toMatchObject({
      table: 'team_portal_group_scopes',
      columns: ['team_id'],
      kind: 'uuid_column',
      declaredReferents: ['teams'],
    })

    expect(surface('recent_activity_entries.resource')).toMatchObject({
      table: 'recent_activity_entries',
      columns: ['resource_type', 'resource_id'],
      kind: 'resource_type_pair',
      identifierColumn: 'resource_id',
      discriminatorColumn: 'resource_type',
      referentScope: 'activity_vocabulary',
    })
    expect(surface('recent_activity_entries.payload')).toMatchObject({
      table: 'recent_activity_entries',
      columns: ['payload'],
      kind: 'json_document',
    })
    expect(surface('recent_activity_replay_facts.resource')).toMatchObject({
      table: 'recent_activity_replay_facts',
      columns: ['resource_type', 'resource_id'],
      kind: 'resource_type_pair',
    })
    expect(surface('recent_activity_replay_facts.source_aggregate_id')).toMatchObject({
      table: 'recent_activity_replay_facts',
      columns: ['source_aggregate_id'],
      kind: 'text_column',
    })
    expect(surface('recent_activity_replay_facts.transition_payload')).toMatchObject({
      table: 'recent_activity_replay_facts',
      columns: ['transition_payload'],
      kind: 'json_document',
    })
    expect(surface('outbox_events.source_aggregate_id')).toMatchObject({
      table: 'outbox_events',
      columns: ['source_context', 'source_aggregate_id', 'event_type'],
      kind: 'text_column',
      identifierColumn: 'source_aggregate_id',
    })
    expect(surface('outbox_events.payload')).toMatchObject({
      table: 'outbox_events',
      columns: ['payload'],
      kind: 'json_document',
    })
    expect(surface('notifications.payload')).toMatchObject({
      table: 'notifications',
      columns: ['payload'],
      kind: 'json_document',
    })

    for (const entry of NON_FK_REFERENCE_SURFACES) {
      expect(entry.reason.trim().length, entry.id).toBeGreaterThan(20)
      expect(entry.columns, entry.id).toContain(entry.identifierColumn)
      if (entry.kind === 'resource_type_pair') {
        expect(entry.discriminatorColumn, entry.id).not.toBeNull()
        expect(entry.columns, entry.id).toContain(entry.discriminatorColumn!)
      } else {
        expect(entry.discriminatorColumn, entry.id).toBeNull()
      }
    }
  })

  it('gives every contraction candidate a probe or a reasoned no-referent record', () => {
    const coverage = nonFkReferenceCoverage(CANDIDATES)

    expect(coverage.uncovered).toEqual([])
    expect(coverage.exemptedAndProbed).toEqual([])
    expect(coverage.unknownExemptions).toEqual([])
    expect(coverage.unknownSurrogateCandidates).toEqual([])
    expect(coverage.complete).toBe(true)
    expect([...coverage.probed, ...coverage.exempted].sort()).toEqual(
      [...CANDIDATES].sort(),
    )

    // The exempted set is exactly the candidates with no surrogate row
    // identifier: nothing textual elsewhere can name one of their rows.
    expect(
      NON_FK_UNREFERENCEABLE_CANDIDATES.map(({ tableName }) => tableName).sort(),
    ).toEqual([
      '_rollup_watermarks',
      'legacy_import_control',
      'rollup_daily_inbox_metrics',
      'rollup_daily_metrics',
      'rollup_weekly_metrics',
    ])
    for (const exemption of NON_FK_UNREFERENCEABLE_CANDIDATES) {
      expect(exemption.reason.trim().length, exemption.tableName).toBeGreaterThan(20)
    }

    // Today the two lists partition the candidate set exactly. The lists stay
    // explicit so a new candidate joins one of them by decision, not by
    // falling through a default.
    expect([...NON_FK_SURROGATE_IDENTIFIED_CANDIDATES].sort()).toEqual(
      CANDIDATES.filter(
        (tableName) =>
          !NON_FK_UNREFERENCEABLE_CANDIDATES.some(
            (exemption) => exemption.tableName === tableName,
          ),
      ).sort(),
    )
  })

  it('fails closed when a new candidate arrives with neither a probe nor an exemption', () => {
    const coverage = nonFkReferenceCoverage([
      ...CANDIDATES,
      'future_contraction_candidate',
    ])

    expect(coverage.uncovered).toEqual(['future_contraction_candidate'])
    expect(coverage.complete).toBe(false)
    // An exemption for a table nobody classified is equally a defect.
    expect([...nonFkReferenceCoverage(['teams']).unknownExemptions].sort()).toEqual([
      '_rollup_watermarks',
      'legacy_import_control',
      'rollup_daily_inbox_metrics',
      'rollup_daily_metrics',
      'rollup_weekly_metrics',
    ])
  })

  it('cross-checks the ACTIVITY_RESOURCE_TYPES vocabulary against the candidate set', () => {
    // src/contexts/activity/domain/types.ts:33. Read as source text rather than
    // imported so this governance module keeps no dependency on a context.
    const source = readFileSync(
      join(ROOT, 'src/contexts/activity/domain/types.ts'),
      'utf8',
    )
    const literal = source.match(
      /export const ACTIVITY_RESOURCE_TYPES = \[([\s\S]*?)\] as const/u,
    )
    expect(literal, 'ACTIVITY_RESOURCE_TYPES literal').not.toBeNull()
    const vocabulary = [...literal![1]!.matchAll(/'([a-z_]+)'/gu)].map(
      (match) => match[1]!,
    )

    expect(vocabulary).toContain('team')
    expect(vocabulary).toContain('staff_assignment')
    expect(vocabulary).toContain('goal')

    // Those three tokens name resource kinds whose rows are contraction
    // candidates, so recent_activity_entries can hold textual references that
    // outlive the rows. Every such token must be mapped to its table here.
    const mappedTokens = ACTIVITY_RESOURCE_REFERENTS.map(({ token }) => token)
    for (const token of vocabulary) {
      const candidateForToken = ACTIVITY_RESOURCE_REFERENTS.find(
        (referent) => referent.token === token,
      )
      if (candidateForToken) {
        expect(CANDIDATES, token).toContain(candidateForToken.tableName)
      }
    }
    expect(mappedTokens.sort()).toEqual(['goal', 'staff_assignment', 'team'])
    expect(mappedTokens.every((token) => vocabulary.includes(token))).toBe(true)
  })

  it('resolves the probes that must run for a given deletion slice', () => {
    const teamProbes = resolveNonFkProbes('teams', CANDIDATES)
    const ids = teamProbes.map(({ surface: probeSurface }) => probeSurface.id)

    expect(ids).toContain('team_memberships.team_id')
    expect(ids).toContain('team_portal_group_scopes.team_id')
    expect(ids).toContain('recent_activity_entries.resource')
    expect(ids).toContain('outbox_events.payload')
    expect(
      teamProbes.find(
        ({ surface: probeSurface }) => probeSurface.kind === 'resource_type_pair',
      )?.discriminator,
    ).toBe('team')
    expect(teamProbes.every(({ referentTable }) => referentTable === 'teams')).toBe(true)

    // A candidate reachable only through the blanket surrogate-id probes still
    // gets probes; an exempt candidate gets none.
    expect(
      resolveNonFkProbes('badge_awards', CANDIDATES).map(({ surface: s }) => s.id),
    ).toEqual([
      'recent_activity_replay_facts.source_aggregate_id',
      'outbox_events.source_aggregate_id',
      'recent_activity_entries.payload',
      'recent_activity_replay_facts.transition_payload',
      'outbox_events.payload',
      'notifications.payload',
    ])
    expect(resolveNonFkProbes('_rollup_watermarks', CANDIDATES)).toEqual([])
  })

  it('reports counts and column identifiers only, with a stable fingerprint', () => {
    const input = {
      evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
      tables: [
        {
          tableName: 'teams',
          probes: [
            {
              surfaceId: 'recent_activity_entries.resource',
              referenceCount: 2,
            },
            { surfaceId: 'outbox_events.payload', referenceCount: 1 },
          ],
        },
      ],
    }

    const report = buildNonFkReferenceScanReport(input)
    const repeated = buildNonFkReferenceScanReport(input)
    const moved = buildNonFkReferenceScanReport({
      ...input,
      tables: [
        {
          tableName: 'teams',
          probes: [
            { surfaceId: 'recent_activity_entries.resource', referenceCount: 3 },
            { surfaceId: 'outbox_events.payload', referenceCount: 1 },
          ],
        },
      ],
    })

    expect(report.version).toBe('non-fk-reference-scan-v1')
    expect(report.evaluatedAt).toBe('2026-08-28T00:00:00.000Z')
    expect(report.totalReferences).toBe(3)
    expect(report.blockers).toEqual(['non_fk_references_require_disposition'])
    expect(report.tables[0]?.probes[0]).toEqual({
      surfaceId: 'recent_activity_entries.resource',
      surfaceTable: 'recent_activity_entries',
      columns: ['resource_type', 'resource_id'],
      kind: 'resource_type_pair',
      referenceCount: 2,
    })
    expect(report.fingerprint).toMatch(/^[0-9a-f]{64}$/)
    expect(repeated.fingerprint).toBe(report.fingerprint)
    expect(moved.fingerprint).not.toBe(report.fingerprint)

    const clean = buildNonFkReferenceScanReport({
      ...input,
      tables: [
        {
          tableName: 'teams',
          probes: [{ surfaceId: 'outbox_events.payload', referenceCount: 0 }],
        },
      ],
    })
    expect(clean.blockers).toEqual([])
    expect(clean.totalReferences).toBe(0)
  })

  it('rejects a probe result for a surface nobody declared', () => {
    expect(() =>
      buildNonFkReferenceScanReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tables: [
          {
            tableName: 'teams',
            probes: [{ surfaceId: 'invented_surface', referenceCount: 1 }],
          },
        ],
      }),
    ).toThrow('non_fk_reference_surface_unknown')

    expect(() =>
      buildNonFkReferenceScanReport({
        evaluatedAt: new Date('2026-08-28T00:00:00.000Z'),
        tables: [
          {
            tableName: 'teams',
            probes: [{ surfaceId: 'outbox_events.payload', referenceCount: -1 }],
          },
        ],
      }),
    ).toThrow('non_fk_reference_count_invalid')
  })
})
