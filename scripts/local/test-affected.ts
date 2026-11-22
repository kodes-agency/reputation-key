// Runs only the tests a change can reach, for a quicker loop before pushing.
// CI still runs every test.
//
//   pnpm test:affected                         unit tests
//   pnpm test:affected --project=integration   integration tests (needs the test database)
//   pnpm test:affected --since=<ref>           compare with <ref> instead of origin/main
//
// test-affected-run.ts starts it; this module only exports, so its test can
// import it without running it.
//
// A test is affected when its import graph reaches a file changed since the
// merge base with origin/main, committed or not (Vitest's --changed). Tests that
// read the repository as text (scripts/ci/text-reads.baseline.json) are always
// added, because no import connects them to the files they read. A change to
// package.json, the lockfile or a Vitest config makes Vitest select every test.

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

export type TestProject = 'unit' | 'integration'

const TEXT_READERS_PATH = 'scripts/ci/text-reads.baseline.json'

function projectOf(file: string): TestProject | 'storybook' {
  if (file.endsWith('.stories.tsx') || file.endsWith('.stories.ts')) return 'storybook'
  return file.endsWith('.integration.test.ts') ? 'integration' : 'unit'
}

/**
 * The test files to run: those `vitest list --filesOnly` printed for the
 * project (lines like `[unit] src/a.test.ts`), plus the project's text readers.
 */
export function affectedTests(
  listed: string,
  textReaders: readonly string[],
  project: TestProject,
): string[] {
  const prefix = `[${project}] `
  const fromGraph = listed
    .split('\n')
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim())
  const readers = textReaders.filter((file) => projectOf(file) === project)
  return [...new Set([...fromGraph, ...readers])].sort()
}

function option(args: readonly string[], name: string, fallback: string): string {
  const prefix = `--${name}=`
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? fallback
}

function run(
  command: string,
  args: readonly string[],
): { status: number; stdout: string } {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return { status: result.status ?? 1, stdout: result.stdout }
}

/** Lists, then runs, the affected tests; returns the exit code. */
export function runAffectedTests(args: readonly string[]): number {
  const project = option(args, 'project', 'unit')
  if (project !== 'unit' && project !== 'integration') {
    console.error(`--project must be unit or integration, not ${project}`)
    return 2
  }
  const since = option(args, 'since', 'origin/main')
  const base = run('git', ['merge-base', 'HEAD', since])
  if (base.status !== 0) {
    console.error(`No merge base with ${since}; fetch it or pass --since=<ref>.`)
    return 2
  }
  const listed = run('pnpm', [
    'exec',
    'vitest',
    'list',
    `--project=${project}`,
    `--changed=${base.stdout.trim()}`,
    '--filesOnly',
  ])
  if (listed.status !== 0) {
    console.error('vitest list failed; run it directly to see why.')
    return listed.status
  }
  const textReaders = Object.keys(
    JSON.parse(readFileSync(TEXT_READERS_PATH, 'utf8')) as Record<string, number>,
  )
  const files = affectedTests(listed.stdout, textReaders, project)
  console.log(`[test-affected] ${files.length} ${project} test file(s) since ${since}`)
  if (files.length === 0) return 0
  const vitest = spawnSync(
    'pnpm',
    ['exec', 'vitest', 'run', `--project=${project}`, ...files],
    {
      stdio: 'inherit',
    },
  )
  return vitest.status ?? 1
}
