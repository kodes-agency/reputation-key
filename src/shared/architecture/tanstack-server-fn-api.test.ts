// TanStack Start server-function API regression guard.
//
// The pinned runtime deprecated `.inputValidator()` in favor of `.validator()`.
// The production build warns for every legacy call, but warnings do not fail
// CI by themselves. Keep the source tree on the documented validation seam so
// a new endpoint cannot silently reintroduce the deprecated API.

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const SOURCE_ROOTS = [
  join(process.cwd(), 'src', 'contexts'),
  join(process.cwd(), 'src', 'shared'),
] as const

function listRuntimeTypeScript(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return listRuntimeTypeScript(path)
    if (!/\.tsx?$/u.test(name) || /\.(?:test|stories)\.tsx?$/u.test(name)) return []
    return [path]
  })
}

describe('TanStack Start server-function API', () => {
  it('uses validator() instead of the deprecated inputValidator() API', () => {
    const offenders = SOURCE_ROOTS.flatMap(listRuntimeTypeScript)
      .filter((path) => readFileSync(path, 'utf8').includes('.inputValidator('))
      .map((path) => relative(process.cwd(), path))

    expect(
      offenders,
      `deprecated inputValidator() calls:\n${offenders.join('\n')}`,
    ).toEqual([])
  })
})
