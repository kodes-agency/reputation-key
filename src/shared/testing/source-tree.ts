// Source-tree traversal for static-source guard tests.
//
// The architecture and governance suites assert things about the SHAPE of the
// repository — "no file in this context imports that" — which means they have
// to enumerate files rather than import them. Seven of those suites had grown a
// byte-identical copy of the same recursive walk; a change to one (following
// symlinks, skipping a directory) would silently not reach the other six.

import { readdirSync } from 'node:fs'
import { join } from 'node:path'

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
