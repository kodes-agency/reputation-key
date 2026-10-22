import { describe, expect, it } from 'vitest'
import {
  attachReleaseCommits,
  createSentryApi,
  readConfig,
  type SentryApi,
} from './sentry-release-commits.ts'

const SHA = 'a'.repeat(40)
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

type Call = Readonly<{ method: string; path: string; body: unknown }>

/** A Sentry that answers each GET with the next commit count in `counts`. */
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
  it('points the release at its commit, then waits for Sentry to attach commits', async () => {
    const sentry = fakeSentry([0, 4])

    await expect(attachReleaseCommits(sentry.api, TARGET, NO_WAIT)).resolves.toBe(4)
    expect(sentry.calls).toEqual([
      {
        method: 'PUT',
        path: RELEASE_PATH,
        body: { refs: [{ repository: 'kodes-agency/reputation-key', commit: SHA }] },
      },
      { method: 'GET', path: RELEASE_PATH, body: undefined },
      { method: 'GET', path: RELEASE_PATH, body: undefined },
    ])
  })

  it('fails when Sentry attaches no commits in time', async () => {
    const sentry = fakeSentry([0])

    await expect(attachReleaseCommits(sentry.api, TARGET, NO_WAIT)).rejects.toThrow(
      /Sentry took the commit for release a{40} but attached none after 3 checks; check Sentry's GitHub integration/u,
    )
  })

  it('fails when Sentry answers for a different release', async () => {
    const sentry = fakeSentry([1], 'b'.repeat(40))

    await expect(attachReleaseCommits(sentry.api, TARGET, NO_WAIT)).rejects.toThrow(
      /Sentry answered for release b{40}, not a{40}/u,
    )
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

    await expect(api('PUT', '/api/0/x/', {})).rejects.toThrow(
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
      answering(
        400,
        JSON.stringify({
          refs: ['Invalid repository names: kodes-agency/reputation-key'],
        }),
      ),
    )

    await expect(api('PUT', '/api/0/x/', {})).rejects.toThrow(
      /Sentry answered 400: .*Invalid repository names/u,
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
