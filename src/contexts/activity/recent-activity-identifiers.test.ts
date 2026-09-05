import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(process.cwd())
const ACTIVITY_ROOT = resolve(ROOT, 'src/contexts/activity')

const filesBelow = (directory: string): string[] =>
  readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    return statSync(path).isDirectory() ? filesBelow(path) : [path]
  })

const sourceFiles = filesBelow(ACTIVITY_ROOT).filter(
  (path) => /\.(?:ts|md)$/u.test(path) && !path.endsWith('.test.ts'),
)

describe('canonical Recent Activity identifiers', () => {
  it('uses canonical schema, repository, command, and Organization-feed names', () => {
    const joined = sourceFiles
      .map((path) => `${relative(ROOT, path)}\n${readFileSync(path, 'utf8')}`)
      .join('\n')

    for (const legacy of [
      /\bactivityLog\b/u,
      /\bActivityLogId\b/u,
      /\binsertActivityLog\b/u,
      /\bInsertActivityLog\w*\b/u,
      /\bgetOrgActivity\b/u,
      /\bGetOrgActivity\w*\b/u,
      /\bcreateActivityRepository\b/u,
      /(?<!Recent)\bActivityRepository\b/u,
      /\bactivityRepo\b/u,
      /(?<!recent-)activity-repository/u,
    ]) {
      expect(joined, `active Activity source still matches ${legacy}`).not.toMatch(legacy)
    }
  })

  it('never enqueues the legacy job name from an active Activity producer', () => {
    const producers = filesBelow(resolve(ACTIVITY_ROOT, 'infrastructure')).filter(
      (path) =>
        path.endsWith('.ts') &&
        !path.endsWith('.test.ts') &&
        !path.endsWith('project-recent-activity.job.ts'),
    )
    for (const path of producers) {
      expect(readFileSync(path, 'utf8'), relative(ROOT, path)).not.toContain(
        `'${['insert', 'activity', 'log'].join('-')}'`,
      )
    }
  })

  it('keeps old physical/job names only in the explicit rolling compatibility authorities', () => {
    const activeTypeScript = filesBelow(resolve(ROOT, 'src')).filter(
      (path) => path.endsWith('.ts') && !path.endsWith('.test.ts'),
    )
    const filesContaining = (needle: string): string[] =>
      activeTypeScript
        .filter((path) => readFileSync(path, 'utf8').includes(needle))
        .map((path) => relative(ROOT, path))
        .sort()

    expect(filesContaining("'insert-activity-log'")).toEqual([
      'src/contexts/activity/infrastructure/jobs/project-recent-activity.job.ts',
      'src/shared/governance/entry-point-catalogue.ts',
      'src/shared/governance/event-job-catalogue.ts',
      'src/shared/ops/identity-invitation-fact-contract.ts',
      'src/shared/outbox/identity-invitation-fact-contract.ts',
    ])
    // `activity_log` was a rollback-compatibility view with no pgTable, so the
    // regenerated baseline does not create it and the register no longer names
    // it. Nothing in the tree may reintroduce the physical name.
    expect(filesContaining("name: 'activity_log'")).toEqual([])
  })
})
