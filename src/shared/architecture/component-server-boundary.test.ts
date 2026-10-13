// The component/server boundary gate, run as the process `pnpm lint` runs.
//
// src/components/CONTEXT.md ("Server-function boundary") lets ONE file with five
// or more related mutations value-import its server functions, and says not to
// widen that to the file's whole feature. These tests hold the checker to it.

import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const CHECKER = join(ROOT, 'scripts/check-component-boundaries.mjs')
const VALUE_IMPORT = "import { updatePortal } from '#/contexts/portal/server/portals'\n"
const TYPE_IMPORT =
  "import type { updatePortal } from '#/contexts/portal/server/portals'\n"
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** A components tree holding `files`, keyed by path below it. */
function componentsTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'repkey-component-boundary-'))
  temporaryRoots.push(root)
  for (const [path, source] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), source)
  }
  return root
}

function check(
  ...directory: string[]
): Readonly<{ status: number | null; output: string }> {
  const result = spawnSync(process.execPath, [CHECKER, ...directory], {
    cwd: ROOT,
    encoding: 'utf8',
  })
  return { status: result.status, output: `${result.stdout}${result.stderr}` }
}

describe('component/server boundary checker', () => {
  it('lets the two documented hooks value-import their server functions', () => {
    const result = check(
      componentsTree({
        'inbox/use-reply-actions.ts': VALUE_IMPORT,
        'features/portal/link-tree/use-linktree-mutations.ts': VALUE_IMPORT,
      }),
    )

    expect(result.output).toContain('No component/server boundary violations')
    expect(result.status).toBe(0)
  })

  // R1D-02: the exception is one file, not the directory it lives in.
  it('refuses a value import in a new file beside the Linktree hook', () => {
    const result = check(
      componentsTree({
        'features/portal/link-tree/use-linktree-mutations.ts': VALUE_IMPORT,
        'features/portal/link-tree/link-foo.tsx': VALUE_IMPORT,
      }),
    )

    expect(result.output).toContain('features/portal/link-tree/link-foo.tsx')
    expect(result.output).not.toContain('use-linktree-mutations.ts')
    expect(result.status).toBe(1)
  })

  it('allows a type-only server import anywhere', () => {
    const result = check(
      componentsTree({ 'features/portal/link-tree/link-foo.tsx': TYPE_IMPORT }),
    )

    expect(result.output).toContain('No component/server boundary violations')
    expect(result.status).toBe(0)
  })

  it('refuses a value import in any other component', () => {
    const result = check(componentsTree({ 'features/property/card.tsx': VALUE_IMPORT }))

    expect(result.output).toContain('features/property/card.tsx')
    expect(result.status).toBe(1)
  })

  it('passes on the repository component tree when given no directory', () => {
    const result = check()

    expect(result.output).toContain('No component/server boundary violations')
    expect(result.status).toBe(0)
  })
})
