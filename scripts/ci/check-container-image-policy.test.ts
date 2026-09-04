import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadContainerImagePolicy,
  validateCiContainerCoverage,
  validateContainerImagePolicy,
  validateDockerfileContextAllowlist,
  validateDockerfileInventory,
  validateReleaseEvidenceBinding,
} from './check-container-image-policy'

const ROOT = resolve(import.meta.dirname, '../..')

describe('container image policy', () => {
  it('governs every Dockerfile through build, smoke, SBOM, scan, and promotion policy', () => {
    expect(validateContainerImagePolicy(ROOT)).toEqual([])
  })

  it('rejects a newly added Dockerfile until it is explicitly classified', () => {
    const policy = loadContainerImagePolicy(ROOT)
    expect(
      validateDockerfileInventory(policy, [
        ...policy.images.map(({ dockerfile }) => dockerfile),
        'tools/Dockerfile',
      ]),
    ).toContain('tools/Dockerfile is not classified')
  })

  it('rejects the matrix when its shared scan stage is removed', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const withoutMatrixScan = workflow.replace(
      /\n\s+- name: Vulnerability scan matrix image \(grype\)[\s\S]*?(?=\n\s+- name:|\n\s{2}#)/u,
      '',
    )

    expect(validateCiContainerCoverage(policy, withoutMatrixScan)).toContain(
      'CI vulnerability scans is missing repkey-perf-runner:ci',
    )
  })

  it('rejects a classified image missing from the evidence matrix', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const withoutPerfRow = workflow.replace(
      /\n\s{10}- name: perf-runner\n\s{12}dockerfile: Dockerfile\.perf-runner\n\s{12}tag: repkey-perf-runner:ci/u,
      '',
    )
    const violations = validateCiContainerCoverage(policy, withoutPerfRow)

    expect(violations).toContain(
      'CI image builds is missing Dockerfile.perf-runner=>repkey-perf-runner:ci',
    )
    expect(violations).toContain('CI image SBOMs is missing repkey-perf-runner:ci')
    expect(violations).toContain(
      'CI vulnerability scans is missing repkey-perf-runner:ci',
    )
  })

  it('merges the ten staged SBOMs into the governed image artifact', () => {
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const aggregate = workflow.slice(workflow.indexOf('\n  docker:'))

    expect(workflow).toContain('name: sbom-image-${{ matrix.image.name }}-spdx')
    expect(aggregate).toContain('pattern: sbom-image-*-spdx')
    expect(aggregate).toContain('merge-multiple: true')
    expect(aggregate).toContain('name: sbom-images-spdx')
    expect(aggregate).toContain(
      `run: test "$(find image-sboms -maxdepth 1 -type f -name 'sbom-*.spdx.json' | wc -l)" -eq 10`,
    )
  })

  it('rejects a Dockerfile-specific allowlist that excludes a copied source', () => {
    const ignorePath = resolve(ROOT, 'Dockerfile.sandbox.dockerignore')
    const original = readFileSync(ignorePath, 'utf8')
    const withoutAiFixture = original.replace('!e2e/fixtures/ai-provider-stub.ts\n', '')

    expect(
      validateDockerfileContextAllowlist(
        'Dockerfile.sandbox',
        readFileSync(resolve(ROOT, 'Dockerfile.sandbox'), 'utf8'),
        withoutAiFixture,
      ),
    ).toContain(
      'Dockerfile.sandbox.dockerignore excludes COPY source e2e/fixtures/ai-provider-stub.ts',
    )
  })

  it('rejects release signing that does not bind beta evidence to the selected CI run', () => {
    const workflow = readFileSync(
      resolve(ROOT, '.github/workflows/release-images.yml'),
      'utf8',
    )
    expect(validateReleaseEvidenceBinding(workflow)).toEqual([])

    expect(
      validateReleaseEvidenceBinding(
        workflow.replace('select(.name == $name and .expired == false)', 'true'),
      ),
    ).toContain(
      'release CI evidence binding is missing select(.name == $name and .expired == false)',
    )

    expect(
      validateReleaseEvidenceBinding(
        workflow.replace(
          '(cd "$manifest_dir" && sha256sum --check manifest.sha256)',
          'true',
        ),
      ),
    ).toContain(
      'release CI evidence binding is missing (cd "$manifest_dir" && sha256sum --check manifest.sha256)',
    )

    expect(
      validateReleaseEvidenceBinding(
        workflow.replace(
          'RELEASE_BUILDX_VERSION: 0.32.1',
          'RELEASE_BUILDX_VERSION: latest',
        ),
      ),
    ).toContain('release CI evidence binding is missing RELEASE_BUILDX_VERSION: 0.32.1')
  })
})
