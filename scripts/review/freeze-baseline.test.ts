import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// freeze-baseline.ts calls `main()` at module scope, so it cannot be imported
// without running a freeze. Its wiring is asserted against its source text
// instead — narrow, mechanical properties that a regression would have to
// rewrite deliberately. The behaviour these guard is unit-tested in
// tracked-artifact.test.ts; what is checked here is only that the tool still
// routes through it.
const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'freeze-baseline.ts'),
  'utf8',
)

function nodeFsImportSpecifiers(): ReadonlyArray<string> {
  const block = /import\s*\{([^}]*)\}\s*from\s*'node:fs'/.exec(SOURCE)
  if (!block) throw new Error('freeze-baseline.ts no longer imports from node:fs')
  return block[1]
    .split(',')
    .map((specifier) => specifier.trim())
    .filter(Boolean)
}

describe('freeze-baseline ledger wiring', () => {
  it('imports no path-level stat or readlink from node:fs', () => {
    // The rejected shape is `lstatSync(path)` paired with a later
    // `readFileSync(path)` (CodeQL js/file-system-race). Reverting the ledger
    // loop or the source-file filter to a second `lstat` reintroduces exactly
    // that pairing, and would have to reinstate one of these imports first.
    expect(nodeFsImportSpecifiers()).not.toContain('lstatSync')
    expect(nodeFsImportSpecifiers()).not.toContain('statSync')
    expect(nodeFsImportSpecifiers()).not.toContain('readlinkSync')
    expect(nodeFsImportSpecifiers()).not.toContain('openSync')
  })

  it('builds every ledger row through the shared tracked-artifact reader', () => {
    expect(SOURCE).toContain(
      "import { readTrackedArtifact, trackedArtifactLedgerRow } from './tracked-artifact'",
    )
    expect(SOURCE).toContain('trackedArtifactLedgerRow(file, artifact)')
    // `bytes` and `sha256` belong to the row builder, where they are provably
    // taken from the buffer that was hashed. freeze-baseline must not spell
    // either field itself — doing so is how a stat-derived size gets back in.
    expect(SOURCE).not.toMatch(/\bbytes:/)
    expect(SOURCE).not.toMatch(/\bsha256:\s*sha256\(artifact/)
  })

  it('parses source text from the bytes it hashed rather than re-reading paths', () => {
    for (const parser of [
      'extractImports',
      'extractFunctionLikeSymbols',
      'discoverEntryPoints',
    ]) {
      const call = new RegExp(`${parser}\\(\\s*file,\\s*source`)
      expect(SOURCE).toMatch(call)
    }
    expect(SOURCE).not.toMatch(/readFileSync\(join\(options\.sourceRoot, file\)/)
  })

  it('pins every first-party module that determines a ledger row in provenance', () => {
    // tracked-artifact.ts decides the kind/bytes/sha256 of every ledger row.
    // Without its digest, two bundles built from different hashing code carry
    // byte-identical provenance.
    expect(SOURCE).toContain('inventoryToolSha256')
    expect(SOURCE).toContain('inventoryLibrarySha256')
    expect(SOURCE).toContain('trackedArtifactReaderSha256')
    expect(SOURCE).toMatch(
      /trackedArtifactReaderSha256:\s*sha256\(\s*readFileSync\(join\(dirname\(THIS_FILE\), 'tracked-artifact\.ts'\)\),\s*\)/,
    )
  })
})
