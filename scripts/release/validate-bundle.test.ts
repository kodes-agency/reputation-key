import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { runReleaseValidationCli } from './validate-bundle'

describe('release evidence validation CLI', () => {
  it('requires exactly one evidence format', () => {
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(
        runReleaseValidationCli([
          '--release-id=historical-release',
          `--release-sha=${'a'.repeat(40)}`,
        ]),
      ).toBe(2)
      expect(stderr.mock.calls.flat().join('\n')).toContain('choose exactly one')
    } finally {
      stderr.mockRestore()
    }
  })

  it('rejects a Gate F index outside its declared evidence root', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'repkey-gate-f-cli-'))
    const evidenceRoot = join(temporaryDirectory, 'evidence')
    const outsideIndex = join(temporaryDirectory, 'outside-index.json')
    mkdirSync(evidenceRoot)
    writeFileSync(outsideIndex, '{}\n')
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(
        runReleaseValidationCli([
          `--gate-f-index=${outsideIndex}`,
          `--evidence-root=${evidenceRoot}`,
        ]),
      ).toBe(2)
      expect(stderr.mock.calls.flat().join('\n')).toContain(
        'index resolved outside the evidence root',
      )
    } finally {
      stderr.mockRestore()
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })

  it('passes a contained Gate F index to the strict schema validator', () => {
    const temporaryDirectory = mkdtempSync(join(tmpdir(), 'repkey-gate-f-cli-'))
    const index = join(temporaryDirectory, 'gate-f-index.json')
    writeFileSync(index, '{}\n')
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      expect(runReleaseValidationCli([`--gate-f-index=${index}`])).toBe(1)
      expect(stderr.mock.calls.flat().join('\n')).toContain('Gate F evidence index')
      expect(stderr.mock.calls.flat().join('\n')).toContain('version')
    } finally {
      stderr.mockRestore()
      rmSync(temporaryDirectory, { recursive: true, force: true })
    }
  })
})
