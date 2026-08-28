// ARC-03-T15 — one Application Container per process, proven by SPAWNING one.
//
// Every other composition test shares a vitest worker with dozens of other
// suites, so "this process built one container" is unprovable there: the module
// registry, the process policy trio and the queue connections are all already
// shared. These cases spawn each deployable as an independent child process
// with a fixed injected environment and read back one content-free boot report.
//
// The reports carry names and counts only — no tenant, review, guest or
// credential value ever reaches them.

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { testEnvironment } from '#/shared/testing/test-environment'
import { parseBootReport, type BootReport } from './boot-report'

const FIXTURES = {
  web: 'src/shared/testing/process-fixtures/web-process.fixture.ts',
  worker: 'src/shared/testing/process-fixtures/worker-process.fixture.ts',
  sidecar: 'src/shared/testing/process-fixtures/sidecar-process.fixture.ts',
} as const

type FixtureRun = Readonly<{ status: number | null; stdout: string; stderr: string }>

/** Spawning a full composition graph costs seconds; each distinct run is
 * executed once and shared, so the suite spawns 5 processes, not 12. */
const RUN_CACHE = new Map<string, FixtureRun>()
const SPAWN_TIMEOUT_MS = 240_000

function runFixture(
  fixture: string,
  extraEnv: NodeJS.ProcessEnv = {},
  cacheKey = `${fixture}:${JSON.stringify(extraEnv)}`,
): FixtureRun {
  const cached = RUN_CACHE.get(cacheKey)
  if (cached) return cached
  const run = spawnFixture(fixture, extraEnv)
  RUN_CACHE.set(cacheKey, run)
  return run
}

function spawnFixture(fixture: string, extraEnv: NodeJS.ProcessEnv): FixtureRun {
  const result = spawnSync(process.execPath, ['--import', 'tsx', resolve(fixture)], {
    encoding: 'utf8',
    timeout: SPAWN_TIMEOUT_MS,
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      // A FIXED environment: the report must not depend on the developer's
      // shell. testEnvironment() is the repository's one validated source.
      ...testEnvironment({}),
      ...extraEnv,
    },
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function bootReport(fixture: string): BootReport {
  const run = runFixture(fixture)
  expect(run.status, `fixture failed:\n${run.stderr}`).toBe(0)
  return parseBootReport(run.stdout)
}

describe('one Application Container per process', () => {
  it(
    'boots exactly one container in the web process, with nothing registered',
    () => {
      const report = bootReport(FIXTURES.web)

      expect(report.deployable).toBe('web')
      expect(report.containerBoots).toBe(1)
      // The web process serves requests. It owns no job and no durable consumer.
      expect(report.jobNames).toHaveLength(0)
      expect(report.consumerNames).toHaveLength(0)
      expect(report.schedulerIds).toHaveLength(0)
      expect(report.policyBindings).toHaveLength(0)
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'boots exactly one container in the worker process, owning its consumers',
    () => {
      const report = bootReport(FIXTURES.worker)

      expect(report.deployable).toBe('worker')
      expect(report.containerBoots).toBe(1)
      // ARC-03-T7: the registry is container-owned, so the worker's own
      // registration is what this report describes.
      expect(report.consumerNames.length).toBeGreaterThan(0)
      expect(new Set(report.consumerNames).size).toBe(report.consumerNames.length)
      expect(report.policyBindings).toEqual([
        'capabilityPolicyStore',
        'delayedExecutionPolicy',
        'executionPolicy',
      ])
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'boots one composition unit in a sidecar, with no database or queue handle',
    () => {
      const report = bootReport(FIXTURES.sidecar)

      expect(report.deployable).toBe('sidecar')
      expect(report.containerBoots).toBe(1)
      expect(report.openHandleNames).not.toContain('database')
      expect(report.openHandleNames).not.toContain('database-pool')
      expect(report.openHandleNames).not.toContain('job-queue')
      expect(report.openHandleNames).not.toContain('background-queue')
      expect(report.jobNames).toHaveLength(0)
      expect(report.consumerNames).toHaveLength(0)
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'registers deterministically: two worker runs are byte-identical',
    () => {
      const first = runFixture(FIXTURES.worker)
      const second = runFixture(FIXTURES.worker, {}, 'worker:second-run')

      expect(first.status).toBe(0)
      expect(second.status).toBe(0)
      expect(JSON.stringify(parseBootReport(first.stdout))).toBe(
        JSON.stringify(parseBootReport(second.stdout)),
      )
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'isolates deployables: web and worker share no scheduler identifier',
    () => {
      const [web, worker] = [bootReport(FIXTURES.web), bootReport(FIXTURES.worker)]

      const shared = web.schedulerIds.filter((id) => worker.schedulerIds.includes(id))
      expect(shared).toEqual([])
      // Registration authority is the worker's alone.
      expect(web.consumerNames).toEqual([])
      expect(worker.consumerNames.length).toBeGreaterThan(0)
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'negative control: a second container in one process exits non-zero by name',
    () => {
      const run = runFixture(FIXTURES.web, { FIXTURE_DOUBLE_BOOT: '1' })

      expect(run.status).not.toBe(0)
      expect(run.stderr).toContain(
        '[COMPOSITION] a complete Application Container already exists in this process',
      )
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'emits no boot report when the fixture cannot boot',
    () => {
      const run = runFixture(FIXTURES.web, { FIXTURE_DOUBLE_BOOT: '1' })

      // Never fabricate evidence: a failed boot produces no report at all.
      expect(() => parseBootReport(run.stdout)).toThrow(
        'expected exactly one boot report',
      )
    },
    SPAWN_TIMEOUT_MS,
  )
})
