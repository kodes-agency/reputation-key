// Which production images main CI proved for a commit: the digest map that
// the `image` job of a green main push run wrote, read back from that run.
//
// The replacement pipeline's `image` job writes the same map from a dispatched
// run. `verifyDispatchedCiImageDigestMap` applies the deploy's acceptance rules
// to such a run so the pipeline can be proved from a branch. No deploy reads a
// dispatched map: it carries an `event` the deploy's schema refuses, and the
// deploy lists only main push runs.

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
const sourceFields = {
  repository: z.literal(TRUSTED_REPOSITORY),
  workflow: z.literal(TRUSTED_CI_WORKFLOW),
  runId: z.string().regex(/^[1-9][0-9]*$/u),
  runAttempt: z.number().int().positive(),
}
const digestMapSchema = <Source extends z.ZodType>(source: Source) =>
  z.strictObject({
    version: z.literal(CI_IMAGE_DIGEST_MAP_VERSION),
    sourceRevision: z.string().regex(SOURCE_REVISION),
    source,
    images: z.strictObject({
      web: image,
      worker: image,
      'google-provider-redis': image,
    }),
  })
const DIGEST_MAP_SCHEMA = digestMapSchema(
  z.strictObject({
    ...sourceFields,
    ref: z.literal('refs/heads/main'),
    job: z.literal('image').optional(),
  }),
)
// A dispatched map names its branch and event instead of a production job.
// The event is what the schema above refuses, so no deploy takes it.
const DISPATCHED_DIGEST_MAP_SCHEMA = digestMapSchema(
  z.strictObject({
    ...sourceFields,
    ref: z.string().regex(/^refs\/heads\/\S+$/u),
    event: z.literal('workflow_dispatch'),
  }),
)

export type CiImageDigest = Readonly<z.output<typeof image>>
export type CiImageDigestMap = Readonly<z.output<typeof DIGEST_MAP_SCHEMA>>
export type DispatchedCiImageDigestMap = Readonly<
  z.output<typeof DISPATCHED_DIGEST_MAP_SCHEMA>
>

const GITHUB_RUNS_SCHEMA = z.array(
  z.object({
    databaseId: z.number().int().positive(),
    headSha: z.string(),
    headBranch: z.string(),
    event: z.string(),
    conclusion: z.string().nullable(),
    attempt: z.number().int().positive(),
  }),
)
const GITHUB_ARTIFACTS_SCHEMA = z.object({
  artifacts: z.array(z.object({ name: z.string(), expired: z.boolean() })),
})
const GITHUB_RUN_ATTEMPT_SCHEMA = z.object({ run_started_at: z.iso.datetime() })
const GITHUB_RUN_SCHEMA = z.object({
  id: z.number().int().positive(),
  path: z.string(),
  event: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  head_sha: z.string(),
  head_branch: z.string().nullable(),
  run_attempt: z.number().int().positive(),
})
const GITHUB_ARTIFACT_LISTING_SCHEMA = z.object({
  total_count: z.number().int().nonnegative(),
  artifacts: z.array(z.object({ name: z.string(), expired: z.boolean() })),
})
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
/** The ci.yml jobs that make the images, and the one that writes the digest map. */
type ImageJobs = Readonly<{ requiredJobs: readonly string[]; imageJob: RegExp }>
// The `docker image group (...)` matrix rows build, scan and stage the images;
// `docker` wrote historical main push maps, which remain valid for rollback.
const DEPLOYED_IMAGE_JOBS: ImageJobs = {
  requiredJobs: ['docker'],
  imageJob: /^docker(?: image group \(.+\))?$/u,
}
// The replacement pipeline: `image build (...)` builds, `image scan` scans and
// stages, `image` writes main and dispatched maps, and `ci` gathers every
// other gate. A name here that ci.yml does not give a job is a missing job.
const REPLACEMENT_IMAGE_JOB_NAMES = [
  'image build (web)',
  'image build (support)',
  'image scan',
  'image',
] as const
const REPLACEMENT_IMAGE_JOBS: ImageJobs = {
  requiredJobs: REPLACEMENT_IMAGE_JOB_NAMES,
  imageJob: /^image(?: build \(.+\)| scan)?$/u,
}
export const REPLACEMENT_REQUIRED_JOBS = ['ci', ...REPLACEMENT_IMAGE_JOB_NAMES] as const

export function ciImageDigestMapArtifactName(sourceRevision: string): string {
  if (!SOURCE_REVISION.test(sourceRevision)) {
    throw new Error('CI image digest artifact revision must be a full lowercase git SHA')
  }
  return `ci-image-digest-map-${sourceRevision}`
}

type ExpectedRun = Readonly<{ id: string; latestAttempt: number }>

function requireRevision(revision: string): void {
  if (!SOURCE_REVISION.test(revision)) {
    throw new Error('expected source revision must be a full lowercase git SHA')
  }
}

/** The checks both kinds of map share: its commit, its run, its images. */
function requireMapMatches(
  parsed: Readonly<{
    sourceRevision: string
    source: Readonly<{ runId: string; runAttempt: number }>
    images: Readonly<
      Record<
        CiProductionImageName,
        Readonly<{ repository: string; sourceRevision: string }>
      >
    >
  }>,
  expectedRevision: string,
  expectedRun: ExpectedRun | undefined,
): void {
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
  expectedRun?: ExpectedRun,
): CiImageDigestMap {
  requireRevision(expectedRevision)
  const parsed = parseJson(content, DIGEST_MAP_SCHEMA, 'CI image digest map')
  requireMapMatches(parsed, expectedRevision, expectedRun)
  return parsed
}

/** A dispatched run's map. It must name the branch the run was dispatched on. */
function parseDispatchedCiImageDigestMap(
  content: string,
  expectedRevision: string,
  expectedRun: ExpectedRun & Readonly<{ branch: string }>,
): DispatchedCiImageDigestMap {
  requireRevision(expectedRevision)
  const parsed = parseJson(
    content,
    DISPATCHED_DIGEST_MAP_SCHEMA,
    'dispatched CI image digest map',
  )
  requireMapMatches(parsed, expectedRevision, expectedRun)
  if (parsed.source.ref !== `refs/heads/${expectedRun.branch}`) {
    throw new Error(
      `dispatched CI image digest map names ${parsed.source.ref}, not the branch ${expectedRun.branch} the run was dispatched on`,
    )
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
  jobs: ImageJobs = DEPLOYED_IMAGE_JOBS,
): void {
  const run = `repos/${TRUSTED_REPOSITORY}/actions/runs/${String(runId)}`
  const label = `CI run ${String(runId)}`
  const nextAttemptStarted =
    mapAttempt < latestAttempt
      ? Date.parse(
          parseJson(
            checkedOutput(runner, 'gh', [
              'api',
              `${run}/attempts/${String(mapAttempt + 1)}`,
            ]),
            GITHUB_RUN_ATTEMPT_SCHEMA,
            `GitHub ${label} attempt`,
          ).run_started_at,
        )
      : undefined
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
  const imageJobs = listing.jobs.filter(({ name }) => jobs.imageJob.test(name))
  for (const name of jobs.requiredJobs) {
    if (!imageJobs.some((job) => job.name === name)) {
      throw new Error(`${latest} lists no ${name} job`)
    }
  }
  for (const job of imageJobs) {
    if (job.conclusion !== 'success') {
      throw new Error(`${latest} job ${job.name} concluded ${String(job.conclusion)}`)
    }
    const started = Date.parse(job.started_at ?? '')
    if (Number.isNaN(started)) {
      throw new Error(`${latest} job ${job.name} has no readable start time`)
    }
    if (nextAttemptStarted !== undefined && started >= nextAttemptStarted) {
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
      if (digestMap.source.job === 'image' || digestMap.source.runAttempt < run.attempt) {
        requireImageJobsFromAttempt(
          run.databaseId,
          digestMap.source.runAttempt,
          run.attempt,
          runner,
          digestMap.source.job === 'image' ? REPLACEMENT_IMAGE_JOBS : DEPLOYED_IMAGE_JOBS,
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

export type VerifiedDispatchedRun = Readonly<{
  runId: number
  branch: string
  sourceRevision: string
  attempt: number
  /** The replacement pipeline's jobs the run proved, by name. */
  jobs: readonly string[]
  digestMap: DispatchedCiImageDigestMap
}>

/**
 * Whether a dispatched run of ci.yml proves its images the way a main push run
 * must before a deploy: the run finished green, every job of the replacement
 * pipeline is there and green, and the map in the run names this run, this
 * commit and these images. It reads GitHub and nothing else, and it accepts a
 * run on any branch, which is what lets the pipeline be proved before main
 * runs it. A deploy never calls it: `downloadCiImageDigestMap` lists main push
 * runs only.
 */
export function verifyDispatchedCiImageDigestMap(
  runId: number,
  runner: CommandRunner = defaultCommandRunner,
): VerifiedDispatchedRun {
  const api = `repos/${TRUSTED_REPOSITORY}/actions/runs/${String(runId)}`
  const label = `CI run ${String(runId)}`
  const run = parseJson(
    checkedOutput(runner, 'gh', ['api', api]),
    GITHUB_RUN_SCHEMA,
    `GitHub ${label}`,
  )
  if (run.id !== runId) throw new Error(`GitHub answered for run ${String(run.id)}`)
  if (run.path !== TRUSTED_CI_WORKFLOW) {
    throw new Error(`${label} ran ${run.path}, not ${TRUSTED_CI_WORKFLOW}`)
  }
  if (run.event !== 'workflow_dispatch') {
    throw new Error(
      `${label} is a ${run.event} run; --verify-only reads dispatched runs, and a deploy reads main push runs`,
    )
  }
  if (run.status !== 'completed') {
    throw new Error(`${label} has not completed (${run.status})`)
  }
  if (run.conclusion !== 'success') {
    throw new Error(`${label} concluded ${String(run.conclusion)}`)
  }
  if (!SOURCE_REVISION.test(run.head_sha) || !run.head_branch) {
    throw new Error(`${label} names no full commit and branch`)
  }

  const attempt = `${label} attempt ${String(run.run_attempt)}`
  const listing = parseJson(
    checkedOutput(runner, 'gh', [
      'api',
      `${api}/attempts/${String(run.run_attempt)}/jobs?per_page=100`,
    ]),
    GITHUB_ATTEMPT_JOBS_SCHEMA,
    `GitHub ${label} jobs`,
  )
  if (listing.jobs.length !== listing.total_count) {
    throw new Error(`${attempt} job listing is incomplete`)
  }
  for (const name of REPLACEMENT_REQUIRED_JOBS) {
    const job = listing.jobs.find((candidate) => candidate.name === name)
    if (!job) throw new Error(`${attempt} lists no ${name} job`)
    if (job.conclusion !== 'success') {
      throw new Error(`${attempt} job ${name} concluded ${String(job.conclusion)}`)
    }
  }

  const artifactName = ciImageDigestMapArtifactName(run.head_sha)
  const artifacts = parseJson(
    checkedOutput(runner, 'gh', ['api', `${api}/artifacts?per_page=100`]),
    GITHUB_ARTIFACT_LISTING_SCHEMA,
    `GitHub ${label} artifacts`,
  )
  if (artifacts.artifacts.length !== artifacts.total_count) {
    throw new Error(`${label} artifact listing is incomplete`)
  }
  const matches = artifacts.artifacts.filter(
    (artifact) => artifact.name === artifactName && !artifact.expired,
  )
  if (matches.length > 1) {
    throw new Error(`${label} contains duplicate ${artifactName} artifacts`)
  }
  if (matches.length === 0) {
    throw new Error(`${label} has no unexpired ${artifactName} artifact`)
  }

  const directory = mkdtempSync(join(tmpdir(), 'repkey-ci-image-digest-map-'))
  try {
    checkedOutput(runner, 'gh', [
      'run',
      'download',
      String(runId),
      '--repo',
      TRUSTED_REPOSITORY,
      '--name',
      artifactName,
      '--dir',
      directory,
    ])
    const digestMap = parseDispatchedCiImageDigestMap(
      readFileSync(join(directory, CI_IMAGE_DIGEST_MAP_FILE), 'utf8'),
      run.head_sha,
      { id: String(run.id), latestAttempt: run.run_attempt, branch: run.head_branch },
    )
    if (digestMap.source.runAttempt < run.run_attempt) {
      requireImageJobsFromAttempt(
        runId,
        digestMap.source.runAttempt,
        run.run_attempt,
        runner,
        REPLACEMENT_IMAGE_JOBS,
      )
    }
    return {
      runId,
      branch: run.head_branch,
      sourceRevision: run.head_sha,
      attempt: run.run_attempt,
      jobs: REPLACEMENT_REQUIRED_JOBS,
      digestMap,
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
