// Tells Sentry which commit each main release was built from.
//
// The image build names a Sentry release after the commit it builds (see
// scripts/build/sentry-source-map-upload.ts) but cannot attach commits to it:
// the build has no `.git`. Without commits Sentry cannot name a suspect commit
// for a new error, and a commit message saying "Fixes JAVASCRIPT-…-4" never
// resolves that issue. Sentry's GitHub integration is linked to this
// repository, so naming the release's commit is enough: Sentry reads the
// commits since the previous release from GitHub itself.
//
// Sentry accepts the commit at once but reads GitHub in the background, so a
// 200 does not prove anything was attached. The run reads the release back
// until it has commits, and fails if it never does: a release Sentry silently
// left empty is the failure this exists to prevent.
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

const FULL_SHA = /^[0-9a-f]{40}$/u
const OWNER_AND_NAME = /^[\w.-]+\/[\w.-]+$/u
const NOT_FOUND = 404
const UNAUTHORIZED = 401
const FORBIDDEN = 403
// Well past a normal answer; the job's 5-minute timeout is the outer bound.
const REQUEST_TIMEOUT_MS = 30_000
// Sentry usually attaches commits within seconds; a minute is generous.
const COMMIT_CHECKS = 12
const COMMIT_CHECK_INTERVAL_MS = 5_000
const QUOTED_CHARACTERS = 300

export type SentryApi = (
  method: 'GET' | 'PUT',
  path: string,
  body?: unknown,
) => Promise<unknown>

export type ReleaseTarget = Readonly<{
  organization: string
  release: string
  /** The repository as Sentry's GitHub integration names it: owner/name. */
  repository: string
}>

type Waiting = Readonly<{ attempts?: number; sleep?: (ms: number) => Promise<void> }>
type ReleaseAnswer = Readonly<{ version?: string; commitCount?: number }>

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function releasePath(target: ReleaseTarget): string {
  return `/api/0/organizations/${encodeURIComponent(target.organization)}/releases/${target.release}/`
}

function sameRelease(answer: ReleaseAnswer, target: ReleaseTarget): ReleaseAnswer {
  if (answer.version === target.release) return answer
  throw new Error(
    `Sentry answered for release ${answer.version ?? 'none'}, not ${target.release}`,
  )
}

/**
 * Attach the release's own commit, then wait until Sentry has read the commits
 * since the previous release from GitHub. Returns how many it attached.
 */
export async function attachReleaseCommits(
  api: SentryApi,
  target: ReleaseTarget,
  { attempts = COMMIT_CHECKS, sleep = pause }: Waiting = {},
): Promise<number> {
  const path = releasePath(target)
  sameRelease(
    (await api('PUT', path, {
      refs: [{ repository: target.repository, commit: target.release }],
    })) as ReleaseAnswer,
    target,
  )
  for (let check = 1; check <= attempts; check += 1) {
    const { commitCount = 0 } = sameRelease(
      (await api('GET', path)) as ReleaseAnswer,
      target,
    )
    if (commitCount > 0) return commitCount
    if (check < attempts) await sleep(COMMIT_CHECK_INTERVAL_MS)
  }
  throw new Error(
    `Sentry took the commit for release ${target.release} but attached none after ${attempts} checks; ` +
      `check Sentry's GitHub integration and that it lists ${target.repository} as a repository`,
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

if (isEntryPoint(import.meta.url)) {
  process.exitCode = await runActionStep(async () => {
    const { token, baseUrl, target } = readConfig(process.env)
    const commits = await attachReleaseCommits(createSentryApi(token, baseUrl), target)
    return [
      `Sentry release ${target.release} has ${commits} commit(s) from ${target.repository}`,
    ]
  })
}
