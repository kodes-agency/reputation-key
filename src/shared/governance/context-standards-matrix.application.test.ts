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
      badge: [0, 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
      dashboard: [14, 'ee90193f4c8ec8b3b0bce00f3dbbf1bf7f8aadaddc2e1859548184328df47eb9'],
      goal: [12, '032af051c9728ccb192c8f460e20d748821f379f869afce3f1bfc9ecb0580d94'],
      guest: [14, '6ed0c6e6d39f73a05b1dbdbcd688fb1efd273d7aa65a03d95bbf2dcc8328a969'],
      identity: [24, 'eb4a23a5fe6e2406b563ab0900ad67863094722d330d0134d70b5c7b0d1106d8'],
      inbox: [9, 'f20ff8fae4d61e208ed158d2225e0ea3ebc60d52f9f9cff98e7927b3be7c39a0'],
      integration: [
        12,
        '56e870a5c2227fb63c357c1db528dfc0c37d2eddb4c251e3595f53e2814adf6e',
      ],
      leaderboard: [
        0,
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      ],
      metric: [9, '3ae748e6ed7858b083a2f6eb27ac629ab46a3468b69344f96706cedbc75acdee'],
      notification: [
        1,
        '2454b36453b2d638eb5a6961c767d12658d1876c35fd281ab588c037452dbe45',
      ],
      portal: [54, '48e4c73b2f77c36b9d56c2d4c4d4ec21c01ce533fcac18eb11701abc0ee25ad1'],
      property: [16, '616bea14658d29c9a621cb32c1e863feca4b5f7b40ac256c49d593c1396e3fa6'],
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
      activity: [8, 'e83e34f513d5672ba3e56adc4798e24b1ea4f5c5ad325147a65fdda52582ea89'],
      ai: [11, 'd81c4fa5b419659d5285a6573a67d08292477248465219074dfab1bade17b52e'],
      badge: [2, 'ec771939c39abdad7234be743fb7a6e08a146dbd1be9e88149a6e26ae754ec82'],
      dashboard: [7, '7ea6222b1880ab6322a4b4230640b040e942e7aeba1f7ba71b8f8b89c88a93b0'],
      goal: [27, 'd898c7dddb7aae32be87fc568744a14fbb868abb2a68e4c103414f43e0efe2f0'],
      guest: [26, '5625f323d214e0b0ef21a6cc45f6dc60ee195be4a6f7eaef2cf7c28a95063fce'],
      identity: [47, '0498ef3fa8015e5ee244276c3fa449fafa2ab175f3ee882e30b2c8323ac65b0e'],
      inbox: [22, '183e4ec864428a18a39addae969a680a35c80a2c8e1bdf20e2d8b0027e3a5680'],
      integration: [
        17,
        'c66bb4902f9b3719899d37b68a401865c639a7b2312eb993cebc27980419154a',
      ],
      leaderboard: [
        2,
        '824aa69514e06ef17ac76bd517fa5bf5b2fc17a9012191c8f5ad8b92be834b75',
      ],
      metric: [19, '37793c01c13d9f2e69b3cda3e3894b97a3fd1b26004acf2c89cc1c225751a03c'],
      notification: [
        26,
        '35d88d4d6841987a904c4188a3135dde258ebc3f82c9c965ac72275485350f3a',
      ],
      portal: [25, '1838c17cf984c70f75b0bf29d992d911fc852b06bd05d2ecf21af7052c73524e'],
      property: [21, 'ce160987a657a9b6e7e616299499d3e2453085214dfd8e8e0a3cd860f3288089'],
      review: [21, 'aa1668c9eca762fcd85b1c6b2a19a0d70a6e08d0f4adacecb56c41358f1a8fd1'],
      staff: [11, 'ecd04009c611781fa9da4afa7e008322cfa697b86309af80e5d0432a064ea806'],
      team: [4, 'e784ff713fee4a28e9afa1b1bed5cb4ef75d9077e8422be12d7b9d8fffc7cee6'],
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
