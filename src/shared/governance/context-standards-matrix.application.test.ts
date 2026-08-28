import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTEXT_STANDARDS_AUTHORITY } from './context-standards-authority'
import {
  auditApplicationResultFlows,
  auditContextFileNames,
  auditDomainNativeErrorThrows,
  auditRepositoryPorts,
  auditUseCaseTypeTriples,
} from './context-standards-current-tree'
import { CONTEXT_STANDARDS_MATRIX } from './context-standards-matrix'

const ROOT = process.cwd()

type Source = Readonly<{ path: string; body: string }>

function productionTypescriptFiles(directory: string): readonly Source[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return productionTypescriptFiles(path)
    return entry.name.endsWith('.ts') && !entry.name.includes('.test.')
      ? [{ path: relative(ROOT, path), body: readFileSync(path, 'utf8') }]
      : []
  })
}

function allTypescriptFiles(directory: string): readonly Source[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return allTypescriptFiles(path)
    return entry.name.endsWith('.ts')
      ? [{ path: relative(ROOT, path), body: readFileSync(path, 'utf8') }]
      : []
  })
}

function useCaseSources(directory: string): readonly Source[] {
  return productionTypescriptFiles(
    join(ROOT, 'src', 'contexts', directory, 'application', 'use-cases'),
  ).filter(({ path }) => !path.endsWith('/test-fixtures.ts'))
}

function repositoryPortSources(directory: string): readonly Source[] {
  return [
    ...productionTypescriptFiles(join(ROOT, 'src', 'contexts', directory, 'application')),
    ...productionTypescriptFiles(join(ROOT, 'src', 'contexts', directory, 'ports')),
  ]
}

function domainSources(directory: string): readonly Source[] {
  return productionTypescriptFiles(join(ROOT, 'src', 'contexts', directory, 'domain'))
}

describe('application error-flow standards matrix proof', () => {
  it('detects async Result propagation in an independent negative fixture', () => {
    expect(
      auditApplicationResultFlows([
        {
          path: 'example.ts',
          body: 'export const example = async (): Promise<Result<string, Error>> => ok(1)',
        },
      ]),
    ).toEqual(['example.ts: async application orchestration returns Result'])
  })

  it('detects native domain errors in an independent negative fixture', () => {
    expect(
      auditDomainNativeErrorThrows([
        {
          path: 'src/contexts/example/domain/rules.ts',
          body: "if (!valid) throw new Error('invalid')",
        },
      ]),
    ).toEqual([
      'src/contexts/example/domain/rules.ts: domain throws a native or untagged error',
    ])
  })

  it('keeps the exact legacy async Result inventory visible and classifies every context', () => {
    const resultIssuesByContext = Object.fromEntries(
      CONTEXT_STANDARDS_AUTHORITY.map(({ directory }) => [
        directory,
        auditApplicationResultFlows(useCaseSources(directory)),
      ]),
    )

    expect(resultIssuesByContext.goal).toEqual([
      'src/contexts/goal/application/use-cases/cancel-goal.ts: async application orchestration returns Result',
      'src/contexts/goal/application/use-cases/create-goal.ts: async application orchestration returns Result',
      'src/contexts/goal/application/use-cases/get-goal.ts: async application orchestration returns Result',
      'src/contexts/goal/application/use-cases/list-goals.ts: async application orchestration returns Result',
      'src/contexts/goal/application/use-cases/system-cancel-goal.ts: async application orchestration returns Result',
      'src/contexts/goal/application/use-cases/update-goal.ts: async application orchestration returns Result',
    ])
    expect(resultIssuesByContext.review).toEqual([
      'src/contexts/review/application/use-cases/reconcile-reply-publication.ts: async application orchestration returns Result',
    ])

    for (const row of CONTEXT_STANDARDS_MATRIX) {
      const cell = row.standards.errors
      if (cell.applicability === 'not_applicable') continue
      const issues = [
        ...(resultIssuesByContext[row.directory] ?? []),
        ...auditDomainNativeErrorThrows(domainSources(row.directory)),
      ]
      expect(cell.resolution, `${row.directory}: ${issues.join('\n')}`).toBe(
        issues.length === 0 ? 'evidenced' : 'accepted_exception',
      )
    }
  })

  it('pins every native domain-error variance exactly', () => {
    const expected = {
      activity: [
        'src/contexts/activity/domain/recent-activity-replay-fact.ts: domain throws a native or untagged error',
      ],
      guest: [
        'src/contexts/guest/domain/guest-response-integrity.ts: domain throws a native or untagged error',
      ],
      identity: [
        'src/contexts/identity/domain/organization-lifecycle.ts: domain throws a native or untagged error',
      ],
      metric: [
        'src/contexts/metric/domain/portal-lifetime-aggregate.ts: domain throws a native or untagged error',
      ],
      notification: [
        'src/contexts/notification/domain/notification-delivery-policy.ts: domain throws a native or untagged error',
      ],
      review: [
        'src/contexts/review/domain/material-review-revision.ts: domain throws a native or untagged error',
      ],
    } as const

    for (const row of CONTEXT_STANDARDS_MATRIX) {
      if (row.standards.errors.applicability === 'not_applicable') continue
      expect(auditDomainNativeErrorThrows(domainSources(row.directory))).toEqual(
        expected[row.directory as keyof typeof expected] ?? [],
      )
    }
  })
})

describe('use-case type-triple standards matrix proof', () => {
  it('detects each absent export in an independent negative fixture', () => {
    expect(
      auditUseCaseTypeTriples([
        {
          path: 'example.ts',
          body: 'export const doThing = (_input: DoThingInput): boolean => true\nexport type DoThingInput = Readonly<{}>',
        },
      ]),
    ).toEqual([
      'example.ts#doThing: missing exported Deps type',
      'example.ts#doThing: missing exported ReturnType alias',
    ])
  })

  it('does not mistake an exported object containing callbacks for a use case', () => {
    expect(
      auditUseCaseTypeTriples([
        {
          path: 'example.ts',
          body: 'export const registry = { run: () => true }',
        },
      ]),
    ).toEqual([])
  })

  it('pins every retained variance and classifies all applicable contexts explicitly', () => {
    const expected = {
      activity: [20, 'f1368187afc81251fbf55b9f0c9d36c34b134a7115d9b5041f6e9c2b20d56b9d'],
      ai: [41, 'ecdadec8bf39a2ac3d11c57e4e6b240c999a3e49f4df899f6d52283c2eafc506'],
      dashboard: [14, 'ee90193f4c8ec8b3b0bce00f3dbbf1bf7f8aadaddc2e1859548184328df47eb9'],
      goal: [12, '032af051c9728ccb192c8f460e20d748821f379f869afce3f1bfc9ecb0580d94'],
      guest: [14, '6ed0c6e6d39f73a05b1dbdbcd688fb1efd273d7aa65a03d95bbf2dcc8328a969'],
      identity: [24, 'eb4a23a5fe6e2406b563ab0900ad67863094722d330d0134d70b5c7b0d1106d8'],
      inbox: [9, 'f20ff8fae4d61e208ed158d2225e0ea3ebc60d52f9f9cff98e7927b3be7c39a0'],
      integration: [
        12,
        '56e870a5c2227fb63c357c1db528dfc0c37d2eddb4c251e3595f53e2814adf6e',
      ],
      metric: [9, '3ae748e6ed7858b083a2f6eb27ac629ab46a3468b69344f96706cedbc75acdee'],
      notification: [
        1,
        '2454b36453b2d638eb5a6961c767d12658d1876c35fd281ab588c037452dbe45',
      ],
      portal: [54, '48e4c73b2f77c36b9d56c2d4c4d4ec21c01ce533fcac18eb11701abc0ee25ad1'],
      property: [14, '7a91b72ade43f7570630384d24ec00046208f410cbbb7e998e1de6f1dc506764'],
      review: [17, 'cf439ce68311e0017af5ecb55269d132948902349a4ff552084d26672e685a64'],
      staff: [14, 'af6b1f6facafd98e5bb9485adda53789f1e463a70d54bfde492dac707d1cde31'],
      team: [14, '18672f1772d093abca05f6caef4716eec19bf85ab7b7635bab4aebc9ab1134c5'],
    } as const

    for (const row of CONTEXT_STANDARDS_MATRIX) {
      const cell = row.standards.triple
      if (cell.applicability === 'not_applicable') continue
      const issues = auditUseCaseTypeTriples(useCaseSources(row.directory))
      const digest = createHash('sha256').update(issues.join('\n')).digest('hex')
      expect([issues.length, digest], `${row.directory}:\n${issues.join('\n')}`).toEqual(
        expected[row.directory as keyof typeof expected],
      )
      expect(cell.resolution).toBe('accepted_exception')
    }
  })
})

describe('context-layer filename standards matrix proof', () => {
  it('detects layer suffix and mirrored-test violations in independent fixtures', () => {
    expect(
      auditContextFileNames([
        { path: 'src/contexts/example/domain/not-camel.ts', body: '' },
        {
          path: 'src/contexts/example/infrastructure/jobs/send-email.ts',
          body: '',
        },
        {
          path: 'src/contexts/example/server/account.integration.test.ts',
          body: '',
        },
      ]),
    ).toEqual([
      'src/contexts/example/domain/not-camel.ts: domain files use camelCase and tests mirror source',
      'src/contexts/example/infrastructure/jobs/send-email.ts: job files end in .job.ts and tests mirror source',
      'src/contexts/example/server/account.integration.test.ts: handler/server files use kebab-case and tests mirror source',
    ])
  })

  it('pins every retained filename variance and classifies all contexts explicitly', () => {
    const expected = {
      activity: [7, 'c98cec543b73369f083348301ef8bdde6271c170ad09780a6e5ef605254e21c8'],
      ai: [10, '098c2971f712bcf78a59bf422f56e859a0e329957944c0d9b760105c34c0b1ae'],
      badge: [1, '990ecec1cdc06bbef0086cbab4a358b07608821a01ebfb2b1ff715f7d291b341'],
      dashboard: [6, '3f74d90f9f191c6ba7de8c1a2565ef80c6c45d2b6e6905d5f9c6378f2dae2a51'],
      goal: [26, 'f19a8b9fcb7f3c87f022d9f7a740489cac234e2ef8cc65b031017d4060603d8c'],
      guest: [24, '83872f2e3770517086c11cdd583b0874733d1bdb8b16477d783f5b22fe6ca683'],
      identity: [47, '0498ef3fa8015e5ee244276c3fa449fafa2ab175f3ee882e30b2c8323ac65b0e'],
      inbox: [19, '201953374adafe91ecc151d6a537537fec9a4b6688267a5de4114877ba438cec'],
      integration: [
        16,
        'fda5f937fe7ad6eaa69be601b7ac6f90af5f4d26c08a0710fe6198a2a97a1d9f',
      ],
      leaderboard: [
        1,
        '5c0e7882639411a91077a795b8a80bce0fdd1cf2134a3e17a7b74f64a6413339',
      ],
      metric: [18, 'f80c75862a34be5d8027bd9944d23a2a439f7be40ce24f2df4f57d3e19678451'],
      notification: [
        25,
        'bc9964c7165cd69ac76a13a623f1a0a32ebfe260fce7a80816909d57dfbf68db',
      ],
      portal: [24, '7c869f84715da2b078270c588951088b78050ddf002eb359a9d759042e50ce12'],
      property: [18, '6739505e6303693dca1a819e48db5489cead2c760d6b57e4df8c55a54e065fa8'],
      review: [20, 'a169e1cf65e35a0e2fe9d093805aa48004215cb6a612322c9c94dc59afb70f9e'],
      staff: [10, 'c675bd2a55047cdc1ca067cc233e96414b8c8db3b02056b65b1c2c01bda6af7d'],
      team: [3, 'a3e4d412de702156cf00a47b56bba98ca453d012a86c001e7cc0b217ecb0376f'],
    } as const

    for (const row of CONTEXT_STANDARDS_MATRIX) {
      const issues = auditContextFileNames(
        allTypescriptFiles(join(ROOT, 'src', 'contexts', row.directory)),
      )
      const digest = createHash('sha256').update(issues.join('\n')).digest('hex')
      expect([issues.length, digest], `${row.directory}:\n${issues.join('\n')}`).toEqual(
        expected[row.directory],
      )
      expect(row.standards.files.resolution).toBe(
        issues.length === 0 ? 'evidenced' : 'accepted_exception',
      )
    }
  })
})

describe('repository-port standards matrix proof', () => {
  it('detects misplaced and tenant-unscoped repositories in independent fixtures', () => {
    expect(
      auditRepositoryPorts([
        {
          path: 'src/contexts/example/application/legacy.ts',
          body: 'export type WidgetRepository = Readonly<{ findById(id: string): Promise<unknown> }>',
        },
      ]),
    ).toEqual([
      'src/contexts/example/application/legacy.ts#WidgetRepository: expected application/ports/widget.repository.ts',
      'src/contexts/example/application/legacy.ts#WidgetRepository.findById: tenant scope is absent',
    ])
  })

  it('checks every repository declaration and classifies the exact retained exceptions', () => {
    const expected = {
      activity: [
        'src/contexts/activity/ports/recent-activity-repository.port.ts#RecentActivityRepository: expected application/ports/recent-activity.repository.ts',
      ],
      metric: [
        'src/contexts/metric/application/ports/metric-registry.repository.port.ts#MetricRegistryRepository: expected application/ports/metric-registry.repository.ts',
      ],
      review: [
        'src/contexts/review/application/provider-subject-keyring.ts#ReviewProviderSubjectKeyInventoryRepository: expected application/ports/review-provider-subject-key-inventory.repository.ts',
      ],
    } as const

    for (const row of CONTEXT_STANDARDS_MATRIX) {
      const cell = row.standards.repositories
      if (cell.applicability === 'not_applicable') continue
      const issues = auditRepositoryPorts(repositoryPortSources(row.directory))
      expect(issues, row.directory).toEqual(
        expected[row.directory as keyof typeof expected] ?? [],
      )
      expect(cell.resolution).toBe(
        issues.length === 0 ? 'evidenced' : 'accepted_exception',
      )
    }
  })
})
