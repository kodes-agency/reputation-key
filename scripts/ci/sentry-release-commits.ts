// Tells Sentry which commits each main release contains.
//
// The image build names a Sentry release after the commit it builds (see
// scripts/build/sentry-source-map-upload.ts) but cannot attach commits to it:
// the build has no `.git`. Without commits Sentry cannot name a suspect commit
// for a new error, and a commit message saying "Fixes JAVASCRIPT-…-4" never
// resolves that issue.
//
// The run sends the commits itself, read from this checkout's git history:
// every commit since the latest earlier release that has commits, or the
// latest 20 when there is none (git-commit-log.ts). The first version only
// named the release's commit and left Sentry to fetch the rest from GitHub in
// the background; on 2026-10-22 Sentry accepted that and attached nothing,
// without an error anywhere. Sending the list does not depend on that fetch,
// carries the changed files that suspect commits need, and is checked: the run
// reads the release back and fails if it still shows no commits.
//
// The sentry-release-commits workflow runs this after CI passes on main, never
// on a pull request: a fix counts as shipped once it is on main and green,
// not while it is still under review. It runs in its own workflow so a Sentry
// outage shows there, and never turns main's required checks red.
//
// The SENTRY_AUTH_TOKEN repository secret is the one the image build already
// uses to upload source maps; releases are within its scope.

import { requiredEnv, runActionStep } from './action-step.ts'
import { isEntryPoint } from './entry-point.ts'
import { isAncestor, readCommits, type SentryCommit } from './git-commit-log.ts'

const FULL_SHA = /^[0-9a-f]{40}$/u
const OWNER_AND_NAME = /^[\w.-]+\/[\w.-]+$/u
const NOT_FOUND = 404
const UNAUTHORIZED = 401
const FORBIDDEN = 403
// Well past a normal answer; the job's 5-minute timeout is the outer bound.
const REQUEST_TIMEOUT_MS = 30_000
// Sentry stores commits it is sent within the request; the checks cover a lag.
const COMMIT_CHECKS = 6
const COMMIT_CHECK_INTERVAL_MS = 5_000
const QUOTED_CHARACTERS = 300
// What Sentry's own CLI sends for a first release, and a cap for a long gap.
const FIRST_RELEASE_COMMITS = 20
const MAX_COMMITS = 200
// Releases are listed newest first; the previous one with commits is near.
const RELEASES_SEARCHED = 25

export type SentryApi = (
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown,
) => Promise<unknown>

export type ReleaseTarget = Readonly<{
  organization: string
  release: string
  /** The repository's name in Sentry: owner/name. */
  repository: string
}>

type Waiting = Readonly<{ attempts?: number; sleep?: (ms: number) => Promise<void> }>
type ReleaseAnswer = Readonly<{ version?: string; commitCount?: number }>
type ListedRelease = Readonly<{ version?: string; lastCommit?: { id?: string } | null }>

export type Attached = Readonly<{ commits: number; alreadyAttached: boolean }>
export type CommitRange = Readonly<{ range: readonly string[]; note: string | null }>

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function organizationPath(target: ReleaseTarget): string {
  return `/api/0/organizations/${encodeURIComponent(target.organization)}`
}

function releasePath(target: ReleaseTarget): string {
  return `${organizationPath(target)}/releases/${target.release}/`
}

function sameRelease(answer: ReleaseAnswer, target: ReleaseTarget): ReleaseAnswer {
  if (answer.version === target.release) return answer
  throw new Error(
    `Sentry answered for release ${answer.version ?? 'none'}, not ${target.release}`,
  )
}

async function commitCountOf(api: SentryApi, target: ReleaseTarget): Promise<number> {
  const { commitCount = 0 } = sameRelease(
    (await api('GET', releasePath(target))) as ReleaseAnswer,
    target,
  )
  return commitCount
}

/** The newest commit of the latest other release that has commits, if any. */
export async function previousReleaseCommit(
  api: SentryApi,
  target: ReleaseTarget,
): Promise<string | null> {
  const listed = await api(
    'GET',
    `${organizationPath(target)}/releases/?per_page=${RELEASES_SEARCHED}`,
  )
  if (!Array.isArray(listed)) throw new Error("Sentry's release list was not a list")
  const previous = (listed as ListedRelease[]).find(
    ({ version, lastCommit }) =>
      version !== target.release && FULL_SHA.test(lastCommit?.id ?? ''),
  )
  return previous?.lastCommit?.id ?? null
}

/** The `git log` range for this release: since the previous one, else the latest few. */
export function commitRange(
  base: string | null,
  head: string,
  ancestor: (base: string, head: string) => boolean = isAncestor,
): CommitRange {
  if (base !== null && ancestor(base, head))
    return { range: [`${base}..${head}`], note: null }
  const latest = ['-n', String(FIRST_RELEASE_COMMITS), head]
  if (base === null) {
    return {
      range: latest,
      note: `no earlier release has commits; sending the latest ${FIRST_RELEASE_COMMITS}`,
    }
  }
  return {
    range: latest,
    note: `the previous release's commit ${base} is not in this history; sending the latest ${FIRST_RELEASE_COMMITS}`,
  }
}

/**
 * Send the release its commits and check Sentry kept them. A release that
 * already has commits (a re-run) is left as it is.
 */
export async function attachReleaseCommits(
  api: SentryApi,
  target: ReleaseTarget,
  commits: readonly SentryCommit[],
  { attempts = COMMIT_CHECKS, sleep = pause }: Waiting = {},
): Promise<Attached> {
  const existing = await commitCountOf(api, target)
  if (existing > 0) return { commits: existing, alreadyAttached: true }
  if (commits.length === 0) {
    throw new Error(`git listed no commits for release ${target.release}`)
  }
  sameRelease(
    (await api('PUT', releasePath(target), {
      commits: commits.map((commit) => ({ ...commit, repository: target.repository })),
    })) as ReleaseAnswer,
    target,
  )
  for (let check = 1; check <= attempts; check += 1) {
    const count = await commitCountOf(api, target)
    if (count > 0) return { commits: count, alreadyAttached: false }
    if (check < attempts) await sleep(COMMIT_CHECK_INTERVAL_MS)
  }
  throw new Error(
    `Sentry took ${commits.length} commit(s) for release ${target.release} but shows none after ${attempts} checks`,
  )
}

export function readConfig(
  env: NodeJS.ProcessEnv,
): Readonly<{ token: string; baseUrl: string; target: ReleaseTarget }> {
  const token = requiredEnv(
    env,
    'SENTRY_AUTH_TOKEN',
    ': add the repository secret, the token the image build uploads source maps with',
  )
  const baseUrl = requiredEnv(env, 'SENTRY_URL')
  if (!baseUrl.startsWith('https://')) {
    throw new Error(`SENTRY_URL must be an https address, got "${baseUrl}"`)
  }
  const release = requiredEnv(env, 'RELEASE_SHA')
  if (!FULL_SHA.test(release)) {
    throw new Error(`RELEASE_SHA must be a 40-character commit SHA, got "${release}"`)
  }
  const repository = requiredEnv(env, 'REPOSITORY')
  if (!OWNER_AND_NAME.test(repository)) {
    throw new Error(`REPOSITORY must be "owner/name", got "${repository}"`)
  }
  return {
    token,
    baseUrl: baseUrl.replace(/\/+$/u, ''),
    target: { organization: requiredEnv(env, 'SENTRY_ORG'), release, repository },
  }
}

/** What Sentry said: its `detail` when it gave one, else the body itself. */
function detailOf(body: string): string {
  let parsed: unknown = null
  try {
    parsed = JSON.parse(body)
  } catch {
    // Not JSON (a proxy's HTML page, say): the body itself is the account.
  }
  const detail =
    parsed !== null && typeof parsed === 'object' && 'detail' in parsed
      ? parsed.detail
      : undefined
  const said = typeof detail === 'string' ? detail : body
  return said.slice(0, QUOTED_CHARACTERS)
}

/** What went wrong, in Sentry's words, with what to check. */
function refusal(status: number, body: string): string {
  const said = `Sentry answered ${status}: ${detailOf(body)}`
  if (status === NOT_FOUND) {
    return `${said}; the image build creates the release, so check that the web image built with SENTRY_AUTH_TOKEN for this commit`
  }
  if (status === UNAUTHORIZED || status === FORBIDDEN) {
    return `${said}; check the SENTRY_AUTH_TOKEN secret`
  }
  return said
}

export function createSentryApi(
  token: string,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): SentryApi {
  return async (method, path, body) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    const text = await response.text()
    if (!response.ok) throw new Error(refusal(response.status, text))
    try {
      return JSON.parse(text) as unknown
    } catch (cause) {
      throw new Error(
        `Sentry answered ${response.status} with a body that is not JSON: ${text.slice(0, QUOTED_CHARACTERS)}`,
        { cause },
      )
    }
  }
}

/** Reads the commits, newest first, capped so a long gap stays one request. */
function commitsFor(
  range: CommitRange,
): Readonly<{ commits: readonly SentryCommit[]; notes: readonly string[] }> {
  const all = readCommits(range.range)
  const notes = range.note ? [range.note] : []
  if (all.length <= MAX_COMMITS) return { commits: all, notes }
  return {
    commits: all.slice(0, MAX_COMMITS),
    notes: [
      ...notes,
      `${all.length} commits since the previous release; sending the newest ${MAX_COMMITS}`,
    ],
  }
}

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await runActionStep(async () => {
    const { token, baseUrl, target } = readConfig(process.env)
    const api = createSentryApi(token, baseUrl)
    const range = commitRange(await previousReleaseCommit(api, target), target.release)
    const { commits, notes } = commitsFor(range)
    const attached = await attachReleaseCommits(api, target, commits)
    const outcome = attached.alreadyAttached
      ? `Sentry release ${target.release} already has ${attached.commits} commit(s); left as it is`
      : `Sentry release ${target.release} now has ${attached.commits} commit(s) from ${target.repository}`
    return [...notes, outcome]
  })
}
