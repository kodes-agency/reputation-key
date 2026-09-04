import { describe, expect, it } from 'vitest'
import { adoptGitRevisionAsReleaseSha } from './sidecar-release-identity'

const REVISION = '7aabe93ac8933626ca848cc09f8e46d405c476f4'

describe('sidecar release identity', () => {
  it('adopts the Railway git revision when no RELEASE_SHA was set', () => {
    const env: Record<string, string | undefined> = { RAILWAY_GIT_COMMIT_SHA: REVISION }
    adoptGitRevisionAsReleaseSha(env)
    expect(env.RELEASE_SHA).toBe(REVISION)
  })

  it('keeps a controller-owned RELEASE_SHA over the git revision', () => {
    const env: Record<string, string | undefined> = {
      RELEASE_SHA: 'b'.repeat(40),
      RAILWAY_GIT_COMMIT_SHA: REVISION,
    }
    adoptGitRevisionAsReleaseSha(env)
    expect(env.RELEASE_SHA).toBe('b'.repeat(40))
  })

  it.each([
    ['an empty override', ''],
    ['a short revision', 'abc123'],
    ['upper-case hex', REVISION.toUpperCase()],
  ])(
    'leaves RELEASE_SHA unset for %s so the contract still refuses it',
    (_label, value) => {
      const env: Record<string, string | undefined> = { RAILWAY_GIT_COMMIT_SHA: value }
      adoptGitRevisionAsReleaseSha(env)
      expect(env.RELEASE_SHA).toBeUndefined()
    },
  )

  it('does nothing without a git revision', () => {
    const env: Record<string, string | undefined> = {}
    adoptGitRevisionAsReleaseSha(env)
    expect(env).toEqual({})
  })
})
