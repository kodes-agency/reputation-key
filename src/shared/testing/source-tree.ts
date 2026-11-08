// Shared enumeration keeps static-source guards covering the same modules as
// screens move between component and feature folders.

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
 * The UI sources a consistency guard reads: components, routes and feature
 * screens, excluding stories and tests, with each source path and its
 * text, comments dropped unless the guard asks to keep them. The guards in
 * `src/components/**` each used to carry their own copy of this walk, and a change to
 * one (a new root, a new extension) missed the others.
 */
export function readUiSources({
  includeTs = false,
  comments = 'stripped',
}: UiSourceOptions = {}): SourceFile[] {
  const extension = includeTs ? /\.tsx?$/u : /\.tsx$/u
  const featureScreens = walk(join(REPO_ROOT, 'src/contexts')).filter((path) =>
    /^src\/contexts\/[^/]+\/[^/]+\/ui\//u.test(relative(REPO_ROOT, path)),
  )
  return [
    ...UI_SOURCES.flatMap((source) => walk(join(REPO_ROOT, source))),
    ...featureScreens,
  ]
    .filter((path) => extension.test(path) && !NOT_A_SOURCE.test(path))
    .map((path) => {
      const text = readFileSync(path, 'utf8')
      return {
        path: relative(REPO_ROOT, path),
        text: comments === 'stripped' ? stripComments(text) : text,
      }
    })
}
