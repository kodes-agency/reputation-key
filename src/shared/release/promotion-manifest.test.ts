import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { deployPlan } from '../../../scripts/release/deploy-beta'
import {
  PROMOTED_IMAGE_ROLES,
  PROMOTION_MANIFEST_VERSION,
  canonicalPromotionManifest,
  parsePromotionManifest,
  promotedImageReference,
  promotionManifestSha256,
  sigstoreManifestVerificationArgs,
  type PromotionManifest,
} from './promotion-manifest'

const digest = (value: string): string => value.repeat(64).slice(0, 64)
const imageDigest = (value: string): `sha256:${string}` => `sha256:${digest(value)}`

function manifest(): PromotionManifest {
  const releaseSha = 'a'.repeat(40)
  return {
    version: PROMOTION_MANIFEST_VERSION,
    releaseSha,
    createdAt: '2026-08-25T08:00:00.000Z',
    source: { repository: 'repkey/reputation-key', ref: 'refs/heads/main' },
    ci: {
      workflowIdentity:
        'https://github.com/repkey/reputation-key/.github/workflows/release-images.yml@refs/heads/main',
      runId: '1234',
      runAttempt: 1,
    },
    contract: {
      lockfileSha256: digest('1'),
      iacSha256: digest('2'),
      migrationHead: '0089_data-cell-assignment',
      capabilityPolicyVersion: 'beta-local-2',
      dataCellCataloguePolicyVersion: 2,
      betaEvidenceManifestSha256: digest('3'),
      testEvidenceSha256: digest('4'),
      providerApprovalEvidenceSha256: digest('5'),
      sbomIndexSha256: digest('6'),
      vulnerabilityIndexSha256: digest('7'),
    },
    cells: ['us', 'europe', 'global'],
    images: Object.fromEntries(
      PROMOTED_IMAGE_ROLES.map((role, index) => [
        role,
        {
          repository: `ghcr.io/repkey/reputation-key-${role.toLowerCase()}`,
          digest: imageDigest(String((index % 8) + 1)),
          sourceRevision: releaseSha,
          sbomSha256: digest('8'),
          provenanceSha256: digest('9'),
          signatureBundleSha256: digest('a'),
          vulnerabilityReportSha256: digest('b'),
        },
      ]),
    ) as PromotionManifest['images'],
  }
}

describe('promotion manifest', () => {
  it('accepts only canonical manifests and derives their immutable digest', () => {
    const content = canonicalPromotionManifest(manifest())
    const parsed = parsePromotionManifest(content)

    expect(parsed).toMatchObject({
      ok: true,
      digest: promotionManifestSha256(content),
    })
  })

  it('rejects a mixed-revision image set', () => {
    const candidate = manifest()
    const content = canonicalPromotionManifest({
      ...candidate,
      images: {
        ...candidate.images,
        worker: { ...candidate.images.worker, sourceRevision: 'c'.repeat(40) },
      },
    })

    const parsed = parsePromotionManifest(content)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok)
      expect(parsed.errors.join('\n')).toContain('images.worker.sourceRevision')
  })

  it('rejects non-canonical JSON even when its values are valid', () => {
    const content = `${JSON.stringify(manifest(), null, 2)}\n`
    expect(parsePromotionManifest(content)).toEqual({
      ok: false,
      errors: ['promotion manifest must use canonical JSON encoding'],
    })
  })

  it('maps Railway services to digest-pinned registry references', () => {
    expect(promotedImageReference(manifest(), 'google-egress-gateway')).toMatch(
      /^ghcr\.io\/repkey\/reputation-key-googleegressgateway@sha256:[0-9a-f]{64}$/,
    )
  })

  it('builds one exact-image plan for all six Railway runtime services', () => {
    const candidate = manifest()
    const manifestDigest = digest('c')
    const plan = deployPlan(candidate, manifestDigest)

    expect(plan.map((entry) => entry.service)).toEqual([
      'web',
      'worker',
      'google-execution-admission',
      'google-egress-gateway',
      'ai-execution-admission',
      'ai-egress-gateway',
    ])
    expect(plan).toHaveLength(6)
    for (const entry of plan) {
      expect(entry.imageReference.endsWith(`@${entry.imageDigest}`)).toBe(true)
      expect(entry.variables).toEqual([
        `RELEASE_SHA=${candidate.releaseSha}`,
        `RELEASE_MANIFEST_SHA256=${manifestDigest}`,
      ])
    }
  })

  it('retired working-tree uploads from the promotion command', () => {
    const source = readFileSync(
      resolve(process.cwd(), 'scripts/release/deploy-beta.ts'),
      'utf8',
    )
    expect(source).not.toMatch(/railway(?:\(\[|\s+)['"]?up\b/u)
    expect(source).toContain("'source',\n    'connect'")
  })

  it('pins keyless verification to the producing workflow identity and issuer', () => {
    expect(
      sigstoreManifestVerificationArgs({
        manifestPath: '/release/manifest.json',
        bundlePath: '/release/manifest.sigstore.json',
        workflowIdentity: manifest().ci.workflowIdentity,
      }),
    ).toEqual([
      'verify-blob',
      '--bundle',
      '/release/manifest.sigstore.json',
      '--certificate-identity',
      manifest().ci.workflowIdentity,
      '--certificate-oidc-issuer',
      'https://token.actions.githubusercontent.com',
      '/release/manifest.json',
    ])
  })
})
