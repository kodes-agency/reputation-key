import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readOnce } from './read-once'

// The stat/read race cannot be scheduled from inside a single-threaded test, so
// it is injected instead: any path registered here resolves to DIFFERENT bytes
// when it is read as a PATH, while a read of an open DESCRIPTOR is untouched.
// That is exactly the swap `readOnce` claims to make
// impossible, and it makes the claim falsifiable — an implementation that
// re-resolves the path returns the planted bytes.
const { pathReads } = vi.hoisted(() => ({ pathReads: new Map<string, Buffer>() }))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const readDescriptor: (target: number | string) => Buffer = actual.readFileSync
  return {
    ...actual,
    default: actual,
    readFileSync: (target: number | string): Buffer =>
      (typeof target === 'string' ? pathReads.get(target) : undefined) ??
      readDescriptor(target),
  }
})

const REFUSAL = 'reviewed artifact must be a regular file'
const directories: string[] = []

afterEach(() => {
  pathReads.clear()
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'repkey-artifact-read-test-'))
  directories.push(directory)
  return directory
}

describe('readOnce', () => {
  it('returns the bytes of the descriptor it validated, not of a second path resolution', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'saved-plan.json')
    const reviewed = Buffer.from('{"kind":"railway.config.plan","version":1}', 'utf8')
    const swapped = Buffer.from('{"kind":"railway.config.plan","version":666}', 'utf8')
    writeFileSync(path, reviewed)
    pathReads.set(path, swapped)

    // Negative control: without this the test would pass against an
    // implementation that re-resolves the path, because the seam would be dead.
    expect(readFileSync(path)).toEqual(swapped)

    expect(readOnce(path, REFUSAL)).toEqual(reviewed)
  })

  it('bounds the descriptor it validated, not a second path resolution', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'saved-plan.json')
    const reviewed = Buffer.alloc(64, 0x61)
    writeFileSync(path, reviewed)
    pathReads.set(path, Buffer.alloc(4096, 0x62))

    expect(readOnce(path, REFUSAL, 128)).toEqual(reviewed)
  })

  it('refuses a symlinked path with the caller refusal', () => {
    const directory = temporaryDirectory()
    const target = join(directory, 'reviewed.json')
    const path = join(directory, 'saved-plan.json')
    writeFileSync(target, '{}', 'utf8')
    symlinkSync(target, path)

    expect(() => readOnce(path, REFUSAL)).toThrow(REFUSAL)
  })

  it('refuses a FIFO instead of reading it as zero bytes', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'saved-plan.json')
    execFileSync('mkfifo', [path])

    expect(() => readOnce(path, REFUSAL)).toThrow(REFUSAL)
  })

  it('refuses a directory with the caller refusal', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'saved-plan.json')
    mkdirSync(path)

    expect(() => readOnce(path, REFUSAL)).toThrow(REFUSAL)
  })

  // A unix socket is the input that made an ELOOP-only translation leak a raw
  // errno: `open` reports ENXIO on Linux and an unnamed errno 102 on darwin,
  // neither of which an operator can act on.
  it('refuses a unix socket with the caller refusal, not a raw errno', async () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'saved-plan.json')
    const server = createServer()
    await new Promise<void>((done) => server.listen(path, done))
    try {
      expect(() => readOnce(path, REFUSAL)).toThrow(REFUSAL)
    } finally {
      await new Promise<void>((done) => server.close(() => done()))
    }
  })

  it('refuses a regular file larger than the bound and accepts one at the bound', () => {
    const directory = temporaryDirectory()
    const path = join(directory, 'saved-plan.json')
    writeFileSync(path, Buffer.alloc(65, 0x61))
    expect(() => readOnce(path, REFUSAL, 64)).toThrow(REFUSAL)

    writeFileSync(path, Buffer.alloc(64, 0x61))
    expect(readOnce(path, REFUSAL, 64).byteLength).toBe(64)
  })

  it('raises the original ENOENT for a missing path rather than a refusal', () => {
    const path = join(temporaryDirectory(), 'absent.json')

    expect(() => readOnce(path, REFUSAL)).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    )
    expect(() => readOnce(path, REFUSAL)).not.toThrow(REFUSAL)
  })

  it('raises the original permission error for an unreadable regular file', () => {
    // Root ignores the mode bits, so the case cannot be produced there.
    if (process.getuid?.() === 0) return
    const directory = temporaryDirectory()
    const path = join(directory, 'saved-plan.json')
    writeFileSync(path, '{}', 'utf8')
    chmodSync(path, 0o000)
    try {
      expect(() => readOnce(path, REFUSAL)).toThrow(
        expect.objectContaining({ code: 'EACCES' }),
      )
      expect(() => readOnce(path, REFUSAL)).not.toThrow(REFUSAL)
    } finally {
      chmodSync(path, 0o600)
    }
  })
})
