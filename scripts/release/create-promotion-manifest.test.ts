import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROMOTED_IMAGE_ROLES,
  PROMOTED_IMAGE_REPOSITORIES,
  canonicalPromotionManifest,
  parsePromotionManifest,
} from '../../src/shared/release/promotion-manifest'
import {
  RELEASE_BUILDKIT_IMAGE,
  RELEASE_BUILDKIT_VERSION,
  RELEASE_BUILDX_VERSION,
  RELEASE_DOCKER_VERSION,
  RELEASE_RUNNER_ARCHITECTURE,
  RELEASE_RUNNER_IMAGE_OS,
  RELEASE_RUNNER_LABEL,
} from '../../src/shared/release/release-build-toolchain'
import { createPromotionManifest } from './create-promotion-manifest'

const roots: string[] = []
const digest = (character: string): string => character.repeat(64)
const sha256 = (content: string): string =>
  createHash('sha256').update(content).digest('hex')

function imageEvidenceRoot(sourceRevision: string): string {
  const root = mkdtempSync(join(tmpdir(), 'repkey-promotion-images-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  for (const [index, role] of PROMOTED_IMAGE_ROLES.entries()) {
    const artifacts = {
      sbomSha256: `${role} sbom`,
      provenanceSha256: `${role} provenance`,
      signatureBundleSha256: `${role} signature`,
      vulnerabilityReportSha256: `${role} vulnerability report`,
    }
    writeFileSync(join(root, `${role}.spdx.json`), artifacts.sbomSha256)
    writeFileSync(join(root, `${role}.provenance.json`), artifacts.provenanceSha256)
    writeFileSync(join(root, `${role}.sigstore.json`), artifacts.signatureBundleSha256)
    writeFileSync(
      join(root, `${role}.vulnerability.sarif`),
      artifacts.vulnerabilityReportSha256,
    )
    writeFileSync(
      join(root, `${role}.json`),
      JSON.stringify({
        role,
        repository: PROMOTED_IMAGE_REPOSITORIES[role],
        digest: `sha256:${String((index % 7) + 1).repeat(64)}`,
        sourceRevision,
        sbomSha256: sha256(artifacts.sbomSha256),
        provenanceSha256: sha256(artifacts.provenanceSha256),
        signatureBundleSha256: sha256(artifacts.signatureBundleSha256),
        vulnerabilityReportSha256: sha256(artifacts.vulnerabilityReportSha256),
      }),
    )
    writeFileSync(
      join(root, `${role}.release-metadata.json`),
      JSON.stringify({
        version: 'repkey-image-provenance-2',
        role,
        sourceRevision,
        workflow:
          'kodes-agency/reputation-key/.github/workflows/release-images.yml@refs/heads/main',
        runId: '12345',
        runAttempt: 1,
        image: `${PROMOTED_IMAGE_REPOSITORIES[role]}@sha256:${String((index % 7) + 1).repeat(64)}`,
        toolchain: {
          runnerLabel: RELEASE_RUNNER_LABEL,
          runnerImageOS: RELEASE_RUNNER_IMAGE_OS,
          runnerImageVersion: '20260824.1.0',
          runnerArchitecture: RELEASE_RUNNER_ARCHITECTURE,
          dockerVersion: RELEASE_DOCKER_VERSION,
          buildxVersion: RELEASE_BUILDX_VERSION,
          buildkitVersion: RELEASE_BUILDKIT_VERSION,
          buildkitImage: RELEASE_BUILDKIT_IMAGE,
        },
      }),
    )
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('createPromotionManifest', () => {
  it('binds every image and repository contract into a canonical manifest', () => {
    const releaseSha = 'c'.repeat(40)
    const manifest = createPromotionManifest({
      imagesDir: imageEvidenceRoot(releaseSha),
      betaEvidenceManifestSha256: digest('1'),
      testEvidenceSha256: digest('2'),
      providerApprovalEvidenceSha256: digest('3'),
      releaseSha,
      repository: 'kodes-agency/reputation-key',
      workflowIdentity:
        'https://github.com/kodes-agency/reputation-key/.github/workflows/release-images.yml@refs/heads/main',
      runId: '12345',
      runAttempt: 1,
      createdAt: '2026-08-25T08:00:00.000Z',
    })

    expect(Object.keys(manifest.images)).toEqual(PROMOTED_IMAGE_ROLES)
    expect(manifest.cells).toEqual(['us'])
    expect(parsePromotionManifest(canonicalPromotionManifest(manifest)).ok).toBe(true)
    expect(manifest.contract.iacSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.contract.releaseControllerSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.contract.migrationHead).toMatch(/^\d{4}_/)
    expect(manifest.build).toMatchObject({
      runnerLabel: RELEASE_RUNNER_LABEL,
      runnerImageVersion: '20260824.1.0',
      dockerVersion: RELEASE_DOCKER_VERSION,
      buildxVersion: RELEASE_BUILDX_VERSION,
      buildkitImage: RELEASE_BUILDKIT_IMAGE,
    })
  })

  it('rejects incomplete or wrong-revision image evidence', () => {
    const releaseSha = 'c'.repeat(40)
    const imagesDir = imageEvidenceRoot('d'.repeat(40))

    expect(() =>
      createPromotionManifest({
        imagesDir,
        betaEvidenceManifestSha256: digest('1'),
        testEvidenceSha256: digest('2'),
        providerApprovalEvidenceSha256: digest('3'),
        releaseSha,
        repository: 'kodes-agency/reputation-key',
        workflowIdentity:
          'https://github.com/kodes-agency/reputation-key/.github/workflows/release-images.yml@refs/heads/main',
        runId: '12345',
        runAttempt: 1,
        createdAt: '2026-08-25T08:00:00.000Z',
      }),
    ).toThrow('image build metadata web sourceRevision mismatch')
  })

  it('rejects a missing or changed image evidence artifact before signing', () => {
    const releaseSha = 'c'.repeat(40)
    const imagesDir = imageEvidenceRoot(releaseSha)
    writeFileSync(join(imagesDir, 'web.spdx.json'), 'changed after indexing')

    expect(() =>
      createPromotionManifest({
        imagesDir,
        betaEvidenceManifestSha256: digest('1'),
        testEvidenceSha256: digest('2'),
        providerApprovalEvidenceSha256: digest('3'),
        releaseSha,
        repository: 'kodes-agency/reputation-key',
        workflowIdentity:
          'https://github.com/kodes-agency/reputation-key/.github/workflows/release-images.yml@refs/heads/main',
        runId: '12345',
        runAttempt: 1,
        createdAt: '2026-08-25T08:00:00.000Z',
      }),
    ).toThrow('image evidence web sbomSha256 does not match web.spdx.json')
  })

  it('rejects a release matrix split across mutable runner image revisions', () => {
    const releaseSha = 'c'.repeat(40)
    const imagesDir = imageEvidenceRoot(releaseSha)
    const path = join(imagesDir, 'worker.release-metadata.json')
    const metadata = JSON.parse(readFileSync(path, 'utf8')) as {
      toolchain: { runnerImageVersion: string }
    }
    metadata.toolchain.runnerImageVersion = '20260825.1.0'
    writeFileSync(path, JSON.stringify(metadata))

    expect(() =>
      createPromotionManifest({
        imagesDir,
        betaEvidenceManifestSha256: digest('1'),
        testEvidenceSha256: digest('2'),
        providerApprovalEvidenceSha256: digest('3'),
        releaseSha,
        repository: 'kodes-agency/reputation-key',
        workflowIdentity:
          'https://github.com/kodes-agency/reputation-key/.github/workflows/release-images.yml@refs/heads/main',
        runId: '12345',
        runAttempt: 1,
        createdAt: '2026-08-25T08:00:00.000Z',
      }),
    ).toThrow('image build metadata worker toolchain mismatch')
  })
})
