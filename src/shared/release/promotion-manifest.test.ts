import { describe, expect, it } from 'vitest'
import {
  PROMOTED_IMAGE_ROLES,
  PROMOTED_IMAGE_REPOSITORIES,
  PROMOTION_MANIFEST_VERSION,
  canonicalPromotionManifest,
  parsePromotionManifest,
  promotedImageReference,
  promotionManifestSha256,
  sigstoreManifestVerificationArgs,
  TRUSTED_RELEASE_REPOSITORY,
  TRUSTED_RELEASE_WORKFLOW_IDENTITY,
  type PromotionManifest,
} from './promotion-manifest'
import {
  RELEASE_BUILDKIT_IMAGE,
  RELEASE_BUILDKIT_VERSION,
  RELEASE_BUILDX_VERSION,
  RELEASE_DOCKER_VERSION,
  RELEASE_RUNNER_ARCHITECTURE,
  RELEASE_RUNNER_IMAGE_OS,
  RELEASE_RUNNER_LABEL,
} from './release-build-toolchain'

const digest = (value: string): string => value.repeat(64).slice(0, 64)
const imageDigest = (value: string): `sha256:${string}` => `sha256:${digest(value)}`

function manifest(): PromotionManifest {
  const releaseSha = 'a'.repeat(40)
  return {
    version: PROMOTION_MANIFEST_VERSION,
    releaseSha,
    createdAt: '2026-08-25T08:00:00.000Z',
    source: { repository: TRUSTED_RELEASE_REPOSITORY, ref: 'refs/heads/main' },
    ci: {
      workflowIdentity: TRUSTED_RELEASE_WORKFLOW_IDENTITY,
      runId: '1234',
      runAttempt: 1,
    },
    build: {
      runnerLabel: RELEASE_RUNNER_LABEL,
      runnerImageOS: RELEASE_RUNNER_IMAGE_OS,
      runnerImageVersion: '20260824.1.0',
      runnerArchitecture: RELEASE_RUNNER_ARCHITECTURE,
      dockerVersion: RELEASE_DOCKER_VERSION,
      buildxVersion: RELEASE_BUILDX_VERSION,
      buildkitVersion: RELEASE_BUILDKIT_VERSION,
      buildkitImage: RELEASE_BUILDKIT_IMAGE,
      imageMetadataIndexSha256: digest('d'),
    },
    contract: {
      lockfileSha256: digest('1'),
      iacSha256: digest('2'),
      releaseControllerSha256: digest('c'),
      migrationHead: '0089_data-cell-assignment',
      capabilityPolicyVersion: 'beta-local-2',
      dataCellCataloguePolicyVersion: 3,
      betaEvidenceManifestSha256: digest('3'),
      testEvidenceSha256: digest('4'),
      providerApprovalEvidenceSha256: digest('5'),
      sbomIndexSha256: digest('6'),
      vulnerabilityIndexSha256: digest('7'),
    },
    cells: ['us'],
    images: Object.fromEntries(
      PROMOTED_IMAGE_ROLES.map((role, index) => [
        role,
        {
          repository: PROMOTED_IMAGE_REPOSITORIES[role],
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

  it('rejects the retired three-cell beta release shape', () => {
    const candidate = manifest() as unknown as Record<string, unknown>
    candidate.cells = ['us', 'europe', 'global']
    const parsed = parsePromotionManifest(`${JSON.stringify(candidate)}\n`)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('cells')
  })

  it('rejects a well-formed digest from a registry repository the workflow does not own', () => {
    const candidate = manifest()
    candidate.images.web.repository = 'ghcr.io/other-owner/repkey-web'
    const parsed = parsePromotionManifest(canonicalPromotionManifest(candidate))

    expect(parsed.ok).toBe(false)
    if (!parsed.ok) {
      expect(parsed.errors).toContain(
        'images.web.repository: image repository must be ghcr.io/kodes-agency/repkey-web',
      )
    }
  })

  it('rejects a manifest signed against an older allocation policy', () => {
    const candidate = manifest() as unknown as {
      contract: { dataCellCataloguePolicyVersion: number }
    }
    candidate.contract.dataCellCataloguePolicyVersion = 2
    const parsed = parsePromotionManifest(`${JSON.stringify(candidate)}\n`)

    expect(parsed.ok).toBe(false)
    if (!parsed.ok)
      expect(parsed.errors.join('\n')).toContain(
        'contract.dataCellCataloguePolicyVersion',
      )
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

  it('rejects a retry-to-green release workflow attempt', () => {
    const candidate = manifest() as unknown as { ci: { runAttempt: number } }
    candidate.ci.runAttempt = 2

    const parsed = parsePromotionManifest(`${JSON.stringify(candidate)}\n`)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('ci.runAttempt')
  })

  it('rejects a manifest that claims an unapproved release builder version', () => {
    const candidate = manifest() as unknown as {
      build: { buildxVersion: string }
    }
    candidate.build.buildxVersion = '0.33.0'

    const parsed = parsePromotionManifest(`${JSON.stringify(candidate)}\n`)
    expect(parsed.ok).toBe(false)
    if (!parsed.ok) expect(parsed.errors.join('\n')).toContain('build.buildxVersion')
  })

  it('rejects non-canonical JSON even when its values are valid', () => {
    const content = `${JSON.stringify(manifest(), null, 2)}\n`
    expect(parsePromotionManifest(content)).toEqual({
      ok: false,
      errors: ['promotion manifest must use canonical JSON encoding'],
    })
  })

  it('maps Railway services to digest-pinned registry references', () => {
    expect(promotedImageReference(manifest(), 'google-egress-gateway')).toBe(
      `${PROMOTED_IMAGE_REPOSITORIES.googleEgressGateway}@${imageDigest('5')}`,
    )
  })

  it('pins keyless verification to the producing workflow identity and issuer', () => {
    expect(
      sigstoreManifestVerificationArgs({
        manifestPath: '/release/manifest.json',
        bundlePath: '/release/manifest.sigstore.json',
      }),
    ).toEqual([
      'verify-blob',
      '--bundle',
      '/release/manifest.sigstore.json',
      '--certificate-identity',
      TRUSTED_RELEASE_WORKFLOW_IDENTITY,
      '--certificate-oidc-issuer',
      'https://token.actions.githubusercontent.com',
      '/release/manifest.json',
    ])
  })

  it('rejects a manifest that asks the deployer to trust another workflow', () => {
    const candidate = structuredClone(manifest()) as unknown as {
      ci: { workflowIdentity: string }
    }
    candidate.ci.workflowIdentity =
      'https://github.com/attacker/repository/.github/workflows/release-images.yml@refs/heads/main'
    expect(
      parsePromotionManifest(
        canonicalPromotionManifest(candidate as unknown as PromotionManifest),
      ),
    ).toMatchObject({ ok: false })
  })
})
