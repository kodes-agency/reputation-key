// Where the image build and CI run the checks whose behaviour is tested beside
// them: the production artifact check (src/shared/testing/production-artifact-
// boundary.test.ts) and the Redis requirement arm (src/shared/testing/
// redis-test-lease.test.ts). Those tests prove each check refuses; these pin
// that the build and the workflows still run it.
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../../..')

describe('where the builds run the artifact check', () => {
  const ARTIFACT_CHECK = 'scripts/check-production-artifacts.mjs'

  it('the image build reads the worker maps before it deletes them', () => {
    const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8')
    const withMaps = dockerfile.indexOf(
      `node ${ARTIFACT_CHECK} --require-source-maps dist-worker .output dist-worker`,
    )
    const deletion = dockerfile.indexOf("-name '*.map' -delete")
    const shipped = dockerfile.lastIndexOf(`node ${ARTIFACT_CHECK} .output dist-worker`)

    expect(withMaps).toBeGreaterThan(-1)
    expect(deletion).toBeGreaterThan(withMaps)
    // What ships is still checked after the deletion: the Nitro manifest must
    // not list a map the image no longer has.
    expect(shipped).toBeGreaterThan(deletion)
  })

  it('CI requires the client and worker maps on every commit', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/ci.yml'), 'utf8')

    expect(workflow).toMatch(
      /pnpm check:production-artifacts\s+--require-source-maps \.output\/client-source-maps\s+--require-source-maps dist-worker\s+\.output\s+dist-worker\n/u,
    )
  })
})

// The Redis requirement arm only protects CI if the job that runs the
// Redis-backed suites sets it, and only a job that has a Redis service may set it.
describe('CI wiring of the Redis requirement', () => {
  const WORKFLOWS = join(ROOT, '.github/workflows')
  const RUNS_INTEGRATION = /test:integration|--project=integration/u
  const SETS_REQUIREMENT = /^\s+REQUIRE_TEST_REDIS:/mu
  const REQUIRES_REDIS = /^\s+REQUIRE_TEST_REDIS: '1'$/mu
  const REDIS_SERVICE = /^ {4}services:\n(?:.*\n)*? {6}redis:$/mu

  const jobs = readdirSync(WORKFLOWS)
    .filter((file) => file.endsWith('.yml'))
    .flatMap((file) => {
      const text = readFileSync(join(WORKFLOWS, file), 'utf8')
      const body = text.slice(text.indexOf('\njobs:\n'))
      return body
        .split(/\n(?= {2}[\w-]+:\n)/u)
        .slice(1)
        .map((block) => ({ id: `${file}#${block.trim().split(':')[0]}`, block }))
    })

  it('requires Redis in every step that runs the integration project, beside a Redis service', () => {
    const integrationJobs = jobs.filter(({ block }) => RUNS_INTEGRATION.test(block))
    // A new job that runs the integration project joins this list only with
    // a Redis service and the requirement on its test step.
    expect(integrationJobs.map(({ id }) => id)).toEqual(['ci.yml#integration'])

    for (const { id, block } of integrationJobs) {
      const steps = block
        .split(/\n(?= {6}- )/u)
        .filter((step) => RUNS_INTEGRATION.test(step))
      expect(block, `${id} declares a Redis service`).toMatch(REDIS_SERVICE)
      expect(steps, `${id} has a step that runs the integration project`).not.toEqual([])
      for (const step of steps) {
        expect(step, `${id} sets REQUIRE_TEST_REDIS on the test step`).toMatch(
          REQUIRES_REDIS,
        )
      }
    }
  })

  it('never requires Redis in a job that has no Redis service', () => {
    const withoutRedis = jobs
      .filter(({ block }) => SETS_REQUIREMENT.test(block))
      .filter(({ block }) => !REDIS_SERVICE.test(block))
    expect(withoutRedis.map(({ id }) => id)).toEqual([])
  })
})
