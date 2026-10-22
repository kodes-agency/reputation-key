import { describe, expect, it } from 'vitest'
import { parseChangedFiles, parseCommitMeta, readCommits } from './git-commit-log.ts'

const SHA = 'a'.repeat(40)
const NUL = '\0'

describe('parseCommitMeta', () => {
  it('reads the author, time and the whole message, whatever it contains', () => {
    const message = 'fix: x\x1e\x1f\t"quoted"\n\nFixes JAVASCRIPT-TANSTACKSTART-REACT-4\n'

    expect(
      parseCommitMeta(
        SHA,
        [
          'Bozhidar Denev',
          'owner@users.noreply.github.com',
          '2026-10-22T20:07:31+00:00',
          message,
        ].join(NUL),
      ),
    ).toEqual({
      id: SHA,
      author_name: 'Bozhidar Denev',
      author_email: 'owner@users.noreply.github.com',
      timestamp: '2026-10-22T20:07:31+00:00',
      message: 'fix: x\x1e\x1f\t"quoted"\n\nFixes JAVASCRIPT-TANSTACKSTART-REACT-4',
    })
  })

  it('refuses output with a missing field', () => {
    expect(() => parseCommitMeta(SHA, `name${NUL}email`)).toThrow(
      /git show returned 2 fields for a{40}, expected 4/u,
    )
  })
})

describe('parseChangedFiles', () => {
  it('maps every git change to added, modified or deleted, with paths as they are', () => {
    const output = [
      'M',
      'src/sync.ts',
      'A',
      'docs/café.md',
      'D',
      'src/q"uote.ts',
      'R087',
      'docs/old name.md',
      'docs/new\tname.md',
      'C100',
      'src/x.ts',
      'src/y.ts',
      'T',
      'bin/run',
      '',
    ].join(NUL)

    expect(parseChangedFiles(output)).toEqual([
      { path: 'src/sync.ts', type: 'M' },
      { path: 'docs/café.md', type: 'A' },
      { path: 'src/q"uote.ts', type: 'D' },
      { path: 'docs/old name.md', type: 'D' },
      { path: 'docs/new\tname.md', type: 'A' },
      { path: 'src/y.ts', type: 'A' },
      { path: 'bin/run', type: 'M' },
    ])
  })

  it('reads no changes, as for a merge commit', () => {
    expect(parseChangedFiles('')).toEqual([])
  })

  it('refuses a change that is missing its path', () => {
    expect(() => parseChangedFiles(`R100${NUL}only-one${NUL}`)).toThrow(
      /git diff-tree returned "R100" without its paths/u,
    )
  })
})

describe('readCommits', () => {
  it('reads each commit the range lists, newest first, with its files', () => {
    const older = 'b'.repeat(40)
    const calls: string[][] = []
    const git = (args: readonly string[]): string => {
      calls.push([...args])
      if (args[0] === 'log') return `${SHA}\n${older}\n`
      if (args[0] === 'show') {
        return [
          'Owner',
          'owner@example.com',
          '2026-10-22T20:00:00+00:00',
          `subject of ${args.at(-1)}`,
        ].join(NUL)
      }
      return args.at(-1) === SHA ? `M${NUL}src/a.ts${NUL}` : ''
    }

    expect(readCommits([`${older}..${SHA}`], git)).toEqual([
      expect.objectContaining({
        id: SHA,
        message: `subject of ${SHA}`,
        patch_set: [{ path: 'src/a.ts', type: 'M' }],
      }),
      expect.objectContaining({
        id: older,
        message: `subject of ${older}`,
        patch_set: [],
      }),
    ])
    expect(calls[0]).toEqual(['log', '--format=%H', `${older}..${SHA}`])
    expect(calls[1]).toEqual(['show', '-s', '--format=%an%x00%ae%x00%aI%x00%B', SHA])
    expect(calls[2]).toEqual([
      'diff-tree',
      '--root',
      '--no-commit-id',
      '-r',
      '-z',
      '--name-status',
      '-M',
      SHA,
    ])
  })

  it('refuses a listed line that is not a commit SHA', () => {
    expect(() => readCommits(['x'], () => 'not-a-sha\n')).toThrow(
      /git log listed "not-a-sha", which is not a commit SHA/u,
    )
  })
})
