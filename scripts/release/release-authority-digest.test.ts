import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  RELEASE_AUTHORITY_SOURCE_PATHS,
  assertReleaseControllerSourceDigest,
  releaseControllerSourceDigest,
} from './release-authority-digest'

describe('signed release-controller authority digest', () => {
  it('covers the controller, its policy/runtime dependencies, and toolchain inputs', () => {
    expect(RELEASE_AUTHORITY_SOURCE_PATHS).toEqual([
      '.railway',
      'package.json',
      'pnpm-lock.yaml',
      'scripts/ops/operator-command.ts',
      'scripts/release',
      'src/contexts/identity',
      'src/contexts/property',
      'src/contexts/team',
      'src/shared',
      'tsconfig.json',
      'tsconfig.scripts.json',
    ])
    expect(releaseControllerSourceDigest()).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('refuses any local controller source set other than the signed digest', () => {
    const signed = 'a'.repeat(64)
    expect(() => assertReleaseControllerSourceDigest(signed, signed)).not.toThrow()
    expect(() => assertReleaseControllerSourceDigest(signed, 'b'.repeat(64))).toThrow(
      'local release-controller digest',
    )
    expect(() => assertReleaseControllerSourceDigest('not-a-digest', signed)).toThrow(
      'signed release-controller digest is invalid',
    )
  })

  it.each(['src/contexts/identity', 'src/contexts/property'])(
    'changes the signed digest when the dynamically loaded %s authority changes',
    (authorityRoot) => {
      const root = mkdtempSync(join(tmpdir(), 'repkey-release-authority-test-'))
      const directoryRoots = new Set([
        '.railway',
        'scripts/release',
        'src/contexts/identity',
        'src/contexts/property',
        'src/contexts/team',
        'src/shared',
      ])
      try {
        for (const path of RELEASE_AUTHORITY_SOURCE_PATHS) {
          if (directoryRoots.has(path)) {
            mkdirSync(join(root, path), { recursive: true })
            writeFileSync(join(root, path, 'authority.ts'), `${path}\n`)
          } else {
            const file = join(root, path)
            mkdirSync(dirname(file), { recursive: true })
            writeFileSync(file, `${path}\n`)
          }
        }
        const before = releaseControllerSourceDigest(root)
        writeFileSync(join(root, authorityRoot, 'authority.ts'), 'changed authority\n')
        expect(releaseControllerSourceDigest(root)).not.toBe(before)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
  )
})
