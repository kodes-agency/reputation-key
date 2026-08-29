import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  readLocalStackFile,
  readOptionalLocalStackFile,
} from './local-stack-artifact-file'

function scratchDirectory(): string {
  return mkdtempSync(resolve(tmpdir(), 'repkey-stack-artifact-'))
}

describe('local stack artifact file reads', () => {
  it('returns the bytes of a regular file', () => {
    const path = resolve(scratchDirectory(), 'ai-subject-hmac.key')
    writeFileSync(path, Buffer.alloc(32, 7))

    expect(readLocalStackFile(path)).toEqual(Buffer.alloc(32, 7))
    expect(readOptionalLocalStackFile(path)).toEqual(Buffer.alloc(32, 7))
  })

  it('reports an absent file as absent only to the optional reader', () => {
    const path = resolve(scratchDirectory(), 'never-generated.key')

    expect(readOptionalLocalStackFile(path)).toBeNull()
    expect(() => readLocalStackFile(path)).toThrow(/ENOENT/)
  })

  // Both halves of the FIFO guard are pinned here. Drop O_NONBLOCK and this open
  // blocks until a writer appears — the per-test timeout cannot interrupt a
  // synchronous open, so the whole run hangs rather than reporting a failure.
  // Keep O_NONBLOCK but drop the isFile() guard and the read returns an empty
  // buffer, which the callers would record as a legitimate zero-length key.
  it('refuses a FIFO instead of blocking on it or reading it as empty', () => {
    const path = resolve(scratchDirectory(), 'ai-request-binding-hmac.key')
    execFileSync('mkfifo', [path])

    expect(() => readLocalStackFile(path)).toThrow(/is not a regular file/)
    expect(() => readOptionalLocalStackFile(path)).toThrow(/is not a regular file/)
  })

  // The message matcher is load-bearing, not decoration. `readFileSync` on a
  // directory descriptor throws EISDIR on its own, so a bare `toThrow()` here
  // stays green with the `isFile()` guard deleted and pins nothing. Asserting
  // the guard's own message is what ties this test to the guard.
  it('refuses a directory', () => {
    const path = resolve(scratchDirectory(), 'google-runtime')
    mkdirSync(path)

    expect(() => readLocalStackFile(path)).toThrow(/is not a regular file/)
    expect(() => readOptionalLocalStackFile(path)).toThrow(/is not a regular file/)
  })

  it('refuses a symlink at the final path component unless the caller opts in', () => {
    const directory = scratchDirectory()
    const target = resolve(directory, 'real-dump.sql')
    const link = resolve(directory, 'latest-dump.sql')
    writeFileSync(target, 'SELECT 1;\n')
    symlinkSync(target, link)

    expect(() => readLocalStackFile(link)).toThrow()
    expect(readLocalStackFile(link, { allowSymlink: true }).toString('utf8')).toBe(
      'SELECT 1;\n',
    )
  })

  // Windows has no O_NONBLOCK/O_NOFOLLOW in fs.constants. `undefined` in a
  // bitwise OR coerces to 0, NOT to NaN, so the flags would collapse to a plain
  // O_RDONLY and drop the FIFO and symlink guards with no error at all. This
  // pins the loud refusal that replaces that silent degradation: the target is
  // a perfectly readable regular file, so a green read here would mean the
  // module had quietly gone back to an unguarded open.
  it('refuses to run where the POSIX open flags are unavailable', async () => {
    const path = resolve(scratchDirectory(), 'ai-subject-hmac.key')
    writeFileSync(path, Buffer.alloc(32, 7))

    vi.resetModules()
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return {
        ...actual,
        constants: {
          ...actual.constants,
          O_NONBLOCK: undefined,
          O_NOFOLLOW: undefined,
        },
      }
    })
    try {
      const flagless = await import('./local-stack-artifact-file')
      expect(() => flagless.readLocalStackFile(path)).toThrow(
        /require POSIX O_NONBLOCK and O_NOFOLLOW/,
      )
      expect(() => flagless.readOptionalLocalStackFile(path)).toThrow(
        /require POSIX O_NONBLOCK and O_NOFOLLOW/,
      )
    } finally {
      vi.doUnmock('node:fs')
      vi.resetModules()
    }
  })

  it('does not mistake a symlink for an ungenerated file', () => {
    const directory = scratchDirectory()
    const target = resolve(directory, 'elsewhere.key')
    const link = resolve(directory, 'ai-admission-ed25519.pk8')
    writeFileSync(target, Buffer.alloc(48))
    symlinkSync(target, link)

    expect(() => readOptionalLocalStackFile(link)).toThrow()
  })
})
