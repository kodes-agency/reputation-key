import { describe, expect, it } from 'vitest'
import { COMMIT_LOG_FORMAT, parseCommitLog } from './git-commit-log.ts'

const RS = '\x1e'
const US = '\x1f'

function record(fields: readonly string[], changes: string): string {
  return `${RS}${fields.join(US)}${US}\n\n${changes}`
}

describe('parseCommitLog', () => {
  it('reads each commit with its author, time, message and changed files', () => {
    const log =
      record(
        [
          'a'.repeat(40),
          'Bozhidar Denev',
          'owner@users.noreply.github.com',
          '2026-10-22T20:07:31+00:00',
          'fix(sync): refund the cursor\n\nFixes JAVASCRIPT-TANSTACKSTART-REACT-4\n',
        ],
        'M\tsrc/sync.ts\nA\tsrc/new.ts\nD\tsrc/old.ts\n',
      ) +
      record(
        [
          'b'.repeat(40),
          'Claude',
          'noreply@anthropic.com',
          '2026-10-22T19:00:00+00:00',
          'docs: one line',
        ],
        'R087\tdocs/a.md\tdocs/b.md\nC100\tsrc/x.ts\tsrc/y.ts\nT\tbin/run\n',
      )

    expect(parseCommitLog(log)).toEqual([
      {
        id: 'a'.repeat(40),
        author_name: 'Bozhidar Denev',
        author_email: 'owner@users.noreply.github.com',
        timestamp: '2026-10-22T20:07:31+00:00',
        message: 'fix(sync): refund the cursor\n\nFixes JAVASCRIPT-TANSTACKSTART-REACT-4',
        patch_set: [
          { path: 'src/sync.ts', type: 'M' },
          { path: 'src/new.ts', type: 'A' },
          { path: 'src/old.ts', type: 'D' },
        ],
      },
      {
        id: 'b'.repeat(40),
        author_name: 'Claude',
        author_email: 'noreply@anthropic.com',
        timestamp: '2026-10-22T19:00:00+00:00',
        message: 'docs: one line',
        patch_set: [
          { path: 'docs/a.md', type: 'D' },
          { path: 'docs/b.md', type: 'A' },
          { path: 'src/y.ts', type: 'A' },
          { path: 'bin/run', type: 'M' },
        ],
      },
    ])
  })

  it('reads a commit that changed no files, such as a merge', () => {
    const log = record(
      ['c'.repeat(40), 'A', 'a@example.com', '2026-10-22T18:00:00+00:00', 'Merge'],
      '',
    )

    expect(parseCommitLog(log)).toMatchObject([{ id: 'c'.repeat(40), patch_set: [] }])
  })

  it('refuses output that is not in the expected format', () => {
    expect(() => parseCommitLog(`${RS}not-a-sha${US}x`)).toThrow(
      /git log returned a commit record that does not start with a commit SHA/u,
    )
  })

  it('asks git for exactly the fields it parses', () => {
    expect(COMMIT_LOG_FORMAT).toBe('--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1f')
  })
})
