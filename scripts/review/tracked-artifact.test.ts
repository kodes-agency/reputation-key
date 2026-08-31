import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readTrackedArtifact, trackedArtifactLedgerRow } from './tracked-artifact'

const temporaryRoots: string[] = []

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root) rmSync(root, { recursive: true, force: true })
  }
})

function temporarySourceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'repkey-tracked-artifact-'))
  temporaryRoots.push(root)
  return root
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('frozen baseline tracked-artifact reads', () => {
  it('returns the bytes it read for a regular file', () => {
    const root = temporarySourceRoot()
    writeFileSync(join(root, 'tracked.txt'), 'ledger contents')

    const artifact = readTrackedArtifact(root, 'tracked.txt')

    expect(artifact.kind).toBe('file')
    expect(artifact.symlinkTarget).toBeUndefined()
    expect(artifact.contents.toString('utf8')).toBe('ledger contents')
  })

  // The regression this exists for: `O_RDONLY | O_NONBLOCK` on a FIFO returns a
  // descriptor that reads as EOF, so a reader without the `isFile()` guard
  // records `bytes: 0` and the sha256 of an empty buffer — a silently wrong row
  // in release evidence, worse than the hang it replaced. Verified by removing
  // the guard: this case then returns bytes 0 and e3b0c442… instead of throwing.
  //
  // O_NONBLOCK itself is NOT covered by an assertion, and cannot be: without it
  // the `openSync` below blocks inside a syscall, which no per-test timeout can
  // interrupt — vitest hangs rather than failing (measured: no output after 90s
  // on this file). O_NONBLOCK is what makes this test terminate at all.
  it('refuses a FIFO at a tracked path instead of recording it as empty', () => {
    const root = temporarySourceRoot()
    execFileSync('mkfifo', [join(root, 'tracked.txt')])

    expect(() => readTrackedArtifact(root, 'tracked.txt')).toThrow(
      'Tracked path is not a regular file: tracked.txt',
    )
  })

  it('refuses a directory at a tracked path', () => {
    const root = temporarySourceRoot()
    mkdirSync(join(root, 'tracked.txt'))

    expect(() => readTrackedArtifact(root, 'tracked.txt')).toThrow(
      'Tracked path is not a regular file: tracked.txt',
    )
  })

  // These three cases are the coverage for O_NOFOLLOW. There is no path-level
  // `lstat` to classify the entry, so ELOOP from the open is the ONLY thing
  // that routes a link to the symlink branch. Deleting `| constants.O_NOFOLLOW`
  // makes the open resolve through the link and fails all three, each in a
  // different way: the first records `kind: 'file'` holding the TARGET's
  // contents, the second throws the regular-file refusal for the directory
  // behind the link, and the third throws ENOENT for the missing target.
  // (Measured with the flag deleted: 3 failed | 8 passed.)
  it('records a symlink to a regular file by its target instead of following it', () => {
    const root = temporarySourceRoot()
    writeFileSync(join(root, 'target.txt'), 'followed contents')
    symlinkSync('target.txt', join(root, 'link.txt'))

    const artifact = readTrackedArtifact(root, 'link.txt')

    expect(artifact.kind).toBe('symlink')
    expect(artifact.symlinkTarget).toBe('target.txt')
    expect(artifact.contents.toString('utf8')).toBe('target.txt')
    expect(artifact.contents.toString('utf8')).not.toBe('followed contents')
  })

  it('records a symlink to a directory rather than refusing it as irregular', () => {
    const root = temporarySourceRoot()
    mkdirSync(join(root, 'target-dir'))
    symlinkSync('target-dir', join(root, 'link.txt'))

    const artifact = readTrackedArtifact(root, 'link.txt')

    expect(artifact.kind).toBe('symlink')
    expect(artifact.symlinkTarget).toBe('target-dir')
    expect(artifact.contents.toString('utf8')).toBe('target-dir')
  })

  it('records a dangling symlink by its target rather than failing to open it', () => {
    const root = temporarySourceRoot()
    symlinkSync('nowhere.txt', join(root, 'link.txt'))

    const artifact = readTrackedArtifact(root, 'link.txt')

    expect(artifact.kind).toBe('symlink')
    expect(artifact.symlinkTarget).toBe('nowhere.txt')
  })

  it('propagates a missing tracked path instead of recording an empty row', () => {
    const root = temporarySourceRoot()

    expect(() => readTrackedArtifact(root, 'absent.txt')).toThrow(
      expect.objectContaining({ code: 'ENOENT' }),
    )
  })
})

describe('frozen baseline ledger rows', () => {
  // `bytes` must come from the buffer that was hashed, never from a stat of the
  // path. This row is built for a path that does not exist, so any reader that
  // reintroduces a filesystem call to size the entry throws ENOENT here.
  it('sizes and digests a row from the buffer alone, never from the path', () => {
    const row = trackedArtifactLedgerRow('src/absent/never-created.ts', {
      contents: Buffer.from('synthetic contents'),
      kind: 'file',
    })

    expect(row.bytes).toBe(18)
    expect(row.sha256).toBe(sha256('synthetic contents'))
    expect(row.symlinkTarget).toBeUndefined()
    expect(row.class).toBe('production')
  })

  it('counts bytes rather than characters for multi-byte contents', () => {
    const row = trackedArtifactLedgerRow('docs/notes.md', {
      contents: Buffer.from('é☃'),
      kind: 'file',
    })

    expect(row.bytes).toBe(5)
    expect(row.sha256).toBe(sha256('é☃'))
  })

  it('threads kind and symlink target through to the row', () => {
    const row = trackedArtifactLedgerRow('src/link.ts', {
      contents: Buffer.from('target.ts'),
      kind: 'symlink',
      symlinkTarget: 'target.ts',
    })

    expect(row.kind).toBe('symlink')
    expect(row.symlinkTarget).toBe('target.ts')
    expect(row.bytes).toBe(9)
    expect(row.sha256).toBe(sha256('target.ts'))
  })

  it('agrees with the bytes readTrackedArtifact actually read', () => {
    const root = temporarySourceRoot()
    writeFileSync(join(root, 'tracked.txt'), 'ledger contents')

    const artifact = readTrackedArtifact(root, 'tracked.txt')
    const row = trackedArtifactLedgerRow('tracked.txt', artifact)

    expect(row.bytes).toBe(artifact.contents.byteLength)
    expect(row.bytes).toBe(15)
    expect(row.sha256).toBe(sha256('ledger contents'))
    expect(row.kind).toBe('file')
  })
})
