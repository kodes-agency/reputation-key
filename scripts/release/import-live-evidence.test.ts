import { describe, expect, it } from 'vitest'
import { completeBundleCandidate } from '../../src/shared/release/gate-f-complete-evidence.test-fixtures'
import { remainingGateFTypedFixtures } from '../../src/shared/release/gate-f-live-evidence.test-fixtures'
import {
  LIVE_EVIDENCE_GATE_IDS,
  type LiveEvidenceGateId,
} from '../../src/shared/release/live-evidence'
import {
  runImportLiveEvidenceCli,
  type ImportLiveEvidenceDependencies,
} from './import-live-evidence'

const CANDIDATE = completeBundleCandidate()
const FIXTURES = remainingGateFTypedFixtures(CANDIDATE)

function raw(gate: LiveEvidenceGateId): string {
  const fixture = FIXTURES[gate]
  if (!fixture) throw new Error(`no fixture for ${gate}`)
  // The operator's capture is pretty-printed, not canonical — the CLI has to
  // canonicalize it without altering a single value.
  return `${JSON.stringify(JSON.parse(fixture.content), null, 2)}\n`
}

type Harness = Readonly<{
  deps: ImportLiveEvidenceDependencies
  written: Map<string, string>
  errors: string[]
  logs: string[]
  writeAttempts: string[]
}>

function harness(
  files: Readonly<Record<string, string>>,
  existing: readonly string[] = [],
): Harness {
  const written = new Map<string, string>()
  const errors: string[] = []
  const logs: string[] = []
  const writeAttempts: string[] = []
  return {
    written,
    errors,
    logs,
    writeAttempts,
    deps: {
      readFile: (path) => {
        const content = files[path]
        if (content === undefined) throw new Error(`no file at ${path}`)
        return content
      },
      writeFileExclusive: (path, content) => {
        writeAttempts.push(path)
        if (existing.includes(path) || written.has(path)) {
          throw Object.assign(new Error(`EEXIST: file already exists, open '${path}'`), {
            code: 'EEXIST',
          })
        }
        written.set(path, content)
      },
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    },
  }
}

describe('release:import-live-evidence', () => {
  it.each(LIVE_EVIDENCE_GATE_IDS)('normalizes a valid %s capture', (gate) => {
    const { deps, written } = harness({ 'raw.json': raw(gate) })

    expect(
      runImportLiveEvidenceCli(
        [`--gate=${gate}`, '--input=raw.json', '--output=artifact.json'],
        deps,
      ),
    ).toBe(0)
    expect(written.get('artifact.json')).toBe(FIXTURES[gate]?.content)
  })

  it.each(LIVE_EVIDENCE_GATE_IDS)(
    'never synthesizes a field absent from the raw %s input',
    (gate) => {
      const capture = JSON.parse(raw(gate)) as Record<string, unknown>
      for (const key of Object.keys(capture)) {
        if (key === 'version' || key === 'evidenceKind') continue
        const without = Object.fromEntries(
          Object.entries(capture).filter(([name]) => name !== key),
        )
        const { deps, written } = harness({
          'raw.json': `${JSON.stringify(without, null, 2)}\n`,
        })

        expect(
          runImportLiveEvidenceCli(
            [`--gate=${gate}`, '--input=raw.json', '--output=artifact.json'],
            deps,
          ),
        ).toBe(1)
        expect(written.size).toBe(0)
      }
    },
  )

  it('names the missing field rather than filling it in', () => {
    const capture = JSON.parse(raw('promotion.backup_pitr')) as Record<string, unknown>
    delete capture.expiresAt
    const { deps, errors } = harness({
      'raw.json': `${JSON.stringify(capture, null, 2)}\n`,
    })

    expect(
      runImportLiveEvidenceCli(
        ['--gate=promotion.backup_pitr', '--input=raw.json', '--output=artifact.json'],
        deps,
      ),
    ).toBe(1)
    expect(errors.join('\n')).toContain('expiresAt')
  })

  it('writes with flag wx and refuses to overwrite an existing artifact', () => {
    const { deps, errors, writeAttempts } = harness(
      { 'raw.json': raw('candidate.clean_ci') },
      ['artifact.json'],
    )

    expect(
      runImportLiveEvidenceCli(
        ['--gate=candidate.clean_ci', '--input=raw.json', '--output=artifact.json'],
        deps,
      ),
    ).toBe(1)
    expect(writeAttempts).toEqual(['artifact.json'])
    expect(errors.join('\n')).toContain('EEXIST')
  })

  it('refuses an unknown gate and an incomplete invocation', () => {
    const { deps, errors } = harness({})

    expect(runImportLiveEvidenceCli(['--gate=promotion.canary_window'], deps)).toBe(2)
    expect(
      runImportLiveEvidenceCli(
        ['--gate=nope', '--input=raw.json', '--output=out.json'],
        deps,
      ),
    ).toBe(2)
    expect(errors.join('\n')).toContain('unknown live-evidence gate nope')
  })

  it('lists exactly the gates it can import', () => {
    const { deps, logs } = harness({})

    expect(runImportLiveEvidenceCli(['--list'], deps)).toBe(0)
    expect(logs).toEqual([...LIVE_EVIDENCE_GATE_IDS])
  })

  it('refuses a capture that is not JSON at all', () => {
    const { deps, written } = harness({ 'raw.json': 'PASSED\n' })

    expect(
      runImportLiveEvidenceCli(
        ['--gate=candidate.clean_ci', '--input=raw.json', '--output=out.json'],
        deps,
      ),
    ).toBe(1)
    expect(written.size).toBe(0)
  })
})
