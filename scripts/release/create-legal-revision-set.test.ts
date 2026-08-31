import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IN_PRODUCT_NOTICES } from '../../src/shared/governance/legal-link-targets'
import {
  parseLegalRevisionSetEvidence,
  type LegalRevisionSetContext,
} from '../../src/shared/release/legal-revision-set-evidence'
import {
  approvedLegalDocumentsFixture,
  legalDocumentReaderFixture,
  LEGAL_FIXTURE_CAPTURED_AT,
} from '../../src/shared/release/legal-revision-set-evidence.test-fixtures'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
import { runCreateLegalRevisionSetCli } from './create-legal-revision-set'

const ROOT = resolve(import.meta.dirname, '../..')
const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function scratchOut(name = 'legal-revision-set.json'): string {
  const root = mkdtempSync(join(tmpdir(), 'repkey-legal-revision-set-'))
  roots.push(root)
  return join(root, name)
}

const REQUIRED_ARGS = [
  `--release-sha=${'a'.repeat(40)}`,
  `--release-manifest-sha256=${'b'.repeat(64)}`,
  '--project-id=railway-project-us-production',
  '--environment-id=railway-environment-cell-us',
] as const

type Capture = Readonly<{
  stdout: string[]
  stderr: string[]
  writes: Array<Readonly<{ path: string; content: string }>>
}>

function capture(): Capture {
  return { stdout: [], stderr: [], writes: [] }
}

/** Registry, document bytes and injection overrides for an approved world. */
function approved() {
  const fixture = approvedLegalDocumentsFixture()
  const context: LegalRevisionSetContext = {
    registry: fixture.registry,
    inProductNotices: IN_PRODUCT_NOTICES,
  }
  return {
    context,
    overrides: {
      registry: fixture.registry,
      readFile: legalDocumentReaderFixture(fixture.files),
      now: new Date(LEGAL_FIXTURE_CAPTURED_AT),
    },
  }
}

function run(
  args: readonly string[],
  sink: Capture,
  overrides: Parameters<typeof runCreateLegalRevisionSetCli>[1] = {},
): number {
  return runCreateLegalRevisionSetCli(args, {
    writeFile: (path, content) => sink.writes.push({ path, content }),
    writeOut: (line) => sink.stdout.push(line),
    writeError: (line) => sink.stderr.push(line),
    ...overrides,
  })
}

describe('legal revision set producer', () => {
  it('refuses to emit anything while counsel-owned documents are drafts', () => {
    // The executable form of "never fabricate external evidence": run against
    // the CURRENT repository, where counsel has approved nothing, the tool
    // must fail rather than produce a plausible artifact.
    const sink = capture()
    const out = scratchOut()

    expect(run([...REQUIRED_ARGS, `--out=${out}`], sink)).toBe(1)
    expect(sink.stderr.join('\n')).toContain(
      'refusing to emit: 3 legal documents are drafts (privacy-notice, internal-beta-agreement, google-access-disclosure)',
    )
    expect(sink.writes).toEqual([])
    expect(existsSync(out)).toBe(false)
  })

  it('emits a canonical artifact that round-trips once every document is approved', () => {
    const sink = capture()
    const out = scratchOut()
    const { context, overrides } = approved()

    expect(run([...REQUIRED_ARGS, `--out=${out}`], sink, overrides)).toBe(0)
    expect(sink.writes).toHaveLength(1)

    const written = sink.writes[0]!
    expect(written.path).toBe(out)
    const parsed = parseLegalRevisionSetEvidence(written.content, context)
    expect(parsed).toMatchObject({ ok: true })
    if (!parsed.ok) return
    expect(parsed.evidence.candidate).toMatchObject({
      releaseSha: 'a'.repeat(40),
      cell: 'us',
      environment: 'cell-us',
      projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
    })
    expect(parsed.evidence.outcome).toBe('passed')
    expect(parsed.evidence.documents.map(({ id }) => id)).toContain('merchant-ai-notice')
    // The emitted digest is reported so the Gate F index can bind it without
    // a second hashing implementation.
    expect(sink.stdout.join('\n')).toContain(parsed.digest)
  })

  it('requires the release identity flags and refuses any cell but us', () => {
    const out = scratchOut()
    for (const missing of [
      '--release-sha',
      '--release-manifest-sha256',
      '--project-id',
      '--environment-id',
    ]) {
      const sink = capture()
      const args = REQUIRED_ARGS.filter((arg) => !arg.startsWith(`${missing}=`))
      expect(run([...args, `--out=${out}`], sink), missing).toBe(2)
      expect(sink.stderr.join('\n'), missing).toContain(missing)
      expect(sink.writes).toEqual([])
    }

    const sink = capture()
    expect(run([...REQUIRED_ARGS, `--out=${out}`, '--cell=europe'], sink)).toBe(2)
    expect(sink.stderr.join('\n')).toContain(
      'beta legal revision set must bind cell-us only',
    )
    expect(sink.writes).toEqual([])

    const missingOut = capture()
    expect(run([...REQUIRED_ARGS], missingOut)).toBe(2)
    expect(missingOut.stderr.join('\n')).toContain('--out')
  })

  it('rejects a parent-escaping output path and otherwise writes exactly one file', () => {
    // Same containment discipline as scripts/release/validate-bundle.ts: the
    // tool has one output and cannot be aimed at a path assembled elsewhere.
    for (const escaping of [
      'docs/release-evidence/../../escaped.json',
      '..\\escaped.json',
      'docs/./escaped.json',
    ]) {
      const sink = capture()
      expect(run([...REQUIRED_ARGS, `--out=${escaping}`], sink), escaping).toBe(2)
      expect(sink.stderr.join('\n'), escaping).toContain(
        'output path must be a normalized path without parent segments',
      )
      expect(sink.writes, escaping).toEqual([])
    }

    const sink = capture()
    const out = scratchOut()
    expect(run([...REQUIRED_ARGS, `--out=${out}`], sink, approved().overrides)).toBe(0)
    expect(sink.writes.map((write) => write.path)).toEqual([out])
  })

  it('refuses to emit when an approved document no longer matches its digest', () => {
    const sink = capture()
    const out = scratchOut()
    const { overrides } = approved()
    const tampered = {
      ...overrides.registry,
      documents: overrides.registry.documents.map((document) =>
        document.id === 'privacy-notice'
          ? { ...document, sha256: 'c'.repeat(64) }
          : document,
      ),
    }

    expect(
      run([...REQUIRED_ARGS, `--out=${out}`], sink, { ...overrides, registry: tampered }),
    ).toBe(1)
    expect(sink.stderr.join('\n')).toContain('privacy-notice')
    expect(sink.writes).toEqual([])
  })

  it('reads the shipped registry bytes when no registry is injected', () => {
    // Guards the default path: the refusal above must come from the real
    // artifact on disk, not from a hardcoded constant.
    const shipped = readFileSync(
      resolve(ROOT, 'docs/legal/legal-document-registry.json'),
      'utf8',
    )
    expect(shipped).toContain('"status": "draft"')
    expect(shipped).not.toContain('"status": "approved"')
  })
})
