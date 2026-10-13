import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// The changed-code gate is a script that runs from top to bottom against the
// repository it sits in, so these tests run the real file as a process inside
// a throwaway repository: `main` holds one commit, the branch adds the files
// each case names, and the gate judges that branch.

const ROOT = resolve(import.meta.dirname, '../..')
const GATE = 'scripts/check-changed-code.mjs'
const RUNTIME_MODULE = 'export const answer = (): number => 42\n'

const repositories: string[] = []

afterEach(() => {
  for (const repository of repositories.splice(0)) {
    rmSync(repository, { recursive: true, force: true })
  }
})

/** The caller's environment without the variables that point git at another repository. */
function environment(): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(
    ([name]) => !name.startsWith('GIT_'),
  )
  return { ...Object.fromEntries(inherited), CHANGED_CODE_BASE: 'main', CI: 'true' }
}

function git(repository: string, args: readonly string[]): void {
  const identity = [
    '-c',
    'user.name=gate-test',
    '-c',
    'user.email=gate-test@example.test',
  ]
  const quiet = ['-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null']
  const result = spawnSync('git', [...identity, ...quiet, ...args], {
    cwd: repository,
    encoding: 'utf8',
    env: environment(),
  })
  if (result.status !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`)
}

function write(repository: string, files: Readonly<Record<string, string>>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repository, path)), { recursive: true })
    writeFileSync(join(repository, path), content)
  }
}

/** A repository whose `main` holds the gate and whose branch adds `added`. */
function repositoryAdding(added: Readonly<Record<string, string>>): string {
  // The gate works from its own real path, so the fixture names files by theirs.
  const repository = realpathSync(mkdtempSync(join(tmpdir(), 'changed-code-gate-')))
  repositories.push(repository)
  mkdirSync(join(repository, 'scripts'))
  copyFileSync(join(ROOT, GATE), join(repository, GATE))
  // The gate imports `typescript`; resolve it from this checkout's packages.
  symlinkSync(join(ROOT, 'node_modules'), join(repository, 'node_modules'))
  // `src/client.tsx` is the gate's one registered exemption, and an entry for
  // a file that is gone fails every run.
  write(repository, {
    '.gitignore': 'node_modules\ncoverage\n',
    'src/client.tsx': RUNTIME_MODULE,
  })
  git(repository, ['init', '--quiet', '--initial-branch=main'])
  git(repository, ['add', '--all'])
  git(repository, ['commit', '--quiet', '--message=base'])
  git(repository, ['switch', '--quiet', '--create', 'change'])
  write(repository, added)
  git(repository, ['add', '--all'])
  git(repository, ['commit', '--quiet', '--message=change'])
  return repository
}

function runGate(repository: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [join(repository, GATE)], {
    cwd: repository,
    encoding: 'utf8',
    env: environment(),
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

const importing = (specifier: string): string =>
  `import { answer } from '${specifier}'\nexport const reached = answer\n`

describe('changed-code gate', () => {
  it('fails a new runtime module that no test imports', () => {
    const gate = runGate(
      repositoryAdding({ 'src/contexts/review/domain/rule.ts': RUNTIME_MODULE }),
    )

    expect(gate.output).toContain('✗ src/contexts/review/domain/rule.ts')
    expect(gate.status).toBe(1)
  })

  it('passes a new runtime module that a test imports', () => {
    const gate = runGate(
      repositoryAdding({
        'src/contexts/review/domain/rule.ts': RUNTIME_MODULE,
        'src/contexts/review/domain/rule.test.ts': importing('./rule'),
      }),
    )

    expect(gate.output).toContain('1 runtime-gated')
    expect(gate.status).toBe(0)
  })

  // The one relaxation, pinned so the header and the workflow comment cannot
  // call it a test of the module: a test that imports the importer is enough.
  it('passes a new module that is one import away from a test, with no test of its own', () => {
    const gate = runGate(
      repositoryAdding({
        'src/contexts/review/infrastructure/store.ts': RUNTIME_MODULE,
        'src/contexts/review/build.ts': importing('./infrastructure/store'),
        'src/contexts/review/build.test.ts': importing('./build'),
      }),
    )

    expect(gate.output).toContain('2 runtime-gated')
    expect(gate.status).toBe(0)
  })

  it('fails a new module that is two imports away from a test', () => {
    const gate = runGate(
      repositoryAdding({
        'src/contexts/review/infrastructure/query.ts': RUNTIME_MODULE,
        'src/contexts/review/infrastructure/store.ts': importing('./query'),
        'src/contexts/review/build.ts': importing('./infrastructure/store'),
        'src/contexts/review/build.test.ts': importing('./build'),
      }),
    )

    expect(gate.output).toContain('✗ src/contexts/review/infrastructure/query.ts')
    expect(gate.status).toBe(1)
  })

  // R1A-07: nothing in CI writes a coverage report, so a report left behind by
  // a local run must not let a file through that CI would refuse.
  it('does not take a coverage report in the working tree as evidence', () => {
    const repository = repositoryAdding({
      'src/contexts/review/domain/rule.ts': RUNTIME_MODULE,
    })
    const covered = { total: 1, covered: 1, skipped: 0, pct: 100 }
    write(repository, {
      'coverage/coverage-summary.json': JSON.stringify({
        [join(repository, 'src/contexts/review/domain/rule.ts')]: {
          statements: covered,
          functions: covered,
        },
      }),
    })

    const gate = runGate(repository)

    expect(gate.output).toContain('✗ src/contexts/review/domain/rule.ts')
    expect(gate.status).toBe(1)
  })

  // R1A-11: an API route is a server handler, not a page.
  it('fails a new API route that no test imports', () => {
    const gate = runGate(
      repositoryAdding({ 'src/routes/api/webhooks/provider/events.ts': RUNTIME_MODULE }),
    )

    expect(gate.output).toContain('✗ src/routes/api/webhooks/provider/events.ts')
    expect(gate.status).toBe(1)
  })

  it('passes a new API route with a test beside it', () => {
    const gate = runGate(
      repositoryAdding({
        'src/routes/api/webhooks/provider/events.ts': RUNTIME_MODULE,
        'src/routes/api/webhooks/provider/-events.test.ts': importing('./events'),
      }),
    )

    expect(gate.output).toContain('1 runtime-gated')
    expect(gate.status).toBe(0)
  })

  it('leaves pages and components to their own checks', () => {
    const gate = runGate(
      repositoryAdding({
        'src/routes/_authenticated/thing.tsx': RUNTIME_MODULE,
        'src/components/features/thing/thing.tsx': RUNTIME_MODULE,
      }),
    )

    expect(gate.output).toContain('0 source candidate(s)')
    expect(gate.status).toBe(0)
  })
})
