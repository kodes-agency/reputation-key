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
      activity: [6, '7d279a9c72cb27283dc69ffd4186575d1a85138186ca156fe655927e6ef2a16c'],
      ai: [9, '8ddb01c7954f20162d136293946b21bbccf685dc8c90a92ff4727e831f4ec806'],
      badge: [0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      dashboard: [5, '04109286db02e1d3b8752b06ce1b161180e3d847b06bdbf9b2bd1d55d9d0e0de'],
      goal: [25, '88878a3a9908941392e7e6203a19b3f1520b7eae5ae018731b967b3e95431ef9'],
      guest: [23, '68dd69461cd50b0d3020216012f4494eb1162d5e0d4814e16f18a3887e4d946f'],
      identity: [47, '0498ef3fa8015e5ee244276c3fa449fafa2ab175f3ee882e30b2c8323ac65b0e'],
      inbox: [15, '72bdbf7dfc5c088c865f3010f095bb523e19ebaca615c8c80926bc9a39e3905f'],
      integration: [
        15,
        'a94f1cc20e2dbe738c8701e352231ca0b096b0d6cd14d53dbbfd63d09b2727b6',
      ],
      leaderboard: [
        0,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ],
      metric: [17, '0b4536378d46c010da626201400081b4023969147a48fab2813ca437a5ded3ad'],
      notification: [
        24,
        'e1ab29a1ab9c8cb39b1a7691e7d18e58207cc9697dff0916897bb0e14f6a71b0',
      ],
      portal: [23, 'b0416f6b47d64fa483e583b1d1eba5a54e13181d6d9f14db0066cadf5db0f37b'],
      property: [17, '8ddd89191732646e31d6ac9238cfc207f32e89301d7957a08f28f04ca32e1cb1'],
      review: [19, '0507f27b57cfacbf07e2ac1c54d7307636c5c45b3e258a1bc159bdb7ba2b9a1f'],
      staff: [9, '38c19eddfc0456f5bbe9333183b1a8e9e4878b93816e6b681909500d37f51628'],
      team: [2, '50433bffcc0eda1d0c9d81595515853391dca37543417fbcf51ca92113da6377'],
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
