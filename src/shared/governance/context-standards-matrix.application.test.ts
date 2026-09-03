import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTEXT_STANDARDS_AUTHORITY } from './context-standards-authority'
import {
  auditApplicationResultFlows,
  auditDomainNativeErrorThrows,
  auditRepositoryPorts,
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
        auditApplicationResultFlows(
          productionTypescriptFiles(
            join(ROOT, 'src', 'contexts', directory, 'application', 'use-cases'),
          ).filter(({ path }) => !path.endsWith('/test-fixtures.ts')),
        ),
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
