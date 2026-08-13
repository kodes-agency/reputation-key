import { describe, expect, it } from 'vitest'
import { assertReleaseIdentity } from './release-identity'

describe('assertReleaseIdentity', () => {
  it('accepts an exact production candidate match', () => {
    expect(() =>
      assertReleaseIdentity({
        NODE_ENV: 'production',
        RELEASE_SHA: 'a'.repeat(40),
        IMAGE_SOURCE_REVISION: 'a'.repeat(40),
      }),
    ).not.toThrow()
  })

  it('rejects a production candidate mismatch without echoing either revision', () => {
    const releaseSha = 'a'.repeat(40)
    const imageRevision = 'b'.repeat(40)
    let caught: unknown
    try {
      assertReleaseIdentity({
        NODE_ENV: 'production',
        RELEASE_SHA: releaseSha,
        IMAGE_SOURCE_REVISION: imageRevision,
      })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(Error)
    expect((caught as Error).message).toContain('does not match')
    expect((caught as Error).message).not.toContain(releaseSha)
    expect((caught as Error).message).not.toContain(imageRevision)
  })

  it.each([
    {
      NODE_ENV: 'development',
      RELEASE_SHA: 'a'.repeat(40),
      IMAGE_SOURCE_REVISION: 'b'.repeat(40),
    },
    {
      NODE_ENV: 'test',
      RELEASE_SHA: 'a'.repeat(40),
      IMAGE_SOURCE_REVISION: 'b'.repeat(40),
    },
    {
      NODE_ENV: 'production',
      RELEASE_SHA: undefined,
      IMAGE_SOURCE_REVISION: 'a'.repeat(40),
    },
    {
      NODE_ENV: 'production',
      RELEASE_SHA: 'a'.repeat(40),
      IMAGE_SOURCE_REVISION: undefined,
    },
    { NODE_ENV: 'production', RELEASE_SHA: 'unknown', IMAGE_SOURCE_REVISION: 'unknown' },
  ])('does not reject a non-comparable identity %#', (env) => {
    expect(() => assertReleaseIdentity(env)).not.toThrow()
  })
})
