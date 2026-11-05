import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CI_IMAGE_DIGEST_MAP_FILE,
  CI_PRODUCTION_IMAGE_NAMES,
  ciImageDigestMapArtifactName,
  downloadCiImageDigestMap,
  parseCiImageDigestMap,
  REPLACEMENT_REQUIRED_JOBS,
  TRUSTED_REPOSITORY,
  verifyDispatchedCiImageDigestMap,
} from './ci-image-digest-map'
import {
  DISPATCH_BRANCH,
  DISPATCH_RUN_ID,
  DISPATCHED_RUN_JOBS,
  digestMapValue,
  dispatchedDigestMapValue,
  fakeDispatchedRun,
  REVISION,
} from './ci-image-digest-map.test-fixtures'
import type { CommandRunner } from './command-runner'

describe('closed-beta CI image digest map', () => {
  it('accepts exactly the three production digests from the matching main CI run', () => {
    const parsed = parseCiImageDigestMap(JSON.stringify(digestMapValue()), REVISION, {
      id: '33891370093',
      latestAttempt: 1,
    })

    expect(Object.keys(parsed.images)).toEqual(CI_PRODUCTION_IMAGE_NAMES)
    expect(parsed.images.web).toEqual({
      repository: 'ghcr.io/kodes-agency/repkey-web',
      digest: `sha256:${'1'.repeat(64)}`,
      sourceRevision: REVISION,
    })
  })

  it('refuses a digest map with a missing production image digest', () => {
    const value = digestMapValue()
    const images = value.images as Record<string, Record<string, unknown>>
    delete images.worker

    expect(() => parseCiImageDigestMap(JSON.stringify(value), REVISION)).toThrow(
      /worker/u,
    )
  })
})

// Shaped on run 39146182265 for 967466cc3 (2026-10-18): attempt 1 built and
// published the images, then failed one e2e shard; `gh run rerun --failed`
// re-ran only that shard and the `e2e` aggregate, and attempt 2 went green.
const RUN_ID = 39146182265
const ATTEMPT_2_STARTED = '2026-10-18T16:52:59Z'
const ATTEMPT_3_STARTED = '2026-10-18T17:20:00Z'
const ATTEMPT_1_IMAGE_JOBS = [
  {
    name: 'docker image group (web)',
    conclusion: 'success',
    started_at: '2026-10-18T16:41:55Z',
  },
  {
    name: 'docker image group (worker-tools)',
    conclusion: 'success',
    started_at: '2026-10-18T16:41:55Z',
  },
  { name: 'docker', conclusion: 'success', started_at: '2026-10-18T16:49:53Z' },
] as const
const ATTEMPT_2_RERUN_JOBS = [
  { name: 'e2e shard (4/4)', conclusion: 'success', started_at: '2026-10-18T16:53:02Z' },
  { name: 'e2e', conclusion: 'success', started_at: '2026-10-18T16:58:35Z' },
] as const

type FakeJob = Readonly<{ name: string; conclusion: string; started_at: string | null }>
type FakeCiRun = Readonly<{
  conclusion: string
  attempt: number
  digestMap: Record<string, unknown>
  attemptStarts?: Readonly<Record<number, string>>
  latestJobs?: readonly FakeJob[]
  totalJobs?: number
}>

function digestMapFrom(
  overrides: Readonly<{ runId?: string; runAttempt?: number; sourceRevision?: string }>,
): Record<string, unknown> {
  const value = digestMapValue()
  const source = value.source as Record<string, unknown>
  return {
    ...value,
    sourceRevision: overrides.sourceRevision ?? REVISION,
    source: {
      ...source,
      runId: overrides.runId ?? String(RUN_ID),
      runAttempt: overrides.runAttempt ?? 1,
    },
  }
}

/** Answers the `gh` calls the deploy makes, the way GitHub answers them. */
function fakeGitHub(run: FakeCiRun): { runner: CommandRunner; calls: string[][] } {
  const calls: string[][] = []
  const runs = `repos/${TRUSTED_REPOSITORY}/actions/runs/${String(RUN_ID)}`
  const ok = (body: unknown) => ({ status: 0, stdout: JSON.stringify(body), stderr: '' })
  const runner: CommandRunner = (command, args) => {
    calls.push([command, ...args])
    const [verb, target] = args
    if (command === 'gh' && verb === 'run' && target === 'list') {
      // `--status success` is GitHub's filter; the deploy must not rely on it.
      return ok([
        {
          databaseId: RUN_ID,
          headSha: REVISION,
          headBranch: 'main',
          event: 'push',
          conclusion: run.conclusion,
          attempt: run.attempt,
        },
      ])
    }
    if (command === 'gh' && verb === 'run' && target === 'download') {
      const directory = args[args.indexOf('--dir') + 1]!
      writeFileSync(
        join(directory, CI_IMAGE_DIGEST_MAP_FILE),
        JSON.stringify(run.digestMap),
      )
      return ok({})
    }
    if (
      command === 'gh' &&
      verb === 'api' &&
      target === `${runs}/artifacts?per_page=100`
    ) {
      return ok({
        artifacts: [{ name: ciImageDigestMapArtifactName(REVISION), expired: false }],
      })
    }
    const attempt = /^(\d+)(\/jobs\?per_page=100)?$/u.exec(
      target?.startsWith(`${runs}/attempts/`)
        ? target.slice(`${runs}/attempts/`.length)
        : '',
    )
    if (command === 'gh' && verb === 'api' && attempt) {
      const number = Number(attempt[1])
      if (attempt[2]) {
        const jobs = run.latestJobs ?? []
        return number === run.attempt
          ? ok({ total_count: run.totalJobs ?? jobs.length, jobs })
          : {
              status: 1,
              stdout: '',
              stderr: `only attempt ${String(run.attempt)} jobs are faked`,
            }
      }
      const started = run.attemptStarts?.[number]
      return started
        ? ok({ run_attempt: number, run_started_at: started })
        : { status: 1, stdout: '', stderr: `HTTP 404: no attempt ${String(number)}` }
    }
    return {
      status: 1,
      stdout: '',
      stderr: `unexpected command: ${command} ${args.join(' ')}`,
    }
  }
  return { runner, calls }
}

describe('closed-beta CI run that proves the images', () => {
  it('deploys a partial re-run whose image jobs ran in an earlier attempt of the same run', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: [...ATTEMPT_1_IMAGE_JOBS, ...ATTEMPT_2_RERUN_JOBS],
    })

    const digestMap = downloadCiImageDigestMap(REVISION, runner)

    expect(digestMap.source).toMatchObject({ runId: String(RUN_ID), runAttempt: 1 })
    expect(digestMap.images.web.digest).toBe(`sha256:${'1'.repeat(64)}`)
  })

  it('deploys a first-attempt run without reading its attempts', () => {
    const { runner, calls } = fakeGitHub({
      conclusion: 'success',
      attempt: 1,
      digestMap: digestMapFrom({ runAttempt: 1 }),
    })

    expect(downloadCiImageDigestMap(REVISION, runner).source.runAttempt).toBe(1)
    expect(calls.some((call) => call.some((arg) => arg.includes('/attempts/')))).toBe(
      false,
    )
  })

  it('refuses an earlier-attempt digest map when a later attempt re-ran the image jobs', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: [
        ...ATTEMPT_1_IMAGE_JOBS.filter(({ name }) => name !== 'docker'),
        { name: 'docker', conclusion: 'success', started_at: '2026-10-18T17:01:12Z' },
        ...ATTEMPT_2_RERUN_JOBS,
      ],
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'CI run 39146182265 re-ran docker after attempt 1, so its attempt 1 digest map is not the newest',
    )
  })

  it('deploys a map two attempts back when neither later attempt re-ran an image job', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 3,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED, 3: ATTEMPT_3_STARTED },
      latestJobs: [...ATTEMPT_1_IMAGE_JOBS, ...ATTEMPT_2_RERUN_JOBS],
    })

    expect(downloadCiImageDigestMap(REVISION, runner).source.runAttempt).toBe(1)
  })

  it('refuses a map two attempts back when the attempt between re-ran an image job', () => {
    // Started in attempt 2, before attempt 3 began: only the start of the
    // attempt right after the map's tells this job apart from attempt 1's.
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 3,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED, 3: ATTEMPT_3_STARTED },
      latestJobs: [
        ...ATTEMPT_1_IMAGE_JOBS.filter(({ name }) => name !== 'docker image group (web)'),
        {
          name: 'docker image group (web)',
          conclusion: 'success',
          started_at: '2026-10-18T16:53:30Z',
        },
        ...ATTEMPT_2_RERUN_JOBS,
      ],
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'CI run 39146182265 re-ran docker image group (web) after attempt 1, so its attempt 1 digest map is not the newest',
    )
  })

  it('refuses an earlier-attempt digest map whose docker job has no readable start time', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: [
        ...ATTEMPT_1_IMAGE_JOBS.map((job) =>
          job.name === 'docker' ? { ...job, started_at: null } : job,
        ),
        ...ATTEMPT_2_RERUN_JOBS,
      ],
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'CI run 39146182265 attempt 2 job docker has no readable start time',
    )
  })

  it('refuses an earlier-attempt digest map whose image job did not succeed', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: [
        ...ATTEMPT_1_IMAGE_JOBS.map((job) =>
          job.name === 'docker image group (worker-tools)'
            ? { ...job, conclusion: 'skipped' }
            : job,
        ),
        ...ATTEMPT_2_RERUN_JOBS,
      ],
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'CI run 39146182265 attempt 2 job docker image group (worker-tools) concluded skipped',
    )
  })

  it('refuses an earlier-attempt digest map when GitHub cannot show the next attempt', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      latestJobs: [...ATTEMPT_1_IMAGE_JOBS, ...ATTEMPT_2_RERUN_JOBS],
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'HTTP 404: no attempt 2',
    )
  })

  it('refuses an earlier-attempt digest map when the latest attempt lists no docker job', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: ATTEMPT_2_RERUN_JOBS,
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'CI run 39146182265 attempt 2 lists no docker job',
    )
  })

  it('refuses an earlier-attempt digest map when the job listing is incomplete', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: [...ATTEMPT_1_IMAGE_JOBS, ...ATTEMPT_2_RERUN_JOBS],
      totalJobs: 120,
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'CI run 39146182265 attempt 2 job listing is incomplete',
    )
  })

  it('refuses a digest map written by a different workflow run', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runId: '39146182264', runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: [...ATTEMPT_1_IMAGE_JOBS, ...ATTEMPT_2_RERUN_JOBS],
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'CI image digest map was written by workflow run 39146182264, not 39146182265',
    )
  })

  it('refuses a digest map from an attempt the run has not reached', () => {
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 3 }),
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      'CI image digest map claims attempt 3 of workflow run 39146182265, whose latest attempt is 2',
    )
  })

  it('refuses a digest map for a different commit', () => {
    const otherRevision = 'c'.repeat(40)
    const { runner } = fakeGitHub({
      conclusion: 'success',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1, sourceRevision: otherRevision }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: [...ATTEMPT_1_IMAGE_JOBS, ...ATTEMPT_2_RERUN_JOBS],
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      `CI image digest map source revision ${otherRevision} does not match ${REVISION}`,
    )
  })

  it('refuses a run whose latest attempt is red even when attempt 1 published images', () => {
    const { runner } = fakeGitHub({
      conclusion: 'failure',
      attempt: 2,
      digestMap: digestMapFrom({ runAttempt: 1 }),
      attemptStarts: { 2: ATTEMPT_2_STARTED },
      latestJobs: [...ATTEMPT_1_IMAGE_JOBS, ...ATTEMPT_2_RERUN_JOBS],
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      `no successful main push CI run exists for source revision ${REVISION}`,
    )
  })

  it('reads the image jobs by the names ci.yml gives them', () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
      'utf8',
    )
    const dockerJob = /\n {2}docker:\n[\s\S]*?(?=\n {2}[a-z][\w-]*:\n|$)/u.exec(
      workflow,
    )?.[0]

    // A rename here would make every partial re-run undeployable again.
    expect(workflow).toMatch(/\n {2}docker-images:\n {4}name: docker image group \(/u)
    expect(dockerJob).toContain('name: ci-image-digest-map-${{ github.sha }}')
  })
})

describe('dispatched CI run that proves the replacement pipeline', () => {
  it('accepts a run whose pipeline jobs are green and whose map names it', () => {
    const { runner } = fakeDispatchedRun()

    const verified = verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)

    expect(verified).toMatchObject({
      runId: DISPATCH_RUN_ID,
      branch: DISPATCH_BRANCH,
      sourceRevision: REVISION,
      attempt: 1,
      jobs: REPLACEMENT_REQUIRED_JOBS,
    })
    expect(Object.keys(verified.digestMap.images)).toEqual(CI_PRODUCTION_IMAGE_NAMES)
    expect(verified.digestMap.source.event).toBe('workflow_dispatch')
  })

  it.each(REPLACEMENT_REQUIRED_JOBS)('refuses a run that lists no %s job', (name) => {
    const { runner } = fakeDispatchedRun({
      jobs: DISPATCHED_RUN_JOBS.filter((job) => job.name !== name),
    })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      `CI run ${String(DISPATCH_RUN_ID)} attempt 1 lists no ${name} job`,
    )
  })

  it.each(REPLACEMENT_REQUIRED_JOBS)(
    'refuses a run whose %s job did not succeed',
    (name) => {
      const { runner } = fakeDispatchedRun({
        jobs: DISPATCHED_RUN_JOBS.map((job) =>
          job.name === name ? { ...job, conclusion: 'skipped' } : job,
        ),
      })

      expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
        `CI run ${String(DISPATCH_RUN_ID)} attempt 1 job ${name} concluded skipped`,
      )
    },
  )

  it('refuses a run that has not finished', () => {
    const { runner } = fakeDispatchedRun({
      run: { status: 'in_progress', conclusion: null },
    })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      `CI run ${String(DISPATCH_RUN_ID)} has not completed (in_progress)`,
    )
  })

  it('refuses a red run even when the pipeline jobs are green', () => {
    const { runner } = fakeDispatchedRun({ run: { conclusion: 'failure' } })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      `CI run ${String(DISPATCH_RUN_ID)} concluded failure`,
    )
  })

  it('refuses a push run, which a deploy reads and a verification does not', () => {
    const { runner } = fakeDispatchedRun({ run: { event: 'push' } })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      'is a push run; --verify-only reads dispatched runs, and a deploy reads main push runs',
    )
  })

  it('refuses a run of another workflow', () => {
    const { runner } = fakeDispatchedRun({ run: { path: '.github/workflows/other.yml' } })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      'ran .github/workflows/other.yml, not .github/workflows/ci.yml',
    )
  })

  it('refuses a job listing GitHub did not finish', () => {
    const { runner } = fakeDispatchedRun({ totalJobs: 500 })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      'job listing is incomplete',
    )
  })

  it('refuses a run with no digest map artifact, or an expired one', () => {
    const name = ciImageDigestMapArtifactName(REVISION)

    for (const artifacts of [[], [{ name, expired: true }]]) {
      const { runner } = fakeDispatchedRun({ artifacts })

      expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
        `has no unexpired ${name} artifact`,
      )
    }
  })

  it('refuses an artifact listing GitHub did not finish', () => {
    const { runner } = fakeDispatchedRun({ totalArtifacts: 300 })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      'artifact listing is incomplete',
    )
  })

  it('refuses a map for another commit', () => {
    const other = 'c'.repeat(40)
    const { runner } = fakeDispatchedRun({
      digestMap: dispatchedDigestMapValue({ sourceRevision: other }),
    })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      `source revision ${other} does not match ${REVISION}`,
    )
  })

  it('refuses a map written by another run', () => {
    const { runner } = fakeDispatchedRun({
      digestMap: dispatchedDigestMapValue({ runId: '42049999999' }),
    })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      `written by workflow run 42049999999, not ${String(DISPATCH_RUN_ID)}`,
    )
  })

  it('refuses a map that names a different branch than the run was dispatched on', () => {
    const { runner } = fakeDispatchedRun({
      digestMap: dispatchedDigestMapValue({ ref: 'refs/heads/other' }),
    })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      `names refs/heads/other, not the branch ${DISPATCH_BRANCH}`,
    )
  })

  it('refuses a map shaped like a main push map: a dispatched run names its event', () => {
    const { runner } = fakeDispatchedRun({
      digestMap: {
        ...digestMapValue(),
        source: {
          ...(digestMapValue().source as Record<string, unknown>),
          runId: String(DISPATCH_RUN_ID),
        },
      },
    })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      /source\.event/u,
    )
  })

  it('refuses a map whose images are not the three production repositories', () => {
    const value = dispatchedDigestMapValue()
    const images = value.images as Record<string, Record<string, unknown>>
    images.worker = {
      ...images.worker!,
      repository: 'ghcr.io/someone-else/repkey-worker',
    }
    const { runner } = fakeDispatchedRun({ digestMap: value })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      'repository for worker must be ghcr.io/kodes-agency/repkey-worker',
    )
  })

  it("accepts an earlier attempt's map when no later attempt re-ran an image job", () => {
    const { runner } = fakeDispatchedRun({
      run: { run_attempt: 2 },
      digestMap: dispatchedDigestMapValue({ runAttempt: 1 }),
      attemptStarts: { 2: '2026-11-05T10:30:00Z' },
    })

    expect(verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner).attempt).toBe(2)
  })

  it("refuses an earlier attempt's map when a later attempt re-ran the image job", () => {
    const { runner } = fakeDispatchedRun({
      run: { run_attempt: 2 },
      digestMap: dispatchedDigestMapValue({ runAttempt: 1 }),
      attemptStarts: { 2: '2026-11-05T09:30:00Z' },
    })

    expect(() => verifyDispatchedCiImageDigestMap(DISPATCH_RUN_ID, runner)).toThrow(
      `CI run ${String(DISPATCH_RUN_ID)} re-ran image build (web) after attempt 1`,
    )
  })
})

describe('what a deploy reads', () => {
  it('refuses a dispatched map, whatever branch it names', () => {
    for (const ref of ['refs/heads/main', `refs/heads/${DISPATCH_BRANCH}`]) {
      const value = dispatchedDigestMapValue({ ref, runId: '33891370093' })

      expect(() => parseCiImageDigestMap(JSON.stringify(value), REVISION)).toThrow(
        /source/u,
      )
    }
  })

  it('does not take a dispatched run of main, only a push run', () => {
    const runner: CommandRunner = (_command, args) => ({
      status: 0,
      stdout: args.includes('list')
        ? JSON.stringify([
            {
              databaseId: DISPATCH_RUN_ID,
              headSha: REVISION,
              headBranch: 'main',
              event: 'workflow_dispatch',
              conclusion: 'success',
              attempt: 1,
            },
          ])
        : '{}',
      stderr: '',
    })

    expect(() => downloadCiImageDigestMap(REVISION, runner)).toThrow(
      `no successful main push CI run exists for source revision ${REVISION}`,
    )
  })

  it('names the replacement jobs as ci.yml gives them', () => {
    const workflow = readFileSync(
      resolve(import.meta.dirname, '../../.github/workflows/ci.yml'),
      'utf8',
    )
    const job = (id: string) =>
      new RegExp(`\\n {2}${id}:\\n[\\s\\S]*?(?=\\n {2}[a-z][\\w-]*:\\n|$)`, 'u').exec(
        workflow,
      )?.[0] ?? ''

    // A rename here would leave a verification asking for jobs that do not exist.
    expect(job('ci')).toContain('needs: [')
    expect(job('image')).toContain('name: ci-image-digest-map-${{ github.sha }}')
    expect(job('image-build')).toContain('name: image build (${{ matrix.row }})')
    expect(job('image-build')).toMatch(/- row: web\n/u)
    expect(job('image-build')).toMatch(/- row: support\n/u)
    expect(job('image-scan')).toContain('name: image scan')
    expect(REPLACEMENT_REQUIRED_JOBS).toEqual([
      'ci',
      'image build (web)',
      'image build (support)',
      'image scan',
      'image',
    ])
  })
})
