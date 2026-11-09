import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, 'guest-quality-scope.sh')
const UNKNOWN_COMMIT = 'b'.repeat(40)

let repo = ''
let base = ''

function git(...args: readonly string[]): string {
  return execFileSync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'user.name=Test',
      '-c',
      'user.email=test@example.invalid',
      ...args,
    ],
    { cwd: repo, encoding: 'utf8' },
  ).trim()
}

function commitFile(path: string): string {
  git('checkout', '--quiet', '-B', 'work', base)
  mkdirSync(dirname(join(repo, path)), { recursive: true })
  writeFileSync(join(repo, path), `${path}\n`)
  git('add', '--', path)
  git('commit', '--quiet', '-m', path)
  return git('rev-parse', 'HEAD')
}

function scope(env: Readonly<Record<string, string>>): string {
  return execFileSync('bash', [SCRIPT], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
  }).trim()
}

function pullRequestScope(path: string): string {
  const head = commitFile(path)
  return scope({
    GITHUB_EVENT_NAME: 'pull_request',
    GITHUB_SHA: UNKNOWN_COMMIT,
    PR_BASE_SHA: base,
    PR_HEAD_SHA: head,
  })
}

describe('guest quality scope', () => {
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'guest-quality-scope-'))
    git('init', '--quiet')
    git('commit', '--quiet', '--allow-empty', '-m', 'base')
    base = git('rev-parse', 'HEAD')
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it.each([
    'src/components/features/guest/public-portal/page.tsx',
    'src/components/ui/button.tsx',
    'src/shared/db/schema/guest.schema.ts',
    'src/routes/p/$slug.tsx',
    'src/features/anything/deep/style.css',
    'tsconfig.json',
    'tsconfig.build.json',
    'package.json',
    '.github/workflows/ci.yml',
    'e2e/storybook-metrics/guest-immersive.metrics.ts',
  ])('runs for a guest change in %s', (path) => {
    expect(pullRequestScope(path)).toBe('true')
  })

  it.each([
    'README.md',
    'docs/operations/security-ci-policy.md',
    'src/contexts/ai/build.ts',
    'src/components/features/inbox/list.tsx',
    'packages/tsconfig.json',
    'drizzle/0001_x.sql',
  ])('skips for an unrelated change in %s', (path) => {
    expect(pullRequestScope(path)).toBe('false')
  })

  it('judges a push from the commits it adds', () => {
    const head = commitFile('src/lib/format.ts')
    expect(
      scope({ GITHUB_EVENT_NAME: 'push', GITHUB_SHA: head, PUSH_BEFORE: base }),
    ).toBe('true')
  })

  it.each([
    ['no before', ''],
    ['an all-zero before', '0'.repeat(40)],
    ['a before the clone does not have', UNKNOWN_COMMIT],
  ])('runs for a push with %s', (_label, before) => {
    const head = commitFile('README.md')
    expect(
      scope({ GITHUB_EVENT_NAME: 'push', GITHUB_SHA: head, PUSH_BEFORE: before }),
    ).toBe('true')
  })

  it('runs for a manual run', () => {
    expect(scope({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: base })).toBe(
      'true',
    )
  })
})
