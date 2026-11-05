import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// While the replacement pipeline runs beside the original, two things must stay
// true: the contexts branch protection requires today keep their names, and the
// new `ci` and `image` aggregators gate everything the original jobs gate. This
// file goes when the original jobs do.

const ROOT = resolve(import.meta.dirname, '../..')
const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
const packageJson = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}

const jobs = new Map(
  workflow
    .slice(workflow.indexOf('\njobs:\n'))
    .split(/\n(?= {2}[\w-]+:\n)/u)
    .slice(1)
    .map((block) => [block.trim().split(':')[0]!, block] as const),
)

function job(id: string): string {
  const block = jobs.get(id)
  if (block === undefined) throw new Error(`ci.yml has no job ${id}`)
  return block
}

function needs(id: string): readonly string[] {
  const list = /^ {4}needs: \[([^\]]*)\]/mu.exec(job(id))?.[1]
  return list === undefined ? [] : list.split(',').map((name) => name.trim())
}

const ORIGINAL_JOBS = [
  'static',
  'test-unit',
  'test-integration',
  'artifacts',
  'check',
  'docker-images',
  'docker',
  'secrets',
  'storybook-test',
  'e2e-shard',
  'e2e',
] as const
const REPLACEMENT_GATES = [
  'lint',
  'typecheck',
  'unit',
  'integration',
  'probes',
  'browser',
] as const
const REPLACEMENT_IMAGE_JOBS = ['image-build', 'image-scan'] as const

describe('the replacement pipeline beside the original', () => {
  it('keeps every job the original pipeline has, under its name', () => {
    expect([...jobs.keys()]).toEqual(expect.arrayContaining([...ORIGINAL_JOBS]))
    // The contexts branch protection requires: renaming one strands every PR.
    for (const context of ['check', 'docker', 'e2e', 'secrets']) {
      expect(job(context)).not.toMatch(/^ {4}name:/mu)
    }
    expect(job('docker-images')).toContain('name: docker image group (')
    expect(job('e2e-shard')).toContain('name: e2e shard (')
  })

  it('gathers every gate in `ci` and both image jobs in `image`', () => {
    expect(needs('ci')).toEqual([...REPLACEMENT_GATES])
    expect(needs('image')).toEqual([...REPLACEMENT_IMAGE_JOBS])
    for (const aggregate of ['ci', 'image']) {
      expect(job(aggregate)).toContain('if: always()')
    }
  })

  it('has no replacement job outside the two aggregators', () => {
    const replacement = [...REPLACEMENT_GATES, ...REPLACEMENT_IMAGE_JOBS, 'ci', 'image']
    const added = [...jobs.keys()].filter(
      (id) => !(ORIGINAL_JOBS as readonly string[]).includes(id),
    )

    expect(added.sort()).toEqual(replacement.sort())
  })

  it('bounds every replacement job, as every original job is', () => {
    for (const id of jobs.keys()) {
      expect(job(id), `${id} sets timeout-minutes`).toMatch(/^ {4}timeout-minutes: \d+/mu)
    }
  })

  it('runs every gate the original static, test and e2e jobs run', () => {
    const originalGates = [
      'pnpm check:dependency-audit',
      'pnpm check:licenses',
      'pnpm check:action-pins',
      'pnpm check:container-images',
      'pnpm format:check',
      'pnpm typecheck',
      'pnpm auth:migrate',
      'pnpm db:migrate',
      'pnpm db:migrate-deploy',
      'pnpm check:schema-drift',
      'pnpm test:integration',
      '--project=unit',
      'pnpm build',
      'pnpm check:security-headers',
      'pnpm check:language-verifier',
      'pnpm check:bundles',
      'pnpm check:production-artifacts',
      '--require-source-maps .output/client-source-maps',
      '--require-source-maps dist-worker',
      'pnpm test:e2e --project=critical',
      'pnpm test:e2e --project=full',
    ]
    const original = ORIGINAL_JOBS.map(job).join('\n')
    const replacement = [...REPLACEMENT_GATES].map(job).join('\n')

    for (const gate of originalGates) {
      expect(original, `the original pipeline runs ${gate}`).toContain(gate)
      expect(replacement, `the replacement pipeline runs ${gate}`).toContain(gate)
    }
  })

  it('splits `lint:ci` into the two commands its jobs run, losing none', () => {
    expect(packageJson.scripts['lint:ci']).toBe(
      'pnpm lint:static && pnpm check:unchecked-indexed-access',
    )
    expect(job('static')).toContain('pnpm lint:ci')
    expect(job('lint')).toContain('pnpm lint:static')
    expect(job('typecheck')).toContain('pnpm check:unchecked-indexed-access')
  })

  it('shards the unit and integration tests over every file once', () => {
    expect(job('unit')).toMatch(/shard: \[1, 2, 3, 4\]/u)
    expect(job('unit')).toContain('--shard=${{ matrix.shard }}/4')
    expect(job('integration')).toMatch(/shard: \[1, 2\]/u)
    expect(job('integration')).toContain('--shard=${{ matrix.shard }}/2')
    expect(job('browser')).toMatch(/shard: \[1, 2, 3, 4, 5\]/u)
    expect(job('browser')).toContain('--shard=${{ matrix.shard }}/5')
  })

  it('runs the full suite and the compatibility viewport once, on one shard', () => {
    const browser = job('browser')

    expect(browser.match(/--project=full/gu)).toHaveLength(1)
    expect(browser.match(/--project=compat-mobile-android/gu)).toHaveLength(1)
    expect(browser.match(/if: matrix\.shard == 2/gu)).toHaveLength(2)
  })

  it('leaves Firefox and WebKit to the weekly workflow, which runs all four projects', () => {
    const weekly = readFileSync(
      resolve(ROOT, '.github/workflows/browser-matrix.yml'),
      'utf8',
    )

    expect(job('browser')).not.toMatch(
      /playwright install[^\n]*(firefox|webkit)|--project=compat-(firefox|webkit|mobile-ios)/iu,
    )
    expect(job('browser')).toContain('install-playwright-deps.sh chromium\n')
    expect(weekly).toContain('schedule:')
    expect(weekly).toContain('pnpm test:e2e:compatibility')
    expect(packageJson.scripts['test:e2e:compatibility']).toBe(
      'playwright test --project=compat-firefox --project=compat-webkit --project=compat-mobile-android --project=compat-mobile-ios',
    )
  })

  it('runs the stack from the loaded image and fails if it is missing', () => {
    expect(job('browser')).toContain("E2E_STACK_PREBUILT: '1'")
    expect(job('browser')).toContain('repkey-local-web:${SOURCE_REVISION}')
    expect(job('browser')).not.toContain('docker buildx build')
    expect(
      readFileSync(resolve(ROOT, 'scripts/e2e/stack-services.sh'), 'utf8'),
    ).toContain('[ "${E2E_STACK_PREBUILT:-}" = 1 ] && build=--no-build')
  })
})
