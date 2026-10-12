// Source-tree traversal for static-source guard tests.
//
// The architecture and governance suites assert things about the SHAPE of the
// repository — "no file in this context imports that" — which means they have
// to enumerate files rather than import them. Seven of those suites had grown a
// byte-identical copy of the same recursive walk; a change to one (following
// symlinks, skipping a directory) would silently not reach the other six.

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..')

/**
 * Every file beneath `dir`, recursively, as absolute paths. Directories are
 * descended into and never returned themselves.
 *
 * Deliberately unfiltered: each guard test applies its own extension and
 * `.test.ts` filters, and a shared filter would quietly change what a guard
 * covers.
 */
export function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/**
 * The source without its comments: block comments, and `//` comments that start a
 * line or follow whitespace (so the `//` of a URL in a string survives). For a
 * guard that must not trip over a comment quoting the very spelling it forbids.
 */
export function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1')
}

export type SourceFile = Readonly<{
  /** Relative to the repository root, with forward slashes. */
  path: string
  text: string
}>

type UiSourceOptions = Readonly<{
  /** Also read `.ts` files (a hook, a helper), not only `.tsx` components. */
  includeTs?: boolean
  /** `kept` for a guard that reads comments too; the default drops them. */
  comments?: 'stripped' | 'kept'
}>

const UI_SOURCES = ['src/components', 'src/routes'] as const
const NOT_A_SOURCE = /\.(stories|test)\./u

/**
 * The component and route sources a UI-consistency guard reads: every file under
 * `src/components` and `src/routes` that is not a story or a test, with its path and its
 * text, comments dropped unless the guard asks to keep them. The guards in
 * `src/components/**` each used to carry their own copy of this walk, and a change to
 * one (a new root, a new extension) missed the others.
 */
export function readUiSources({
  includeTs = false,
  comments = 'stripped',
}: UiSourceOptions = {}): SourceFile[] {
  const extension = includeTs ? /\.tsx?$/u : /\.tsx$/u
  return UI_SOURCES.flatMap((source) => walk(join(REPO_ROOT, source)))
    .filter((path) => extension.test(path) && !NOT_A_SOURCE.test(path))
    .map((path) => {
      const text = readFileSync(path, 'utf8')
      return {
        path: relative(REPO_ROOT, path),
        text: comments === 'stripped' ? stripComments(text) : text,
      }
    })
}
