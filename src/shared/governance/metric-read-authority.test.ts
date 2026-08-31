import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { METRIC_VERSION_IDS } from '#/contexts/metric/application/public-api'
import { CAPABILITY_FATE } from './capability-fate'
import {
  METRIC_READING_DIRECT_READ_AUTHORITIES,
  metricReadingAuthorityViolations,
  type MetricReadingDirectReadAuthority,
} from './metric-read-authority'

const ROOT = process.cwd()
const SRC = join(ROOT, 'src')
const PRODUCTION_ROOTS = [SRC, join(ROOT, 'scripts')] as const

function productionTypeScriptFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTypeScriptFiles(path)
    if (!entry.name.endsWith('.ts') && !entry.name.endsWith('.tsx')) return []
    if (
      entry.name.includes('.test.') ||
      entry.name.includes('.stories.') ||
      entry.name.includes('.integration.')
    ) {
      return []
    }
    return [path]
  })
}

function isDirectMetricReadingRead(rawSource: string): boolean {
  const source = rawSource.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const schemaImport = source.match(
    /import\s*\{([\s\S]*?)\}\s*from\s*['"]#\/shared\/db\/schema(?:\/metric\.schema)?['"]/,
  )?.[1]
  const importedAlias = schemaImport?.match(
    /\bmetricReadings\b(?:\s+as\s+([A-Za-z_$][\w$]*))?/,
  )?.[1]
  const drizzleName =
    importedAlias ?? (schemaImport?.includes('metricReadings') ? 'metricReadings' : null)
  const escapedDrizzleName = drizzleName?.replaceAll('$', '\\$') ?? null
  const readsImportedTable =
    escapedDrizzleName !== null &&
    new RegExp(
      `\\.(?:from|innerJoin|leftJoin|rightJoin|fullJoin)\\(\\s*${escapedDrizzleName}\\s*(?:,|\\))`,
    ).test(source)
  const readsRelationalTable =
    escapedDrizzleName !== null &&
    new RegExp(
      `\\.query\\s*\\.\\s*${escapedDrizzleName}\\s*\\.\\s*(?:findFirst|findMany)\\s*\\(`,
    ).test(source)
  const readsInterpolatedTable =
    escapedDrizzleName !== null &&
    new RegExp(`\\b(?:FROM|JOIN)\\s+\\$\\{${escapedDrizzleName}\\}`, 'i').test(source)
  const readsRawTable =
    /\b(?:FROM|JOIN)\s+(?:(?:"?public"?)\.)?"?metric_readings"?(?=\s|$)/i.test(source)
  return (
    readsImportedTable || readsRelationalTable || readsInterpolatedTable || readsRawTable
  )
}

function discoveredDirectMetricReadingFiles(): readonly string[] {
  return PRODUCTION_ROOTS.flatMap(productionTypeScriptFiles)
    .filter((path) => !path.startsWith(join(SRC, 'contexts', 'metric')))
    .filter((path) => !path.startsWith(join(SRC, 'shared', 'db', 'schema')))
    .filter((path) => isDirectMetricReadingRead(readFileSync(path, 'utf8')))
    .map((path) => relative(ROOT, path))
    .sort()
}

describe('Metric reading authority inventory', () => {
  it('discovers Drizzle aliases and raw quoted SQL without mistaking writes or comments for reads', () => {
    expect(
      isDirectMetricReadingRead(`
        import { metricReadings as readings } from '#/shared/db/schema/metric.schema'
        db.select().from(readings)
      `),
    ).toBe(true)
    expect(isDirectMetricReadingRead('SELECT * FROM "public"."metric_readings"')).toBe(
      true,
    )
    expect(
      isDirectMetricReadingRead(
        'SELECT 1 FROM metric_corrections JOIN metric_readings ON true',
      ),
    ).toBe(true)
    expect(
      isDirectMetricReadingRead(`
        import { metricReadings as readings } from '#/shared/db/schema'
        db.select().from(otherTable).leftJoin(readings, sql\`true\`)
      `),
    ).toBe(true)
    expect(
      isDirectMetricReadingRead(`
        import { metricReadings } from '#/shared/db/schema'
        db.query.metricReadings.findMany()
      `),
    ).toBe(true)
    expect(
      isDirectMetricReadingRead(`
        import { metricReadings } from '#/shared/db/schema'
        db.insert(metricReadings)
        // Reads from metric_readings are forbidden here.
      `),
    ).toBe(false)
  })

  it('fails closed over every production metric_readings reader outside Metric', () => {
    expect(metricReadingAuthorityViolations()).toEqual([])
    expect(
      METRIC_READING_DIRECT_READ_AUTHORITIES.map(({ source }) => source).sort(),
    ).toEqual(discoveredDirectMetricReadingFiles())
  })

  it('publishes an immutable reviewed contract', () => {
    expect(Object.isFrozen(METRIC_READING_DIRECT_READ_AUTHORITIES)).toBe(true)
    for (const entry of METRIC_READING_DIRECT_READ_AUTHORITIES) {
      expect(Object.isFrozen(entry)).toBe(true)
      expect(Object.isFrozen(entry.contract)).toBe(true)
      if (entry.posture === 'active_versioned_projection') {
        expect(Object.isFrozen(entry.contract.definitionVersionIds)).toBe(true)
        expect(Object.isFrozen(entry.contract.consumers)).toBe(true)
      }
    }
  })

  it('binds every active projection to executable version, consumer, source, correction, and availability policy', () => {
    const versionNames = new Map(
      Object.entries(METRIC_VERSION_IDS).map(([name, id]) => [id, name]),
    )
    const active = METRIC_READING_DIRECT_READ_AUTHORITIES.filter(
      (entry) => entry.posture === 'active_versioned_projection',
    )

    expect(active.map(({ id }) => id)).toEqual([
      'dashboard.legacy-kpi-projection',
      'dashboard.fleet-overview-projection',
    ])

    for (const entry of active) {
      const source = readFileSync(entry.source, 'utf8')
      for (const versionId of entry.contract.definitionVersionIds) {
        const versionName = versionNames.get(versionId)
        expect(versionName, `${entry.id} has an unknown immutable version`).toBeDefined()
        expect(source, `${entry.id} does not pin ${String(versionName)}`).toContain(
          `METRIC_VERSION_IDS.${String(versionName)}`,
        )
      }
      expect(source).toMatch(/permittedConsumers|permitted_consumers/)
      expect(source).toMatch(/sourcePolicyAllowlist|source_policy_allowlist/)
      expect(source).toMatch(/metricCorrections|metric_corrections/)
      if (entry.contract.availability === 'definition_minimum_sample_signal') {
        expect(source).toMatch(/minimumSample|minimum_sample/)
      } else {
        expect(source).toContain('completeness')
        expect(source).toContain('freshness')
      }
    }
  })

  it('keeps Goal on the Metric public API and Dashboard on owner APIs or the two named projections', () => {
    const goalBuild = readFileSync('src/contexts/goal/build.ts', 'utf8')
    const goalPrograms = readFileSync(
      'src/contexts/goal/application/use-cases/goal-programs.ts',
      'utf8',
    )
    const dashboardBuild = readFileSync('src/contexts/dashboard/build.ts', 'utf8')

    expect(goalBuild).toContain('MetricPublicApi')
    expect(goalBuild).toContain('metrics: input.metricApi')
    expect(goalPrograms).toContain('deps.metrics.queryGoalMetric')
    expect(goalBuild).not.toMatch(/metricReadings|metric_readings/)
    expect(goalPrograms).not.toMatch(/metricReadings|metric_readings/)

    expect(dashboardBuild).toContain('portalMetrics: PortalMetricsPort')
    expect(dashboardBuild).toContain('portalLifetime: PortalLifetimeMetricsPort')
    expect(
      METRIC_READING_DIRECT_READ_AUTHORITIES.filter(
        (entry) => entry.posture === 'active_versioned_projection',
      ).map(({ id }) => id),
    ).toEqual(['dashboard.legacy-kpi-projection', 'dashboard.fleet-overview-projection'])
  })

  it('retains no Badge, legacy Leaderboard, or Recognition metric reader', () => {
    expect(CAPABILITY_FATE['badge.use'].fate).toBe('legacy_blocked')
    expect(CAPABILITY_FATE['leaderboard.use'].fate).toBe('legacy_blocked')
    expect(
      METRIC_READING_DIRECT_READ_AUTHORITIES.some(({ source }) =>
        /src\/contexts\/(?:badge|leaderboard)\//u.test(source),
      ),
    ).toBe(false)
    expect(
      [
        'src/contexts/badge/infrastructure/repositories/badge.repository.ts',
        'src/contexts/leaderboard/infrastructure/repositories/leaderboard.repository.ts',
        'src/contexts/leaderboard/infrastructure/repositories/recognition.repository.ts',
      ].filter(existsSync),
    ).toEqual([])
  })

  it('rejects an active reader without a version or consumer', () => {
    const active = METRIC_READING_DIRECT_READ_AUTHORITIES.find(
      (entry) => entry.posture === 'active_versioned_projection',
    )
    if (!active) throw new Error('active metric authority is missing')
    const rogue = {
      ...active,
      contract: {
        definitionVersionIds: [],
        consumers: [],
        sourcePolicy: 'immutable_definition_allowlist',
        correction: 'current_append_only_tip',
        availability: 'definition_minimum_sample_signal',
      },
    } as unknown as MetricReadingDirectReadAuthority

    expect(
      metricReadingAuthorityViolations([
        rogue,
        ...METRIC_READING_DIRECT_READ_AUTHORITIES.filter(
          (entry) => entry.id !== active.id,
        ),
      ]),
    ).toEqual([
      `${active.id}: active projection has no immutable version`,
      `${active.id}: active projection has no permitted consumer`,
    ])
  })
})
