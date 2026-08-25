import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  PROMOTED_IMAGE_ROLES,
  canonicalPromotionManifest,
  parsePromotionManifest,
} from '../../src/shared/release/promotion-manifest'
import { createPromotionManifest } from './create-promotion-manifest'

const roots: string[] = []
const digest = (character: string): string => character.repeat(64)

function imageEvidenceRoot(sourceRevision: string): string {
  const root = mkdtempSync(join(tmpdir(), 'repkey-promotion-images-'))
  roots.push(root)
  mkdirSync(root, { recursive: true })
  for (const [index, role] of PROMOTED_IMAGE_ROLES.entries()) {
    writeFileSync(
      join(root, `${role}.json`),
      JSON.stringify({
        role,
        repository: `ghcr.io/repkey/reputation-key-${role.toLowerCase()}`,
        digest: `sha256:${String((index % 7) + 1).repeat(64)}`,
        sourceRevision,
        sbomSha256: digest('8'),
        provenanceSha256: digest('9'),
        signatureBundleSha256: digest('a'),
        vulnerabilityReportSha256: digest('b'),
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
    expect(parsePromotionManifest(canonicalPromotionManifest(manifest)).ok).toBe(true)
    expect(manifest.contract.iacSha256).toMatch(/^[0-9a-f]{64}$/)
    expect(manifest.contract.migrationHead).toMatch(/^\d{4}_/)
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
    ).toThrow('image source revision must equal release SHA')
  })
})
