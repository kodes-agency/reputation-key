import { describe, expect, it } from 'vitest'
import {
  IAC_ONLY_SERVICES,
  LEGACY_CONFIG_DECLARATIONS,
  REPOSITORY_ROOT,
  legacyConfigServiceName,
  readLegacyConfigFiles,
  reconcileLegacyConfigOwnership,
} from './legacy-config-ownership'

const GRAPH_SERVICES = [
  'web',
  'worker',
  'google-provider-redis',
  'google-execution-admission',
  'google-egress-gateway',
  'ai-execution-admission',
  'ai-egress-gateway',
]

const DECLARED_FILES = LEGACY_CONFIG_DECLARATIONS.map((entry) => entry.file)

describe('legacy Railway config filenames', () => {
  it('maps the default config to the web service and named configs to themselves', () => {
    expect(legacyConfigServiceName('railway.json')).toBe('web')
    expect(legacyConfigServiceName('railway.worker.json')).toBe('worker')
    expect(legacyConfigServiceName('railway.ai-egress-gateway.json')).toBe(
      'ai-egress-gateway',
    )
  })

  it('refuses a filename that is not legacy Railway config', () => {
    expect(() => legacyConfigServiceName('railway.ts')).toThrow(
      'not a legacy Railway config filename: railway.ts',
    )
  })
})

describe('legacy Config-as-Code ownership reconciliation', () => {
  it('separates the dual-ownership set from workloads that survive cutover', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: DECLARED_FILES,
      graphServices: GRAPH_SERVICES,
    })

    expect(report.violations).toEqual([])
    expect(report.dualOwnership).toEqual([
      'railway.ai-egress-gateway.json',
      'railway.ai-execution-admission.json',
      'railway.google-egress-gateway.json',
      'railway.google-execution-admission.json',
      'railway.json',
      'railway.worker.json',
    ])
    expect(report.outOfGraph).toEqual([
      'railway.ai-egress-canary.json',
      'railway.ai-egress-probe.json',
      'railway.perf-runner.json',
      'railway.sandbox.json',
    ])
  })

  it('fails closed on a legacy config nobody classified', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: [...DECLARED_FILES, 'railway.new-service.json'],
      graphServices: GRAPH_SERVICES,
    })

    expect(report.violations).toEqual([
      'railway.new-service.json: present but undeclared — classify it before cutover',
    ])
  })

  it('reports a declaration whose file has been removed', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: DECLARED_FILES.filter((file) => file !== 'railway.worker.json'),
      graphServices: GRAPH_SERVICES,
    })

    expect(report.violations).toEqual([
      'railway.worker.json: declared but absent from the repository root',
    ])
    expect(report.dualOwnership).not.toContain('railway.worker.json')
  })

  it('reports an out-of-graph service that quietly became a cell resource', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: DECLARED_FILES,
      graphServices: [...GRAPH_SERVICES, 'perf-runner'],
    })

    // Both checks fire: the declaration contradicts the graph, and the graph
    // carries a service no migrated declaration accounts for.
    expect(report.violations).toEqual([
      'perf-runner: in the cell graph with no migrated declaration and not listed as IaC-only',
      'railway.perf-runner.json: declared out-of-graph but perf-runner is in the cell graph',
    ])
  })

  it('requires a recorded reason for an out-of-graph declaration', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: ['railway.sandbox.json'],
      graphServices: [],
      declarations: [
        { file: 'railway.sandbox.json', service: 'sandbox', ownership: 'out-of-graph' },
      ],
      iacOnlyServices: [],
    })

    expect(report.violations).toEqual([
      'railway.sandbox.json: out-of-graph requires a recorded reason',
    ])
  })

  it('reports a migrated declaration whose service left the graph', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: DECLARED_FILES,
      graphServices: GRAPH_SERVICES.filter((service) => service !== 'worker'),
    })

    expect(report.violations).toEqual([
      'railway.worker.json: declared migrated but worker is not in the cell graph',
    ])
  })

  it('reports a graph service that no declaration accounts for', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: DECLARED_FILES,
      graphServices: [...GRAPH_SERVICES, 'unaccounted-service'],
    })

    expect(report.violations).toEqual([
      'unaccounted-service: in the cell graph with no migrated declaration and not listed as IaC-only',
    ])
  })

  it('accepts a graph service that never had Config-as-Code', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: DECLARED_FILES,
      graphServices: GRAPH_SERVICES,
      iacOnlyServices: IAC_ONLY_SERVICES,
    })

    expect(report.violations).toEqual([])
  })
})

describe('legacy Config-as-Code ownership in this repository', () => {
  it('declares every root railway*.json exactly once', () => {
    expect(readLegacyConfigFiles(REPOSITORY_ROOT)).toEqual([...DECLARED_FILES].sort())
  })

  it('still carries the dual ownership the cutover has to clear', () => {
    const report = reconcileLegacyConfigOwnership({
      presentFiles: readLegacyConfigFiles(REPOSITORY_ROOT),
      graphServices: GRAPH_SERVICES,
    })

    expect(report.violations).toEqual([])
    // Not yet zero: the cutover deletes these once Railway stops reporting a
    // Config File owner. This asserts the exact remaining set, so the count
    // cannot drift unnoticed in either direction.
    expect(report.dualOwnership).toHaveLength(6)
  })
})
