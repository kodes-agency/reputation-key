// Reads commits from the local git history in the shape Sentry's release API
// takes them (docs.sentry.io/product/releases/associate-commits, "Using the
// API"): id, author, time, message and the files each commit touched. The
// files (`patch_set`) are what let Sentry name a suspect commit for an error;
// the message is what lets "Fixes <Sentry short ID>" resolve an issue.
//
// Every field is read NUL-separated, one commit at a time. NUL is the one byte
// git keeps out of messages and paths, so a message may hold any other control
// character and a path any quote, tab or non-ASCII letter, and both arrive
// intact. Without `-z` git quotes such paths ("caf\303\251.md"), and Sentry
// could never match them to a stack frame. A few hundred small git processes
// cost well under a second.

import { execFileSync } from 'node:child_process'

const NUL = '\0'
const FULL_SHA = /^[0-9a-f]{40}$/u
const MAX_BUFFER_BYTES = 64 * 1024 * 1024
const META_FIELDS = 4

export type PatchType = 'A' | 'M' | 'D'
export type FileChange = Readonly<{ path: string; type: PatchType }>

export type SentryCommit = Readonly<{
  id: string
  author_name: string
  author_email: string
  timestamp: string
  message: string
  patch_set: readonly FileChange[]
}>

type Git = (args: readonly string[]) => string

const runGit: Git = (args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES })

/** Parses `git show -s --format=%an%x00%ae%x00%aI%x00%B <sha>`. */
export function parseCommitMeta(
  id: string,
  output: string,
): Omit<SentryCommit, 'patch_set'> {
  const fields = output.split(NUL)
  const [name = '', email = '', timestamp = '', message = ''] = fields
  if (fields.length !== META_FIELDS) {
    throw new Error(
      `git show returned ${fields.length} fields for ${id}, expected ${META_FIELDS}`,
    )
  }
  return {
    id,
    author_name: name,
    author_email: email,
    timestamp,
    message: message.trim(),
  }
}

/**
 * Parses `git diff-tree -z --name-status -M`: a status, then one path, or two
 * for a rename or copy. Sentry knows only added, modified and deleted: a rename
 * deletes the old path and adds the new one, a copy adds the new path, and a
 * type change (file to symlink, say) modifies.
 */
export function parseChangedFiles(output: string): readonly FileChange[] {
  const tokens = output.split(NUL).filter((token) => token !== '')
  const changes: FileChange[] = []
  for (let at = 0; at < tokens.length;) {
    const status = tokens[at] ?? ''
    const kind = status.charAt(0)
    const paths = kind === 'R' || kind === 'C' ? 2 : 1
    const [first, second] = tokens.slice(at + 1, at + 1 + paths)
    if (first === undefined || (paths === 2 && second === undefined)) {
      throw new Error(`git diff-tree returned "${status}" without its paths`)
    }
    if (kind === 'R')
      changes.push({ path: first, type: 'D' }, { path: second ?? '', type: 'A' })
    else if (kind === 'C') changes.push({ path: second ?? '', type: 'A' })
    else if (kind === 'A' || kind === 'D') changes.push({ path: first, type: kind })
    else changes.push({ path: first, type: 'M' })
    at += 1 + paths
  }
  return changes
}

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

/** The commits `git log` lists for `range` (`base..head`, or `-n 20 head`), newest first. */
export function readCommits(
  range: readonly string[],
  git: Git = runGit,
): readonly SentryCommit[] {
  const ids = git(['log', '--format=%H', ...range])
    .split('\n')
    .filter(Boolean)
  return ids.map((id) => {
    if (!FULL_SHA.test(id))
      throw new Error(`git log listed "${id}", which is not a commit SHA`)
    return {
      ...parseCommitMeta(id, git(['show', '-s', '--format=%an%x00%ae%x00%aI%x00%B', id])),
      patch_set: parseChangedFiles(
        git([
          'diff-tree',
          '--root',
          '--no-commit-id',
          '-r',
          '-z',
          '--name-status',
          '-M',
          id,
        ]),
      ),
    }
  })
}
