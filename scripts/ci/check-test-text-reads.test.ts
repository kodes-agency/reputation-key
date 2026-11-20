import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  countTextReads,
  isCheckedTest,
  runTextReadGate,
  textReadCounts,
} from './check-test-text-reads'

const ROOT = resolve(import.meta.dirname, '../..')
const OFFENDER = 'src/contexts/portal/links/link-list.test.ts'
const SOURCE_READ =
  "import { readFileSync } from 'node:fs'\nreadFileSync('src/start.ts', 'utf8')\n"

describe('test text reads: what counts', () => {
  it.each([
    "readFileSync('docs/rules.md', 'utf8')",
    "readFileSync(resolve(ROOT, 'package.json'), 'utf8')",
    "readdirSync(join(ROOT, '.github/workflows'))",
    "globSync('src/**/*.ts')",
    'import.meta.glob<Record<string, unknown>>(["../db/*.ts"], { eager: true })',
    "import source from './start.ts?raw'",
  ])('counts a read of the repository: %s', (code) => {
    expect(countTextReads(code)).toBe(1)
  })

  it.each([
    "readFileSync(new URL('./vectors.json', import.meta.url), 'utf8')",
    "readFileSync(join(FIXTURES, 'gold.csv'), 'utf8')",
    "readFileSync(join(tmpdir(), 'out.txt'), 'utf8')",
    "readFileSync(join(import.meta.dirname, 'seed.sql'), 'utf8')",
    "// readFileSync('src/start.ts')",
  ])('does not count data beside the test or a temp file: %s', (code) => {
    expect(countTextReads(code)).toBe(0)
  })

  it('counts package.json even though it is JSON', () => {
    expect(countTextReads("readFileSync('package.json', 'utf8')")).toBe(1)
  })

  it('leaves the architecture suite and the CI gates alone', () => {
    expect(isCheckedTest('src/shared/architecture/layers.test.ts')).toBe(false)
    expect(isCheckedTest('scripts/ci/check-layout.test.ts')).toBe(false)
    expect(isCheckedTest('src/shared/events/registry.test.ts')).toBe(true)
    expect(isCheckedTest('src/shared/events/registry.ts')).toBe(false)
  })
})

describe('test text reads: the committed baseline', () => {
  it('passes on this repository', () => {
    expect(runTextReadGate([])).toBe(0)
  })
})

describe('test text reads: planted offenders', () => {
  const directories: string[] = []
  afterEach(() => {
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  function checkout(files: Readonly<Record<string, string>>, baseline: object) {
    const root = mkdtempSync(join(tmpdir(), 'text-reads-gate-'))
    directories.push(root)
    for (const [file, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, file)), { recursive: true })
      writeFileSync(join(root, file), content)
    }
    const baselinePath = join(root, 'text-reads.baseline.json')
    writeFileSync(baselinePath, `${JSON.stringify(baseline, null, 2)}\n`)
    return { root, baselinePath }
  }

  it('fails when a new test reads a source file as text', () => {
    const at = checkout({ [OFFENDER]: SOURCE_READ }, {})

    expect(runTextReadGate([], at)).toBe(1)
  })

  it('fails when a listed test reads one more file', () => {
    const at = checkout({ [OFFENDER]: `${SOURCE_READ}${SOURCE_READ}` }, { [OFFENDER]: 1 })

    expect(runTextReadGate([], at)).toBe(1)
  })

  it('passes a listed test that reads no more than its entry', () => {
    const at = checkout({ [OFFENDER]: SOURCE_READ }, { [OFFENDER]: 1 })

    expect(runTextReadGate([], at)).toBe(0)
  })

  it('passes a test outside the gate and a test that reads a fixture', () => {
    const at = checkout(
      {
        'src/shared/architecture/layers.test.ts': SOURCE_READ,
        'scripts/ci/check-thing.test.ts': SOURCE_READ,
        [OFFENDER]: "readFileSync(new URL('./vectors.json', import.meta.url))",
      },
      {},
    )

    expect(textReadCounts(at.root)).toEqual({})
    expect(runTextReadGate([], at)).toBe(0)
  })

  it('refuses to rewrite the baseline upwards', () => {
    const at = checkout({ [OFFENDER]: `${SOURCE_READ}${SOURCE_READ}` }, { [OFFENDER]: 1 })

    expect(runTextReadGate(['--write-baseline'], at)).toBe(1)
    expect(JSON.parse(readFileSync(at.baselinePath, 'utf8'))).toEqual({ [OFFENDER]: 1 })
  })

  it('rewrites the baseline when a test shrank', () => {
    const at = checkout({ [OFFENDER]: SOURCE_READ }, { [OFFENDER]: 3 })

    expect(runTextReadGate(['--write-baseline'], at)).toBe(0)
    expect(JSON.parse(readFileSync(at.baselinePath, 'utf8'))).toEqual({ [OFFENDER]: 1 })
  })
})

describe('test text reads: this repository', () => {
  it('counts the real offenders from the checkout', () => {
    expect(Object.keys(textReadCounts(ROOT)).length).toBeGreaterThan(0)
  })
})
