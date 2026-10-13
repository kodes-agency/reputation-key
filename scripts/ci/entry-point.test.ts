import { spawnSync } from 'node:child_process'
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { isEntryPoint } from './entry-point'

const ROOT = resolve(import.meta.dirname, '../..')

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

/** A real directory whose name holds a space, as a checkout under "My Projects" does. */
function directoryWithSpace(): string {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'gate entry ')))
  directories.push(directory)
  return directory
}

/** This checkout, reached through a symbolic link, as macOS reaches `/tmp`. */
function linkedCheckout(): string {
  const link = join(directoryWithSpace(), 'checkout')
  symlinkSync(ROOT, link)
  return link
}

function runGate(script: string): string {
  const result = spawnSync(process.execPath, ['--import', 'tsx', script], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return `${result.stdout}${result.stderr}`
}

// Each gate with what it prints when it runs, pass or fail. The index-access
// gate type-checks the repository for minutes, so the source check below
// stands in for it.
const GATES = [
  ['scripts/ci/check-runtime-environment-contract.ts', '[runtime-environment-contract]'],
  ['scripts/ci/check-container-image-policy.ts', '[container-images]'],
  ['scripts/ci/check-typescript-project-coverage.ts', '[typescript-project-coverage]'],
  ['scripts/ci/check-product-state-consistency.ts', 'Product-state slice:'],
  ['scripts/ci/check-file-length.ts', '[file-length]'],
] as const

describe('gate entry points', () => {
  // R1A-08: started through a link, each of these printed nothing and exited 0.
  it.each(GATES)('%s runs when it is started through a symbolic link', (gate, marker) => {
    expect(runGate(join(linkedCheckout(), gate))).toContain(marker)
  })

  it('leaves no gate comparing its own address with process.argv[1] as text', () => {
    const gates = [
      ...readdirSync(join(ROOT, 'scripts/ci')).map((name) => `scripts/ci/${name}`),
      'scripts/check-migration-journal.ts',
      'scripts/check-google-provider-identifiers.mjs',
    ].filter((path) => /\.(?:ts|mjs)$/u.test(path) && !path.endsWith('.test.ts'))
    const comparingText = gates.filter((path) => {
      const source = readFileSync(join(ROOT, path), 'utf8')
      return /process\.argv\[1\]/u.test(source) && !/realpathSync\(/u.test(source)
    })

    expect(gates).toContain('scripts/ci/check-unchecked-indexed-access.ts')
    expect(comparingText).toEqual([])
  })
})

describe('isEntryPoint', () => {
  function scriptIn(directory: string): string {
    const script = join(directory, 'check-something.ts')
    writeFileSync(script, '')
    return script
  }

  it('recognises the script by its own path, percent-encoded in the module address', () => {
    const script = scriptIn(directoryWithSpace())

    expect(pathToFileURL(script).href).toContain('gate%20entry')
    expect(isEntryPoint(pathToFileURL(script).href, script)).toBe(true)
  })

  it('recognises the script when the process was started through a symbolic link', () => {
    const real = directoryWithSpace()
    const script = scriptIn(real)
    const link = join(directoryWithSpace(), 'link')
    symlinkSync(real, link)

    expect(
      isEntryPoint(pathToFileURL(script).href, join(link, 'check-something.ts')),
    ).toBe(true)
  })

  it('is false when the process was started with another script', () => {
    const directory = directoryWithSpace()
    const other = join(directory, 'runner.js')
    writeFileSync(other, '')

    expect(isEntryPoint(pathToFileURL(scriptIn(directory)).href, other)).toBe(false)
  })

  // `node -e` starts no script. A process is spawned because passing
  // `undefined` here would only select the default, this test run's own start.
  it('is false when the process was started with no script', () => {
    const answer =
      "import { isEntryPoint } from './scripts/ci/entry-point.ts'\n" +
      'console.log(JSON.stringify([process.argv[1] ?? null, isEntryPoint(import.meta.url)]))'
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', answer],
      { cwd: ROOT, encoding: 'utf8' },
    )

    expect(result.stdout.trim()).toBe('[null,false]')
  })

  it('is false inside this test run, which a test runner started', () => {
    expect(isEntryPoint(import.meta.url)).toBe(false)
  })

  it('refuses to answer for a started script that is not a file', () => {
    const script = scriptIn(directoryWithSpace())

    expect(() =>
      isEntryPoint(pathToFileURL(script).href, script.replace(/\.ts$/u, '')),
    ).toThrow(
      /is not a file, so this script cannot tell whether it was started directly/u,
    )
  })
})
