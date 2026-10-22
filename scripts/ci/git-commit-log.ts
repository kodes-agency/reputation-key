// Reads commits from the local git history in the shape Sentry's release API
// takes them (docs.sentry.io/product/releases/associate-commits, "Using the
// API"): id, author, time, message and the files each commit touched. The
// files (`patch_set`) are what let Sentry name a suspect commit for an error;
// the message is what lets "Fixes <Sentry short ID>" resolve an issue.
//
// One `git log` reads everything: each commit starts with a record separator
// (0x1e) and its fields are split by a unit separator (0x1f), characters a
// commit message does not contain, followed by `--name-status` lines.

import { execFileSync } from 'node:child_process'

export const COMMIT_LOG_FORMAT = '--format=%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%B%x1f'

const RECORD = '\x1e'
const FIELD = '\x1f'
const FULL_SHA = /^[0-9a-f]{40}$/u
const MAX_BUFFER_BYTES = 64 * 1024 * 1024

export type PatchType = 'A' | 'M' | 'D'

export type SentryCommit = Readonly<{
  id: string
  author_name: string
  author_email: string
  timestamp: string
  message: string
  patch_set: readonly Readonly<{ path: string; type: PatchType }>[]
}>

/**
 * Sentry knows only added, modified and deleted. A rename is the old path
 * deleted and the new one added; a copy adds its new path; a type change
 * (file to symlink, say) modifies.
 */
function changesOf(line: string): Readonly<{ path: string; type: PatchType }>[] {
  const [status = '', first = '', second = ''] = line.split('\t')
  const kind = status.charAt(0)
  if (kind === 'R')
    return [
      { path: first, type: 'D' },
      { path: second, type: 'A' },
    ]
  if (kind === 'C') return [{ path: second, type: 'A' }]
  if (kind === 'A' || kind === 'D') return [{ path: first, type: kind }]
  return first ? [{ path: first, type: 'M' }] : []
}

function parseRecord(record: string): SentryCommit {
  const [id = '', name = '', email = '', timestamp = '', message = '', changes = ''] =
    record.split(FIELD)
  if (!FULL_SHA.test(id)) {
    throw new Error(
      'git log returned a commit record that does not start with a commit SHA',
    )
  }
  return {
    id,
    author_name: name,
    author_email: email,
    timestamp,
    message: message.trim(),
    patch_set: changes
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .flatMap(changesOf),
  }
}

/** Parses `git log COMMIT_LOG_FORMAT --name-status` output, newest first. */
export function parseCommitLog(log: string): readonly SentryCommit[] {
  return log
    .split(RECORD)
    .filter((record) => record.trim() !== '')
    .map(parseRecord)
}

type Git = (args: readonly string[]) => string

const runGit: Git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES })

/** Whether `ancestor` is in the history of `commit`. */
export function isAncestor(ancestor: string, commit: string, git: Git = runGit): boolean {
  try {
    git(['merge-base', '--is-ancestor', ancestor, commit])
    return true
  } catch {
    // Exit 1 means "not an ancestor"; an unknown commit fails the same way,
    // and both mean the range cannot start there.
    return false
  }
}

/** The commits `git log` lists for `range` (e.g. `base..head`, or `-n 20 head`). */
export function readCommits(
  range: readonly string[],
  git: Git = runGit,
): readonly SentryCommit[] {
  return parseCommitLog(git(['log', COMMIT_LOG_FORMAT, '--name-status', ...range]))
}
