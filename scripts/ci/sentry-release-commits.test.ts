import { describe, expect, it } from 'vitest'
import type { SentryCommit } from './git-commit-log.ts'
import {
  attachReleaseCommits,
  commitRange,
  createSentryApi,
  previousReleaseCommit,
  readConfig,
  type SentryApi,
} from './sentry-release-commits.ts'

const SHA = 'a'.repeat(40)
const BASE = 'b'.repeat(40)
const TARGET = {
  organization: '100-35',
  release: SHA,
  repository: 'kodes-agency/reputation-key',
}
const ENV = {
  SENTRY_AUTH_TOKEN: 'token',
  SENTRY_ORG: '100-35',
  SENTRY_URL: 'https://us.sentry.io',
  RELEASE_SHA: SHA,
  REPOSITORY: 'kodes-agency/reputation-key',
}
const RELEASE_PATH = `/api/0/organizations/100-35/releases/${SHA}/`
const COMMIT: SentryCommit = {
  id: SHA,
  author_name: 'Owner',
  author_email: 'owner@users.noreply.github.com',
  timestamp: '2026-10-22T20:07:31+00:00',
  message: 'fix: x\n\nFixes JAVASCRIPT-TANSTACKSTART-REACT-4',
  patch_set: [{ path: 'src/x.ts', type: 'M' }],
}

type Call = Readonly<{ method: string; path: string; body: unknown }>

/** A Sentry that answers each release read with the next commit count in `counts`. */
function fakeSentry(
  counts: readonly number[],
  version = SHA,
): { api: SentryApi; calls: Call[] } {
  const calls: Call[] = []
  let reads = 0
  const api: SentryApi = async (method, path, body) => {
    calls.push({ method, path, body })
    if (method === 'PUT') return { version }
    const commitCount = counts[Math.min(reads, counts.length - 1)]
    reads += 1
    return { version, commitCount }
  }
  return { api, calls }
}

const NO_WAIT = { attempts: 3, sleep: async () => undefined }

describe('attachReleaseCommits', () => {
  it('sends the commits with the repository, then reads the release back', async () => {
    const sentry = fakeSentry([0, 0, 1])

    await expect(
      attachReleaseCommits(sentry.api, TARGET, [COMMIT], NO_WAIT),
    ).resolves.toEqual({
      commits: 1,
      alreadyAttached: false,
    })
    expect(sentry.calls).toEqual([
      { method: 'GET', path: RELEASE_PATH, body: undefined },
      {
        method: 'PUT',
        path: RELEASE_PATH,
        body: { commits: [{ ...COMMIT, repository: 'kodes-agency/reputation-key' }] },
      },
      { method: 'GET', path: RELEASE_PATH, body: undefined },
      { method: 'GET', path: RELEASE_PATH, body: undefined },
    ])
  })

  it('leaves a release that already has commits alone', async () => {
    const sentry = fakeSentry([7])

    await expect(
      attachReleaseCommits(sentry.api, TARGET, [COMMIT], NO_WAIT),
    ).resolves.toEqual({
      commits: 7,
      alreadyAttached: true,
    })
    expect(sentry.calls.map(({ method }) => method)).toEqual(['GET'])
  })

  it('fails when Sentry still shows no commits after taking them', async () => {
    const sentry = fakeSentry([0])

    await expect(
      attachReleaseCommits(sentry.api, TARGET, [COMMIT], NO_WAIT),
    ).rejects.toThrow(
      /Sentry took 1 commit\(s\) for release a{40} but shows none after 3 checks/u,
    )
  })

  it('refuses to send an empty list', async () => {
    const sentry = fakeSentry([0])

    await expect(attachReleaseCommits(sentry.api, TARGET, [], NO_WAIT)).rejects.toThrow(
      /git listed no commits for release a{40}/u,
    )
  })

  it('fails when Sentry answers for a different release', async () => {
    const sentry = fakeSentry([0], BASE)

    await expect(
      attachReleaseCommits(sentry.api, TARGET, [COMMIT], NO_WAIT),
    ).rejects.toThrow(/Sentry answered for release b{40}, not a{40}/u)
  })
})

describe('previousReleaseCommit', () => {
  const listing =
    (releases: unknown): SentryApi =>
    async () =>
      releases

  it('returns the newest commit of the latest other release that has commits', async () => {
    const api = listing([
      { version: SHA, lastCommit: null },
      { version: 'c'.repeat(40), lastCommit: null },
      { version: 'd'.repeat(40), lastCommit: { id: BASE } },
      { version: 'e'.repeat(40), lastCommit: { id: 'f'.repeat(40) } },
    ])

    await expect(previousReleaseCommit(api, TARGET)).resolves.toBe(BASE)
  })

  it('returns null when no release has commits yet', async () => {
    await expect(
      previousReleaseCommit(listing([{ version: SHA, lastCommit: null }]), TARGET),
    ).resolves.toBeNull()
  })

  it('refuses a listing that is not a list', async () => {
    await expect(previousReleaseCommit(listing({ detail: 'x' }), TARGET)).rejects.toThrow(
      /Sentry's release list was not a list/u,
    )
  })
})

describe('commitRange', () => {
  it('starts after the previous release when it is in this commit history', () => {
    expect(commitRange(BASE, SHA, () => true)).toEqual({
      range: [`${BASE}..${SHA}`],
      note: null,
    })
  })

  it('takes the latest 20 commits for the first release', () => {
    expect(commitRange(null, SHA, () => true)).toEqual({
      range: ['-n', '20', SHA],
      note: 'no earlier release has commits; sending the latest 20',
    })
  })

  it('takes the latest 20 commits when the previous release is not in this history', () => {
    expect(commitRange(BASE, SHA, () => false)).toEqual({
      range: ['-n', '20', SHA],
      note: `the previous release's commit ${BASE} is not in this history; sending the latest 20`,
    })
  })
})

describe('readConfig', () => {
  it('reads the release, repository and Sentry organization', () => {
    expect(readConfig(ENV)).toEqual({
      token: 'token',
      baseUrl: 'https://us.sentry.io',
      target: TARGET,
    })
  })

  it('says which secret to add when the token is missing', () => {
    expect(() => readConfig({ ...ENV, SENTRY_AUTH_TOKEN: '' })).toThrow(
      /SENTRY_AUTH_TOKEN is empty: add the repository secret/u,
    )
  })

  it('refuses a release that is not a full commit SHA', () => {
    expect(() => readConfig({ ...ENV, RELEASE_SHA: 'abc123' })).toThrow(
      /RELEASE_SHA must be a 40-character commit SHA, got "abc123"/u,
    )
  })

  it('refuses a repository that is not owner/name', () => {
    expect(() => readConfig({ ...ENV, REPOSITORY: 'reputation-key' })).toThrow(
      /REPOSITORY must be "owner\/name", got "reputation-key"/u,
    )
  })

  it('refuses a Sentry address that is not https', () => {
    expect(() => readConfig({ ...ENV, SENTRY_URL: 'http://us.sentry.io' })).toThrow(
      /SENTRY_URL must be an https address/u,
    )
  })
})

describe('createSentryApi', () => {
  const answering =
    (status: number, body: string): typeof fetch =>
    async () =>
      new Response(body, { status })

  it('sends the body with the token and returns the answer', async () => {
    const requests: Request[] = []
    const api = createSentryApi(
      'secret-token',
      'https://us.sentry.io',
      async (input, init) => {
        requests.push(new Request(input, init))
        return new Response(JSON.stringify({ version: SHA }), { status: 200 })
      },
    )

    await expect(api('PUT', '/api/0/x/', { a: 1 })).resolves.toEqual({ version: SHA })
    expect(requests[0]?.url).toBe('https://us.sentry.io/api/0/x/')
    expect(requests[0]?.method).toBe('PUT')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer secret-token')
    await expect(requests[0]?.json()).resolves.toEqual({ a: 1 })
  })

  it('sends no body with a read', async () => {
    const requests: Request[] = []
    const api = createSentryApi('token', 'https://us.sentry.io', async (input, init) => {
      requests.push(new Request(input, init))
      return new Response('{}', { status: 200 })
    })

    await api('GET', '/api/0/x/')
    expect(requests[0]?.method).toBe('GET')
    expect(requests[0]?.body).toBeNull()
  })

  it('explains a missing release', async () => {
    const api = createSentryApi(
      'token',
      'https://us.sentry.io',
      answering(404, JSON.stringify({ detail: 'The requested resource does not exist' })),
    )

    await expect(api('GET', '/api/0/x/')).rejects.toThrow(
      /Sentry answered 404: The requested resource does not exist; the image build creates the release/u,
    )
  })

  it('points at the token when Sentry refuses it', async () => {
    const api = createSentryApi(
      'stale',
      'https://us.sentry.io',
      answering(403, JSON.stringify({ detail: 'You do not have permission' })),
    )

    await expect(api('PUT', '/api/0/x/', {})).rejects.toThrow(
      /Sentry answered 403: You do not have permission; check the SENTRY_AUTH_TOKEN secret/u,
    )
  })

  it('passes on what Sentry says about a bad request', async () => {
    const api = createSentryApi(
      'token',
      'https://us.sentry.io',
      answering(400, JSON.stringify({ commits: ['Invalid commit'] })),
    )

    await expect(api('PUT', '/api/0/x/', {})).rejects.toThrow(
      /Sentry answered 400: .*Invalid commit/u,
    )
  })

  it('quotes a refusal that is not JSON, or JSON null, as text', async () => {
    const html = createSentryApi(
      'token',
      'https://us.sentry.io',
      answering(502, '<html>Bad gateway</html>'),
    )
    const empty = createSentryApi('token', 'https://us.sentry.io', answering(500, 'null'))

    await expect(html('GET', '/api/0/x/')).rejects.toThrow(
      /Sentry answered 502: <html>Bad gateway<\/html>/u,
    )
    await expect(empty('GET', '/api/0/x/')).rejects.toThrow(/Sentry answered 500: null/u)
  })

  it('fails clearly on a success that is not JSON', async () => {
    const api = createSentryApi(
      'token',
      'https://us.sentry.io',
      answering(200, 'maintenance'),
    )

    await expect(api('GET', '/api/0/x/')).rejects.toThrow(
      /Sentry answered 200 with a body that is not JSON: maintenance/u,
    )
  })
})
