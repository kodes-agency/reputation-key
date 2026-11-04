import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SCRIPT = resolve(import.meta.dirname, 'secret-scan-range.sh')
const UNKNOWN_COMMIT = 'b'.repeat(40)

let repo = ''
let first = ''
let second = ''

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

function range(env: Readonly<Record<string, string>>): string {
  return execFileSync('bash', [SCRIPT], {
    cwd: repo,
    env: { PATH: process.env.PATH ?? '', ...env },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

describe('secret scan range', () => {
  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'secret-scan-range-'))
    git('init', '--quiet')
    git('commit', '--quiet', '--allow-empty', '-m', 'first')
    first = git('rev-parse', 'HEAD')
    git('commit', '--quiet', '--allow-empty', '-m', 'second')
    second = git('rev-parse', 'HEAD')
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('scans the commits a PR adds up to its head, not the merge commit', () => {
    expect(
      range({
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_SHA: UNKNOWN_COMMIT,
        PR_BASE_SHA: first,
        PR_HEAD_SHA: second,
      }),
    ).toBe(`${first}..${second}`)
  })

  it('refuses a PR event that lacks the head SHA', () => {
    expect(() =>
      range({
        GITHUB_EVENT_NAME: 'pull_request',
        GITHUB_SHA: second,
        PR_BASE_SHA: first,
      }),
    ).toThrow(/PR head SHA is required/)
  })

  it('scans every commit in a push', () => {
    expect(
      range({ GITHUB_EVENT_NAME: 'push', GITHUB_SHA: second, PUSH_BEFORE: first }),
    ).toBe(`${first}..${second}`)
  })

  it.each([
    ['no before', ''],
    ['an all-zero before', '0'.repeat(40)],
    ['a before the clone does not have', UNKNOWN_COMMIT],
  ])('scans only the pushed commit with %s', (_label, before) => {
    expect(
      range({ GITHUB_EVENT_NAME: 'push', GITHUB_SHA: second, PUSH_BEFORE: before }),
    ).toBe(`--max-count=1 ${second}`)
  })

  it('scans only the selected commit for a manual run', () => {
    expect(range({ GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_SHA: second })).toBe(
      `--max-count=1 ${second}`,
    )
  })
})
