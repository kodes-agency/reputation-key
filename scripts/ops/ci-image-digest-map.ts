// Which production images main CI proved for a commit: the digest map that
// the `docker` job of a green main push run wrote, read back from that run.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'
import {
  checkedOutput,
  defaultCommandRunner,
  parseJson,
  type CommandRunner,
} from './command-runner'

export const CI_IMAGE_DIGEST_MAP_VERSION = 'repkey-ci-image-digest-map-1' as const
export const CI_IMAGE_DIGEST_MAP_FILE = 'ci-image-digest-map.json' as const
export const TRUSTED_REPOSITORY = 'kodes-agency/reputation-key' as const
export const TRUSTED_CI_WORKFLOW = '.github/workflows/ci.yml' as const

export const CI_PRODUCTION_IMAGE_NAMES = [
  'web',
  'worker',
  'google-provider-redis',
] as const
export type CiProductionImageName = (typeof CI_PRODUCTION_IMAGE_NAMES)[number]
export type ImageDigest = `sha256:${string}`

export const SOURCE_REVISION = /^[0-9a-f]{40}$/u
const IMAGE_DIGEST = /^sha256:[0-9a-f]{64}$/u
const imageDigest = z
  .string()
  .regex(IMAGE_DIGEST)
  .transform((value) => value as ImageDigest)
const image = z.strictObject({
  repository: z.string().min(1),
  digest: imageDigest,
  sourceRevision: z.string().regex(SOURCE_REVISION),
})
const DIGEST_MAP_SCHEMA = z.strictObject({
  version: z.literal(CI_IMAGE_DIGEST_MAP_VERSION),
  sourceRevision: z.string().regex(SOURCE_REVISION),
  source: z.strictObject({
    repository: z.literal(TRUSTED_REPOSITORY),
    ref: z.literal('refs/heads/main'),
    workflow: z.literal(TRUSTED_CI_WORKFLOW),
    runId: z.string().regex(/^[1-9][0-9]*$/u),
    runAttempt: z.number().int().positive(),
  }),
  images: z.strictObject({
    web: image,
    worker: image,
    'google-provider-redis': image,
  }),
})

export type CiImageDigest = Readonly<z.output<typeof image>>
export type CiImageDigestMap = Readonly<z.output<typeof DIGEST_MAP_SCHEMA>>

const GITHUB_RUNS_SCHEMA = z.array(
  z.object({
    databaseId: z.number().int().positive(),
    headSha: z.string(),
    headBranch: z.string(),
    event: z.string(),
    conclusion: z.string(),
    attempt: z.number().int().positive(),
  }),
)
const GITHUB_ARTIFACTS_SCHEMA = z.object({
  artifacts: z.array(z.object({ name: z.string(), expired: z.boolean() })),
})
const GITHUB_RUN_ATTEMPT_SCHEMA = z.object({ run_started_at: z.iso.datetime() })
const GITHUB_ATTEMPT_JOBS_SCHEMA = z.object({
  total_count: z.number().int().nonnegative(),
  jobs: z.array(
    z.object({
      name: z.string(),
      conclusion: z.string().nullable(),
      started_at: z.string().nullable(),
    }),
  ),
})
// The ci.yml jobs that make the images: the `docker image group (...)` matrix
// rows build, scan and stage them; `docker` tags them and writes the digest map.
const CI_DIGEST_MAP_JOB = 'docker'
const CI_IMAGE_JOB = /^docker(?: image group \(.+\))?$/u

export function ciImageDigestMapArtifactName(sourceRevision: string): string {
  if (!SOURCE_REVISION.test(sourceRevision)) {
    throw new Error('CI image digest artifact revision must be a full lowercase git SHA')
  }
  return `ci-image-digest-map-${sourceRevision}`
}

/**
 * `expectedRun` is the run the artifact was downloaded from. The map must name
 * that run: a map written by another run, or for another commit, proves
 * nothing about this one. Its attempt may be EARLIER than the
 * run's latest, because `gh run rerun --failed` re-runs only the failed jobs
 * and keeps the images and map an earlier attempt produced. Whether a later
 * attempt re-ran the image jobs is not in the map; `downloadCiImageDigestMap`
 * asks GitHub (`requireImageJobsFromAttempt`).
 */
export function parseCiImageDigestMap(
  content: string,
  expectedRevision: string,
  expectedRun?: Readonly<{ id: string; latestAttempt: number }>,
): CiImageDigestMap {
  if (!SOURCE_REVISION.test(expectedRevision)) {
    throw new Error('expected source revision must be a full lowercase git SHA')
  }
  const parsed = parseJson(content, DIGEST_MAP_SCHEMA, 'CI image digest map')
  if (parsed.sourceRevision !== expectedRevision) {
    throw new Error(
      `CI image digest map source revision ${parsed.sourceRevision} does not match ${expectedRevision}`,
    )
  }
  if (expectedRun && parsed.source.runId !== expectedRun.id) {
    throw new Error(
      `CI image digest map was written by workflow run ${parsed.source.runId}, not ${expectedRun.id}`,
    )
  }
  if (expectedRun && parsed.source.runAttempt > expectedRun.latestAttempt) {
    throw new Error(
      `CI image digest map claims attempt ${String(parsed.source.runAttempt)} of workflow run ${expectedRun.id}, whose latest attempt is ${String(expectedRun.latestAttempt)}`,
    )
  }
  for (const imageName of CI_PRODUCTION_IMAGE_NAMES) {
    const entry = parsed.images[imageName]
    const expectedRepository = `ghcr.io/kodes-agency/repkey-${imageName}`
    if (entry.repository !== expectedRepository) {
      throw new Error(
        `CI image digest map repository for ${imageName} must be ${expectedRepository}`,
      )
    }
    if (entry.sourceRevision !== expectedRevision) {
      throw new Error(
        `CI image digest map image ${imageName} has the wrong source revision`,
      )
    }
  }
  return parsed
}

/**
 * A digest map from an earlier attempt is the newest one only if no later
 * attempt re-ran an image job: a re-run `docker` job writes a newer map, and
 * that one must win. GitHub lists every job in the latest attempt, but a job
 * carried over from an earlier attempt keeps the start time of the attempt it
 * really ran in (run 39146182265: attempt 2 began 16:52:59, its `docker` job
 * reads 16:49:53, from attempt 1). So every image job of the latest attempt
 * must have started before the attempt after the map's began.
 */
function requireImageJobsFromAttempt(
  runId: number,
  mapAttempt: number,
  latestAttempt: number,
  runner: CommandRunner,
): void {
  const run = `repos/${TRUSTED_REPOSITORY}/actions/runs/${String(runId)}`
  const label = `CI run ${String(runId)}`
  const { run_started_at } = parseJson(
    checkedOutput(runner, 'gh', ['api', `${run}/attempts/${String(mapAttempt + 1)}`]),
    GITHUB_RUN_ATTEMPT_SCHEMA,
    `GitHub ${label} attempt`,
  )
  const nextAttemptStarted = Date.parse(run_started_at)
  const listing = parseJson(
    checkedOutput(runner, 'gh', [
      'api',
      `${run}/attempts/${String(latestAttempt)}/jobs?per_page=100`,
    ]),
    GITHUB_ATTEMPT_JOBS_SCHEMA,
    `GitHub ${label} jobs`,
  )
  const latest = `${label} attempt ${String(latestAttempt)}`
  if (listing.jobs.length !== listing.total_count) {
    throw new Error(`${latest} job listing is incomplete`)
  }
  const imageJobs = listing.jobs.filter(({ name }) => CI_IMAGE_JOB.test(name))
  if (!imageJobs.some(({ name }) => name === CI_DIGEST_MAP_JOB)) {
    throw new Error(`${latest} lists no ${CI_DIGEST_MAP_JOB} job`)
  }
  for (const job of imageJobs) {
    if (job.conclusion !== 'success') {
      throw new Error(`${latest} job ${job.name} concluded ${String(job.conclusion)}`)
    }
    const started = Date.parse(job.started_at ?? '')
    if (Number.isNaN(started)) {
      throw new Error(`${latest} job ${job.name} has no readable start time`)
    }
    if (started >= nextAttemptStarted) {
      throw new Error(
        `${label} re-ran ${job.name} after attempt ${String(mapAttempt)}, so its attempt ${String(mapAttempt)} digest map is not the newest`,
      )
    }
  }
}

export function downloadCiImageDigestMap(
  revision: string,
  runner: CommandRunner = defaultCommandRunner,
): CiImageDigestMap {
  const runs = parseJson(
    checkedOutput(runner, 'gh', [
      'run',
      'list',
      '--repo',
      TRUSTED_REPOSITORY,
      '--workflow',
      'ci.yml',
      '--branch',
      'main',
      '--commit',
      revision,
      '--event',
      'push',
      '--status',
      'success',
      '--limit',
      '100',
      '--json',
      'databaseId,headSha,headBranch,event,conclusion,attempt',
    ]),
    GITHUB_RUNS_SCHEMA,
    'GitHub CI runs',
  ).filter(
    (run) =>
      run.headSha === revision &&
      run.headBranch === 'main' &&
      run.event === 'push' &&
      run.conclusion === 'success',
  )
  if (runs.length === 0) {
    throw new Error(
      `no successful main push CI run exists for source revision ${revision}`,
    )
  }

  const artifactName = ciImageDigestMapArtifactName(revision)
  for (const run of runs) {
    const { artifacts } = parseJson(
      checkedOutput(runner, 'gh', [
        'api',
        `repos/${TRUSTED_REPOSITORY}/actions/runs/${String(run.databaseId)}/artifacts?per_page=100`,
      ]),
      GITHUB_ARTIFACTS_SCHEMA,
      'GitHub run artifacts',
    )
    const matches = artifacts.filter(
      (artifact) => artifact.name === artifactName && !artifact.expired,
    )
    if (matches.length > 1) {
      throw new Error(`GitHub CI run contains duplicate ${artifactName} artifacts`)
    }
    if (matches.length === 0) continue

    const directory = mkdtempSync(join(tmpdir(), 'repkey-ci-image-digest-map-'))
    try {
      checkedOutput(runner, 'gh', [
        'run',
        'download',
        String(run.databaseId),
        '--repo',
        TRUSTED_REPOSITORY,
        '--name',
        artifactName,
        '--dir',
        directory,
      ])
      // `run.attempt` and `run.conclusion` are the latest attempt's: a run whose
      // latest attempt is not green was filtered out above.
      const digestMap = parseCiImageDigestMap(
        readFileSync(join(directory, CI_IMAGE_DIGEST_MAP_FILE), 'utf8'),
        revision,
        { id: String(run.databaseId), latestAttempt: run.attempt },
      )
      if (digestMap.source.runAttempt < run.attempt) {
        requireImageJobsFromAttempt(
          run.databaseId,
          digestMap.source.runAttempt,
          run.attempt,
          runner,
        )
      }
      return digestMap
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  }
  throw new Error(
    `no unexpired ${artifactName} artifact exists on a successful main push CI run`,
  )
}
