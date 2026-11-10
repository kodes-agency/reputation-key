import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { workflowSteps } from './ci-workflow-text'

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
  const list = /^ {4}needs:\s*\[([^\]]*)\]/mu.exec(job(id))?.[1]
  return list === undefined
    ? []
    : list
        .split(',')
        .map((name) => name.trim())
        .filter((name) => name !== '')
}

const INDEPENDENT_JOBS = ['secrets', 'storybook-test'] as const
const CI_GATES = [
  'lint',
  'typecheck',
  'unit',
  'integration',
  'probes',
  'browser',
  'populated-upgrade',
  'guest-quality',
] as const
const IMAGE_JOBS = ['image-build', 'image-scan'] as const

describe('CI pipeline', () => {
  it('keeps the independent checks and stable aggregate names', () => {
    expect([...jobs.keys()]).toEqual(expect.arrayContaining([...INDEPENDENT_JOBS]))
    for (const context of ['ci', 'image', 'secrets', 'storybook-test']) {
      expect(job(context)).not.toMatch(/^ {4}name:/mu)
    }
    expect(job('storybook-test')).toContain('pnpm test:storybook')
    expect(job('secrets')).toContain('Gitleaks')
  })

  it('has no dependency on a missing job', () => {
    for (const id of jobs.keys()) {
      for (const dependency of needs(id)) {
        expect(jobs.has(dependency), `${id} needs ${dependency}`).toBe(true)
      }
    }
  })

  it('gathers every gate in `ci` and both image jobs in `image`', () => {
    expect(needs('ci')).toEqual([...CI_GATES])
    expect(needs('image')).toEqual([...IMAGE_JOBS])
    for (const aggregate of ['ci', 'image']) {
      expect(job(aggregate)).toContain('if: always()')
    }
  })

  it('contains only the aggregated pipeline and independent checks', () => {
    expect([...jobs.keys()].sort()).toEqual(
      [...CI_GATES, ...IMAGE_JOBS, 'ci', 'image', ...INDEPENDENT_JOBS].sort(),
    )
  })

  for (const aggregate of ['ci', 'image']) {
    const barrier = workflowSteps(job(aggregate))[0]!
    const condition = /\n {8}if: (?:>-\n([\s\S]*?)(?=\n {8}run:)|([^\n]+))/u.exec(
      barrier.content,
    )
    const expression = (condition?.[1] ?? condition?.[2] ?? '').trim()
    const blocks = (results: Record<string, string>): boolean =>
      expression.split('||').some((clause) => {
        const contains = /^contains\(needs\.\*\.result, '(\w+)'\)$/u.exec(clause.trim())
        if (contains) return Object.values(results).includes(contains[1]!)
        const differs = /^needs\.([\w-]+)\.result != 'success'$/u.exec(clause.trim())
        if (differs) return results[differs[1]!] !== 'success'
        throw new Error(`Unsupported aggregate condition: ${clause}`)
      })

    it(`${aggregate} accepts successful dependencies`, () => {
      expect(barrier.content).toMatch(/^ {8}run: exit 1$/mu)
      expect(
        blocks(Object.fromEntries(needs(aggregate).map((id) => [id, 'success']))),
      ).toBe(false)
    })

    for (const dependency of needs(aggregate)) {
      it.each(['failure', 'cancelled', 'skipped'])(
        `${aggregate} rejects a %s result from ${dependency}`,
        (result) => {
          const results = Object.fromEntries(
            needs(aggregate).map((id) => [id, 'success']),
          )
          results[dependency] = result
          expect(barrier.content).toMatch(/^ {8}run: exit 1$/mu)
          expect(blocks(results)).toBe(true)
        },
      )
    }
  }

  it('bounds every job', () => {
    for (const id of jobs.keys()) {
      expect(job(id), `${id} sets timeout-minutes`).toMatch(/^ {4}timeout-minutes: \d+/mu)
    }
  })

  it('runs every static, test, build and browser gate', () => {
    const gates = [
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
    const pipeline = [...CI_GATES].map(job).join('\n')

    for (const gate of gates) {
      expect(pipeline, `CI runs ${gate}`).toContain(gate)
    }
  })

  it('splits `lint:ci` into the two commands its jobs run, losing none', () => {
    expect(packageJson.scripts['lint:ci']).toBe(
      'pnpm lint:static && pnpm check:unchecked-indexed-access',
    )
    expect(job('lint')).toContain('pnpm lint:static')
    expect(job('typecheck')).toContain('pnpm check:unchecked-indexed-access')
  })

  it('shards the unit and integration tests over every file once', () => {
    expect(job('unit')).toMatch(/shard: \[1, 2, 3, 4\]/u)
    expect(job('unit')).toContain('--shard=${{ matrix.shard }}/4')
    expect(job('integration')).toMatch(/shard: \[1, 2, 3\]/u)
    expect(job('integration')).toContain('--shard=${{ matrix.shard }}/3')
    expect(job('browser')).toMatch(/shard: \[1, 2, 3, 4, 5, 6\]/u)
    expect(job('browser')).toContain('--shard=${{ matrix.shard }}/6')
  })

  it('runs the full suite and the compatibility viewport once each, on the lightest shards', () => {
    const browser = job('browser')

    expect(browser.match(/--project=full/gu)).toHaveLength(1)
    expect(browser.match(/--project=compat-mobile-android/gu)).toHaveLength(1)
    expect(browser).toMatch(/id: e2e_full\n {8}if: matrix\.shard == 1\n/u)
    expect(browser).toMatch(/id: e2e_compatibility\n {8}if: matrix\.shard == 3\n/u)
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
