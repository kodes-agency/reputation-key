// A digest map as main CI writes it, and a dispatched CI run as GitHub shows it,
// for the tests of the modules that read them.

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CI_IMAGE_DIGEST_MAP_FILE,
  CI_IMAGE_DIGEST_MAP_VERSION,
  CI_PRODUCTION_IMAGE_NAMES,
  ciImageDigestMapArtifactName,
  REPLACEMENT_REQUIRED_JOBS,
  TRUSTED_CI_WORKFLOW,
  TRUSTED_REPOSITORY,
} from './ci-image-digest-map'
import type { CommandRunner } from './command-runner'

export const REVISION = 'a'.repeat(40)

export function digestMapValue(): Record<string, unknown> {
  return {
    version: CI_IMAGE_DIGEST_MAP_VERSION,
    sourceRevision: REVISION,
    source: {
      repository: TRUSTED_REPOSITORY,
      ref: 'refs/heads/main',
      workflow: TRUSTED_CI_WORKFLOW,
      runId: '33891370093',
      runAttempt: 1,
    },
    images: Object.fromEntries(
      CI_PRODUCTION_IMAGE_NAMES.map((imageName, index) => [
        imageName,
        {
          repository: `ghcr.io/kodes-agency/repkey-${imageName}`,
          digest: `sha256:${String(index + 1).repeat(64)}`,
          sourceRevision: REVISION,
        },
      ]),
    ),
  }
}

export const DISPATCH_RUN_ID = 42050000001
export const DISPATCH_BRANCH = 'ci/replacement-pipeline'

/** The map the `image` job writes in a dispatched run. */
export function dispatchedDigestMapValue(
  overrides: Readonly<{
    runId?: string
    runAttempt?: number
    sourceRevision?: string
    ref?: string
  }> = {},
): Record<string, unknown> {
  const value = digestMapValue()
  return {
    ...value,
    sourceRevision: overrides.sourceRevision ?? REVISION,
    source: {
      ...(value.source as Record<string, unknown>),
      ref: overrides.ref ?? `refs/heads/${DISPATCH_BRANCH}`,
      event: 'workflow_dispatch',
      runId: overrides.runId ?? String(DISPATCH_RUN_ID),
      runAttempt: overrides.runAttempt ?? 1,
    },
  }
}

export type FakeDispatchedJob = Readonly<{
  name: string
  conclusion: string | null
  started_at: string | null
}>

export const DISPATCHED_RUN_JOBS: readonly FakeDispatchedJob[] = [
  ...REPLACEMENT_REQUIRED_JOBS,
  'lint',
  'typecheck',
  'docker',
  'check',
].map((name) => ({
  name,
  conclusion: 'success',
  started_at: '2026-11-05T10:00:00Z',
}))

export type FakeDispatchedRun = Readonly<{
  run?: Readonly<Record<string, unknown>>
  jobs?: readonly FakeDispatchedJob[]
  totalJobs?: number
  artifacts?: readonly Readonly<{ name: string; expired: boolean }>[]
  totalArtifacts?: number
  digestMap?: Record<string, unknown>
  attemptStarts?: Readonly<Record<number, string>>
}>

/** Answers the `gh` calls a verification makes, the way GitHub answers them. */
export function fakeDispatchedRun(config: FakeDispatchedRun = {}): {
  runner: CommandRunner
  calls: string[][]
} {
  const calls: string[][] = []
  const run = {
    id: DISPATCH_RUN_ID,
    path: TRUSTED_CI_WORKFLOW,
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
    head_sha: REVISION,
    head_branch: DISPATCH_BRANCH,
    run_attempt: 1,
    ...config.run,
  }
  const api = `repos/${TRUSTED_REPOSITORY}/actions/runs/${String(DISPATCH_RUN_ID)}`
  const jobs = config.jobs ?? DISPATCHED_RUN_JOBS
  const artifacts = config.artifacts ?? [
    { name: ciImageDigestMapArtifactName(REVISION), expired: false },
    { name: 'image-sboms-spdx', expired: false },
  ]
  const ok = (body: unknown) => ({ status: 0, stdout: JSON.stringify(body), stderr: '' })
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    const [verb, target] = args
    if (command === 'gh' && verb === 'api' && target === api) return ok(run)
    if (
      command === 'gh' &&
      verb === 'api' &&
      target === `${api}/artifacts?per_page=100`
    ) {
      return ok({
        total_count: config.totalArtifacts ?? artifacts.length,
        artifacts,
      })
    }
    const attempt = /^attempts\/(\d+)(\/jobs\?per_page=100)?$/u.exec(
      target?.startsWith(`${api}/`) ? target.slice(`${api}/`.length) : '',
    )
    if (command === 'gh' && verb === 'api' && attempt) {
      const number = Number(attempt[1])
      if (attempt[2]) {
        return ok({ total_count: config.totalJobs ?? jobs.length, jobs })
      }
      const started = config.attemptStarts?.[number]
      return started
        ? ok({ run_attempt: number, run_started_at: started })
        : { status: 1, stdout: '', stderr: `HTTP 404: no attempt ${String(number)}` }
    }
    if (command === 'gh' && verb === 'run' && target === 'download') {
      const directory = args[args.indexOf('--dir') + 1]!
      writeFileSync(
        join(directory, CI_IMAGE_DIGEST_MAP_FILE),
        JSON.stringify(config.digestMap ?? dispatchedDigestMapValue()),
      )
      return ok({})
    }
    return {
      status: 1,
      stdout: '',
      stderr: `unexpected command: ${command} ${args.join(' ')}`,
    }
  }
  return { runner, calls }
}
