import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  GATE_F_APPROVAL_ROLES,
  createGateFApprovalVerifier,
  gateFApprovalSignaturePayload,
  GATE_F_APPROVAL_ENVELOPE_VERSION,
} from '../../src/shared/release/gate-f-approval-envelope'
import {
  completeGateFBundle,
  gateFApprovalKeyRing,
} from '../../src/shared/release/gate-f-complete-evidence.test-fixtures'
import {
  runPrepareGateFApprovalCli,
  type PrepareApprovalDependencies,
} from './prepare-gate-f-approval'

const ROOT = resolve(import.meta.dirname, '../..')
const SOURCE = readFileSync(
  resolve(ROOT, 'scripts/release/prepare-gate-f-approval.ts'),
  'utf8',
)

const BUNDLE = completeGateFBundle()

type Harness = Readonly<{
  deps: PrepareApprovalDependencies
  written: Map<string, string>
  logs: string[]
  errors: string[]
}>

function harness(files: Readonly<Record<string, string>> = {}): Harness {
  const written = new Map<string, string>()
  const logs: string[] = []
  const errors: string[] = []
  return {
    written,
    logs,
    errors,
    deps: {
      readFile: (path) => {
        const content =
          files[path] ?? (path === 'gate-f-index.json' ? BUNDLE.content : undefined)
        if (content === undefined) throw new Error(`no file at ${path}`)
        return content
      },
      writeFileExclusive: (path, content) => {
        if (written.has(path)) throw new Error(`EEXIST ${path}`)
        written.set(path, content)
      },
      log: (line) => logs.push(line),
      error: (line) => errors.push(line),
    },
  }
}

const ARGS = (role: string) => [
  '--gate-f-index=gate-f-index.json',
  `--role=${role}`,
  `--approver=${role}-approver`,
  '--approved-at=2026-08-28T11:00:00.000Z',
]

describe('release:prepare-approval', () => {
  it('never reads, writes, derives or generates a private key', () => {
    // The control is on the SOURCE, not on one execution path: the command
    // must have no way to touch key material at all.
    expect(SOURCE).not.toMatch(/PRIVATE KEY/u)
    expect(SOURCE).not.toMatch(/generateKeyPair/u)
    expect(SOURCE).not.toMatch(/createPrivateKey/u)
    expect(SOURCE).not.toMatch(/createSign\b/u)
    expect(SOURCE).not.toMatch(/\bsign\s*\(/u)
    expect(SOURCE).not.toMatch(/privateKey/u)
    expect(SOURCE).not.toMatch(/\.ssh|id_ed25519|\.pem\b/u)
  })

  it.each(GATE_F_APPROVAL_ROLES)('prints the exact payload %s must sign', (role) => {
    const { deps, logs, written } = harness()

    expect(runPrepareGateFApprovalCli(ARGS(role), deps)).toBe(0)
    expect(written.size).toBe(0)

    const printed = logs.find((line) => line.startsWith('{"approvedAt"'))
    expect(printed).toBeDefined()
    const expected = gateFApprovalSignaturePayload({
      role,
      approverIdentity: `${role}-approver`,
      approvedAt: '2026-08-28T11:00:00.000Z',
      releaseManifestSha256: BUNDLE.evidence.release.manifest.sha256,
      legalRevisionSetSha256: BUNDLE.evidence.release.legalRevisionSet.sha256,
      gateFDecisionSha256: BUNDLE.decisionSha256,
    }).toString('utf8')
    expect(printed).toBe(expected)
  })

  it('produces bytes that verify against the enrolled public key', () => {
    // End to end: the printed payload is exactly what the verifier checks, so
    // an approver who signs it out of band produces an acceptable envelope.
    const keyRing = gateFApprovalKeyRing()
    const verify = createGateFApprovalVerifier(keyRing.roleKeys)
    const { deps, logs } = harness()

    expect(runPrepareGateFApprovalCli(ARGS('counsel'), deps)).toBe(0)
    const printed = logs.find((line) => line.startsWith('{"approvedAt"'))
    const payload = Buffer.from(String(printed), 'utf8')
    const entry = keyRing.roleKeys.roles.counsel
    expect(entry.status).toBe('enrolled')
    if (entry.status !== 'enrolled') return

    expect(
      verify({
        version: GATE_F_APPROVAL_ENVELOPE_VERSION,
        evidenceKind: 'gate-f-approval',
        role: 'counsel',
        approverIdentity: 'counsel-approver',
        approvedAt: '2026-08-28T11:00:00.000Z',
        releaseManifestSha256: BUNDLE.evidence.release.manifest.sha256,
        legalRevisionSetSha256: BUNDLE.evidence.release.legalRevisionSet.sha256,
        gateFDecisionSha256: BUNDLE.decisionSha256,
        publicKeySha256: entry.publicKeySha256,
        signatureAlgorithm: 'ed25519',
        signature: keyRing.sign('counsel', payload),
      }),
    ).toEqual({ ok: true })
  })

  it('writes only the payload, and only when asked', () => {
    const { deps, written } = harness()

    expect(
      runPrepareGateFApprovalCli([...ARGS('security'), '--output=payload.bin'], deps),
    ).toBe(0)
    expect([...written.keys()]).toEqual(['payload.bin'])
    expect(written.get('payload.bin')).not.toMatch(/PRIVATE/u)
    expect(JSON.parse(String(written.get('payload.bin')))).toMatchObject({
      role: 'security',
    })
  })

  it('refuses an unknown role, a bad timestamp and an incomplete invocation', () => {
    const { deps, errors } = harness()

    expect(runPrepareGateFApprovalCli([], deps)).toBe(2)
    expect(runPrepareGateFApprovalCli(ARGS('engineering'), deps)).toBe(2)
    expect(
      runPrepareGateFApprovalCli(
        [
          '--gate-f-index=gate-f-index.json',
          '--role=counsel',
          '--approver=A. Counsel',
          '--approved-at=whenever',
        ],
        deps,
      ),
    ).toBe(2)
    expect(errors.join('\n')).toContain('unknown Gate F approval role engineering')
  })

  it('refuses to prepare an approval for an invalid Gate F index', () => {
    const { deps, errors } = harness({ 'gate-f-index.json': '{}\n' })

    expect(runPrepareGateFApprovalCli(ARGS('counsel'), deps)).toBe(1)
    expect(errors.join('\n')).toContain('is invalid')
  })
})
