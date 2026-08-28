import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RAILWAY_SERVICE_SOURCE_MAP_VERSION } from '../../.railway/service-source-map'
import {
  assertSchemaMigratorBootstrapBinding,
  formatPeopleCutoverParitySummary,
  type DeploymentRow,
} from './deploy-beta'

const DIGEST = `sha256:${'a'.repeat(64)}`
const SOURCE = `ghcr.io/reputation-key/web@${DIGEST}`
const DEPLOYMENT_ONE = '11111111-1111-4111-8111-111111111111'
const DEPLOYMENT_TWO = '22222222-2222-4222-8222-222222222222'
const CANDIDATE = Object.freeze({
  version: RAILWAY_SERVICE_SOURCE_MAP_VERSION,
  stage: 'promotion' as const,
  sources: Object.freeze({ 'schema-migrator': SOURCE }),
})

function row(input: Partial<DeploymentRow> = {}): DeploymentRow {
  return {
    id: DEPLOYMENT_ONE,
    status: 'SUCCESS',
    createdAt: '2026-08-27T09:00:00.000Z',
    meta: { imageDigest: DIGEST },
    ...input,
  }
}

describe('release:beta schema bootstrap prerequisite', () => {
  it('binds the exact live source to the unambiguous newest successful digest run', () => {
    expect(
      assertSchemaMigratorBootstrapBinding(
        { 'schema-migrator': SOURCE },
        CANDIDATE,
        [
          row(),
          row({
            id: DEPLOYMENT_TWO,
            status: 'FAILED',
            createdAt: '2026-08-27T08:00:00.000Z',
          }),
        ],
        DIGEST,
      ),
    ).toEqual({ deploymentId: DEPLOYMENT_ONE, imageDigest: DIGEST, source: SOURCE })
  })

  it('refuses an absent or different live schema-migrator source', () => {
    expect(() =>
      assertSchemaMigratorBootstrapBinding({}, CANDIDATE, [row()], DIGEST),
    ).toThrow('live source (unbound) does not match signed candidate')
    expect(() =>
      assertSchemaMigratorBootstrapBinding(
        { 'schema-migrator': `ghcr.io/reputation-key/web@sha256:${'b'.repeat(64)}` },
        CANDIDATE,
        [row()],
        DIGEST,
      ),
    ).toThrow('does not match signed candidate')
  })

  it('refuses missing, ambiguous, incomplete, or unsettled deployment binding', () => {
    const current = { 'schema-migrator': SOURCE }
    expect(() =>
      assertSchemaMigratorBootstrapBinding(
        current,
        CANDIDATE,
        [row({ meta: { imageDigest: `sha256:${'b'.repeat(64)}` } })],
        DIGEST,
      ),
    ).toThrow('newest deployment carries')
    expect(() =>
      assertSchemaMigratorBootstrapBinding(
        current,
        CANDIDATE,
        [row(), row({ id: DEPLOYMENT_TWO })],
        DIGEST,
      ),
    ).toThrow('newest deployment is ambiguous')
    expect(() =>
      assertSchemaMigratorBootstrapBinding(
        current,
        CANDIDATE,
        [row({ createdAt: undefined })],
        DIGEST,
      ),
    ).toThrow('has no valid createdAt binding')
    expect(() =>
      assertSchemaMigratorBootstrapBinding(
        current,
        CANDIDATE,
        [row({ id: '-'.repeat(36) })],
        DIGEST,
      ),
    ).toThrow('has no valid id')
    expect(() =>
      assertSchemaMigratorBootstrapBinding(
        current,
        CANDIDATE,
        [row({ status: 'DEPLOYING' })],
        DIGEST,
      ),
    ).toThrow('not SUCCESS')

    expect(() =>
      assertSchemaMigratorBootstrapBinding(
        current,
        CANDIDATE,
        [
          row(),
          row({
            id: DEPLOYMENT_TWO,
            createdAt: '2026-08-27T10:00:00.000Z',
            meta: { imageDigest: `sha256:${'b'.repeat(64)}` },
          }),
        ],
        DIGEST,
      ),
    ).toThrow('newest deployment carries')
  })

  it('keeps a fresh full-project isolation read immediately around every source mutation', () => {
    const source = readFileSync(resolve('scripts/release/deploy-beta.ts'), 'utf8')
    const stage = source.slice(
      source.indexOf('function stageServiceSource('),
      source.indexOf('function deploymentStatus('),
    )
    expect(stage.match(/assertPinnedRailwayProjectIsolation\(target\)/gu)).toHaveLength(3)
    expect(stage).toMatch(
      /assertPinnedRailwayProjectIsolation\(target\)\s+for \(const assignment/u,
    )
    expect(stage).toMatch(
      /assertPinnedRailwayProjectIsolation\(target\)\s+const planned = railwayCommand/u,
    )
    expect(stage).toMatch(
      /assertPinnedRailwayProjectIsolation\(target\)\s+if \(disposition === 'change'\)/u,
    )
    expect(source).toMatch(
      /assertPinnedRailwayProjectIsolation\(railwayIacTarget\(evidence\)\)\s+out\('Railway graph confirmed no drift/u,
    )
    expect(source).toMatch(
      /'deployment',\s*'list',[\s\S]*?'--limit',\s*'100',[\s\S]*?'--json'/u,
    )
  })
})

describe('release:beta people cutover evidence v2 display', () => {
  it('shows only canonical People and Portal parity dimensions', () => {
    const summary = formatPeopleCutoverParitySummary({
      legacyAssignments: 4,
      expectedParticipations: 3,
      matchedParticipations: 3,
      expectedResponsibilities: 2,
      matchedResponsibilities: 2,
      expectedGroupMemberships: 1,
      matchedGroupMemberships: 1,
      anomalies: 0,
      missingMappings: 0,
    })

    expect(summary).toBe('participations 3/3; responsibilities 2/2; portal groups 1/1')
    expect(summary.toLowerCase()).not.toContain('team')
    expect(summary.toLowerCase()).not.toContain('membership')
  })
})
