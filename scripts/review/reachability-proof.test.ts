import { describe, expect, it } from 'vitest'
import {
  REACHABILITY_DIMENSIONS,
  buildReachabilityProof,
  classifyReachability,
  contractionProtection,
  missingReachabilityDimensions,
  runReachabilityProofCli,
  summarizeReachability,
  type ReachabilityEvidence,
} from './reachability-proof'

const SYMBOL = Object.freeze({
  file: 'src/shared/governance/example-module.ts',
  exportName: 'exampleSymbol',
})

function evidence(overrides: Partial<ReachabilityEvidence> = {}): ReachabilityEvidence {
  return {
    symbol: SYMBOL,
    fallowTrace: {
      command:
        'fallow dead-code --trace src/shared/governance/example-module.ts:exampleSymbol',
      isUsed: false,
      isEntryPoint: false,
      fileReachable: true,
      directReferenceFiles: [],
      reason: 'No references found',
    },
    symbolImpact: {
      command:
        'fallow dead-code --type-aware --symbol-impact src/shared/governance/example-module.ts:exampleSymbol',
      status: 'available',
      consumers: [],
      totalDirectConsumerCount: 0,
    },
    literalSearch: {
      command: 'rg --word-regexp --fixed-strings exampleSymbol',
      ownFileMatches: 0,
      externalMatches: 0,
      externalFiles: [],
    },
    fallowConfiguration: {
      source: '.fallowrc.json',
      isEntry: false,
      isIgnoredExport: false,
    },
    runtimeCatalogue: {
      sources: [
        'src/shared/governance/entry-point-catalogue.ts',
        'src/shared/governance/event-job-catalogue.ts',
      ],
      entryPointCatalogue: false,
      eventJobCatalogue: false,
    },
    ...overrides,
  }
}

describe('reachability proof harness', () => {
  it('records all five protocol-1 dimensions and fails closed when one is missing', () => {
    expect([...REACHABILITY_DIMENSIONS]).toEqual([
      'fallow_trace',
      'fallow_symbol_impact',
      'literal_search',
      'fallow_configuration',
      'runtime_catalogue',
    ])

    const proof = buildReachabilityProof(evidence())
    expect(missingReachabilityDimensions(evidence())).toEqual([])
    expect(proof.dimensions).toEqual([...REACHABILITY_DIMENSIONS])
    expect(proof.evidence.fallowTrace?.command).toContain('--trace')
    expect(proof.evidence.symbolImpact?.command).toContain('--symbol-impact')
    expect(proof.evidence.fallowConfiguration?.source).toBe('.fallowrc.json')
    expect(proof.evidence.runtimeCatalogue?.sources).toEqual([
      'src/shared/governance/entry-point-catalogue.ts',
      'src/shared/governance/event-job-catalogue.ts',
    ])
    expect(proof.fingerprint).toMatch(/^[0-9a-f]{64}$/)

    for (const [key, dimension] of [
      ['fallowTrace', 'fallow_trace'],
      ['symbolImpact', 'fallow_symbol_impact'],
      ['literalSearch', 'literal_search'],
      ['fallowConfiguration', 'fallow_configuration'],
      ['runtimeCatalogue', 'runtime_catalogue'],
    ] as const) {
      const incomplete = evidence({ [key]: null } as Partial<ReachabilityEvidence>)
      expect(missingReachabilityDimensions(incomplete)).toEqual([dimension])
      expect(() => buildReachabilityProof(incomplete)).toThrow(
        `reachability_proof_dimension_missing:${dimension}`,
      )
    }

    // A dimension the analyser could not compute is missing, not clean.
    expect(() =>
      buildReachabilityProof(
        evidence({
          symbolImpact: {
            command: 'fallow dead-code --type-aware --symbol-impact x:y',
            status: 'unavailable',
            consumers: [],
            totalDirectConsumerCount: 0,
          },
        }),
      ),
    ).toThrow('reachability_proof_dimension_unavailable:fallow_symbol_impact')
  })

  it('classifies fully-dead only with zero references anywhere, over-public with self-only', () => {
    expect(classifyReachability(evidence())).toBe('fully-dead')
    expect(
      classifyReachability(
        evidence({
          literalSearch: {
            command: 'rg',
            ownFileMatches: 3,
            externalMatches: 0,
            externalFiles: [],
          },
        }),
      ),
    ).toBe('over-public')
    expect(
      classifyReachability(
        evidence({
          literalSearch: {
            command: 'rg',
            ownFileMatches: 3,
            externalMatches: 1,
            externalFiles: ['src/other.ts'],
          },
        }),
      ),
    ).toBe('reachable')

    // Any single reachability signal outranks a silent analyser.
    for (const reachable of [
      evidence({
        fallowTrace: {
          command: 'fallow',
          isUsed: true,
          isEntryPoint: false,
          fileReachable: true,
          directReferenceFiles: ['src/other.ts'],
          reason: 'Used by 1 file(s)',
        },
      }),
      evidence({
        symbolImpact: {
          command: 'fallow',
          status: 'available',
          consumers: ['src/other.ts'],
          totalDirectConsumerCount: 1,
        },
      }),
      evidence({
        fallowConfiguration: {
          source: '.fallowrc.json',
          isEntry: true,
          isIgnoredExport: false,
        },
      }),
      evidence({
        fallowConfiguration: {
          source: '.fallowrc.json',
          isEntry: false,
          isIgnoredExport: true,
        },
      }),
      evidence({
        runtimeCatalogue: {
          sources: ['src/shared/governance/event-job-catalogue.ts'],
          entryPointCatalogue: false,
          eventJobCatalogue: true,
        },
      }),
    ]) {
      expect(classifyReachability(reachable)).toBe('reachable')
    }
  })

  it('reproduces the 11 fully-dead / 150 over-public split measured at this SHA', () => {
    // docs/release-evidence/review/program-completion-backlog-2026-08-28.json,
    // CNV-01 currentState: of 282 unused-export findings, 162 have zero
    // references outside their own file; 150 of those are used inside it and
    // 11 have no reference at all. A regression in the classifier moves these
    // two numbers.
    const declarationOnly = Array.from({ length: 11 }, (_, index) =>
      evidence({
        symbol: { file: `src/dead-${index}.ts`, exportName: `dead${index}` },
      }),
    )
    const usedInOwnFile = Array.from({ length: 150 }, (_, index) =>
      evidence({
        symbol: { file: `src/over-public-${index}.ts`, exportName: `overPublic${index}` },
        literalSearch: {
          command: 'rg',
          ownFileMatches: 1 + (index % 4),
          externalMatches: 0,
          externalFiles: [],
        },
      }),
    )

    const summary = summarizeReachability(
      [...declarationOnly, ...usedInOwnFile].map((entry) =>
        buildReachabilityProof(entry),
      ),
    )

    expect(summary.total).toBe(161)
    expect(summary.fullyDead).toBe(11)
    expect(summary.overPublic).toBe(150)
    expect(summary.reachable).toBe(0)
    expect(summary.blocked).toBe(0)
    expect(summary.safeToDelete).toBe(11)
  })

  it('refuses a safe-to-delete verdict for schema and data-fate symbols', () => {
    const schemaSymbol = buildReachabilityProof(
      evidence({
        symbol: { file: 'src/shared/db/schema/team.schema.ts', exportName: 'teams' },
      }),
    )
    const dataFateSymbol = buildReachabilityProof(
      evidence({
        symbol: {
          file: 'src/contexts/integration/infrastructure/legacy-mirror.ts',
          exportName: 'legacyGbpCache',
        },
      }),
    )
    const ordinarySymbol = buildReachabilityProof(evidence())

    expect(schemaSymbol.classification).toBe('fully-dead')
    expect(schemaSymbol.safeToDelete).toBe(false)
    expect(schemaSymbol.recommendation).toBe('blocked')
    expect(schemaSymbol.blockedReason).toMatch(/verified release[\s\S]*restore proof/iu)

    expect(dataFateSymbol.safeToDelete).toBe(false)
    expect(dataFateSymbol.recommendation).toBe('blocked')

    expect(ordinarySymbol.safeToDelete).toBe(true)
    expect(ordinarySymbol.recommendation).toBe('delete')
    expect(
      buildReachabilityProof(
        evidence({
          literalSearch: {
            command: 'rg',
            ownFileMatches: 2,
            externalMatches: 0,
            externalFiles: [],
          },
        }),
      ),
    ).toMatchObject({ recommendation: 'unexport', safeToDelete: false })

    expect(
      contractionProtection('src/shared/governance/example.ts', 'goalProgress'),
    ).not.toBeNull()
    expect(
      contractionProtection('src/shared/governance/example.ts', 'exampleSymbol'),
    ).toBeNull()
  })

  it('fails the CLI instead of emitting an artifact when a real source is unreachable', () => {
    const output: string[] = []
    const errors: string[] = []
    const io = {
      out: (line: string) => output.push(line),
      err: (line: string) => errors.push(line),
    }

    const exitCode = runReachabilityProofCli(
      ['--symbol', 'src/shared/governance/example-module.ts:exampleSymbol'],
      {
        io,
        runCommand: () => ({ status: 127, stdout: '', stderr: 'fallow: not found' }),
        readFile: () => {
          throw new Error('unexpected read')
        },
      },
    )

    expect(exitCode).toBe(1)
    expect(output).toEqual([])
    expect(errors.join('\n')).toMatch(/fallow/iu)
  })

  it('emits one canonical proof when every dimension is really collected', () => {
    const output: string[] = []
    const trace = JSON.stringify({
      kind: 'trace',
      file: 'src/shared/governance/example-module.ts',
      export_name: 'exampleSymbol',
      file_reachable: true,
      is_entry_point: false,
      is_used: false,
      direct_references: [],
      reason: 'No references found',
    })
    const impact = JSON.stringify({
      kind: 'impact',
      status: 'available',
      direct_consumers: [],
      total_direct_consumer_count: 0,
    })

    const exitCode = runReachabilityProofCli(
      ['--symbol', 'src/shared/governance/example-module.ts:exampleSymbol'],
      {
        io: { out: (line: string) => output.push(line), err: () => {} },
        runCommand: (command, args) => {
          if (args.includes('--symbol-impact')) {
            return { status: 0, stdout: impact, stderr: '' }
          }
          if (args.includes('--trace')) return { status: 0, stdout: trace, stderr: '' }
          if (command.endsWith('rg')) return { status: 1, stdout: '', stderr: '' }
          return { status: 127, stdout: '', stderr: 'unknown command' }
        },
        readFile: (path: string) => {
          if (path === '.fallowrc.json') {
            return JSON.stringify({ entry: [], ignoreExports: [] })
          }
          return '// catalogue without the symbol\n'
        },
      },
    )

    expect(exitCode).toBe(0)
    expect(output).toHaveLength(1)
    const proof = JSON.parse(output[0]!)
    expect(proof.classification).toBe('fully-dead')
    expect(proof.safeToDelete).toBe(true)
    expect(proof.dimensions).toEqual([...REACHABILITY_DIMENSIONS])
    expect(proof.fingerprint).toMatch(/^[0-9a-f]{64}$/)
  })
})
