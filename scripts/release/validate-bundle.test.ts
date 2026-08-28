import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ReleaseCandidateBinding } from '../../src/shared/release/candidate-bound-evidence'
import {
  GATE_F_EVIDENCE_VERSION,
  GATE_F_REQUIRED_GATE_IDS,
  canonicalGateFEvidence,
  gateFEvidenceSha256,
  type GateFEvidence,
  type GateFEvidenceReference,
} from '../../src/shared/release/gate-f-evidence'
import { canonicalLegalRevisionSetEvidence } from '../../src/shared/release/legal-revision-set-evidence'
import {
  legalRevisionSetContextFixture,
  legalRevisionSetFixture,
  LEGAL_FIXTURE_CAPTURED_AT,
} from '../../src/shared/release/legal-revision-set-evidence.test-fixtures'
import { PRODUCTION_RAILWAY_PROJECT_NAME } from '../../src/shared/release/railway-deployment-profile'
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

  it('fails a Gate F bundle whose legal revision set lists a draft document', () => {
    // LEG-01: the CLI surface, not just the library, must fail closed. Before
    // this, `release.legalRevisionSet` accepted any bytes, so a reviewer
    // running this command over a bundle whose legal set still contained a
    // candidate draft was told the bundle was valid.
    const root = mkdtempSync(join(tmpdir(), 'repkey-gate-f-legal-'))
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const add = (name: string, content: string): GateFEvidenceReference => {
        const target = join(root, name)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, content)
        return {
          path: name,
          sha256: gateFEvidenceSha256(content),
          capturedAt: LEGAL_FIXTURE_CAPTURED_AT,
        }
      }

      const manifest = add('release/promotion-manifest.json', 'placeholder manifest\n')
      const candidate: ReleaseCandidateBinding = {
        releaseSha: 'a'.repeat(40),
        releaseManifestSha256: manifest.sha256,
        cell: 'us',
        environment: 'cell-us',
        deploymentProfile: 'production',
        projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
        projectId: 'railway-project-us-production',
        environmentId: 'railway-environment-cell-us',
        appOrigin: 'https://us.reputationkey.app',
      }
      const base = legalRevisionSetFixture(candidate, legalRevisionSetContextFixture())
      const legalRevisionSet = add(
        'legal/revision-set.json',
        canonicalLegalRevisionSetEvidence({
          ...base,
          documents: base.documents.map((document) =>
            document.id === 'privacy-notice'
              ? { ...document, status: 'draft' as const }
              : document,
          ),
        }),
      )
      const approval = (role: string) => ({
        approverIdentity: `${role}-approver`,
        approvedAt: '2026-08-28T11:00:00.000Z',
        releaseManifestSha256: manifest.sha256,
        evidence: add(`approvals/${role}.json`, `${role} approval\n`),
      })
      const index: GateFEvidence = {
        version: GATE_F_EVIDENCE_VERSION,
        release: {
          manifest,
          signatureBundle: add('release/promotion-manifest.sigstore.json', 'bundle\n'),
          legalRevisionSet,
          releaseSha: candidate.releaseSha,
          cell: 'us',
          environment: 'cell-us',
          deploymentProfile: 'production',
          projectName: PRODUCTION_RAILWAY_PROJECT_NAME,
          projectId: candidate.projectId,
          environmentId: candidate.environmentId,
          appOrigin: 'https://us.reputationkey.app',
        },
        gates: GATE_F_REQUIRED_GATE_IDS.map((id) => ({
          id,
          status: 'passed',
          evidence: [add(`gates/${id}.json`, `${id} passed\n`)],
        })),
        findings: {
          protectedReachableHighCount: 0,
          register: add('findings/register.json', 'no protected reachable High\n'),
        },
        approvals: [
          {
            role: 'counsel',
            ...approval('counsel'),
            legalRevisionSetSha256: legalRevisionSet.sha256,
          },
          {
            role: 'founder',
            ...approval('founder'),
            legalRevisionSetSha256: legalRevisionSet.sha256,
          },
          { role: 'operations', ...approval('operations') },
          { role: 'product', ...approval('product') },
          { role: 'security', ...approval('security') },
          { role: 'support_incident', ...approval('support_incident') },
        ],
        firstCohort: {
          kind: 'design_partner',
          cohortReferenceSha256: 'd'.repeat(64),
          supportOwner: 'support-owner',
          incidentOwner: 'incident-owner',
          changeRecord: 'CHG-REL-01-001',
          evidence: add('cohort/readiness.json', 'bounded cohort ready\n'),
        },
        completedAt: '2026-08-28T12:00:00.000Z',
      }
      const indexPath = join(root, 'gate-f-index.json')
      writeFileSync(indexPath, canonicalGateFEvidence(index))

      expect(runReleaseValidationCli([`--gate-f-index=${indexPath}`])).toBe(1)
      expect(stderr.mock.calls.flat().join('\n')).toContain(
        'release.legalRevisionSet: document privacy-notice is a draft and cannot appear in a release legal revision set',
      )
    } finally {
      stderr.mockRestore()
      rmSync(root, { recursive: true, force: true })
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
