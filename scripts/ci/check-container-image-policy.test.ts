import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadContainerImagePolicy,
  validateCiContainerCoverage,
  validateContainerImagePolicy,
  validateDockerfileContextAllowlist,
  validateDockerfileInventory,
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
      /\n\s+- name: Vulnerability scan grouped images \(grype\)[\s\S]*?(?=\n\s+- name:|\n\s{2}#)/u,
      '',
    )

    expect(validateCiContainerCoverage(policy, withoutMatrixScan)).toContain(
      'CI vulnerability scans is missing repkey-perf-runner:ci',
    )
  })

  it('rejects a classified image missing from a bounded evidence group', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const withoutPerfRow = workflow.replace(
      ',{"name":"perf-runner","dockerfile":"Dockerfile.perf-runner","tag":"repkey-perf-runner:ci","publish":false}',
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

  it('rejects a group with more than four image contracts', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const overflowed = workflow.replace(
      '{"name":"ai-egress-gateway","dockerfile":"Dockerfile.ai-egress-gateway","tag":"repkey-ai-egress-gateway:ci","publish":true}]',
      '{"name":"ai-egress-gateway","dockerfile":"Dockerfile.ai-egress-gateway","tag":"repkey-ai-egress-gateway:ci","publish":true},{"name":"overflow","dockerfile":"Dockerfile","tag":"overflow:ci","publish":false}]',
    )

    expect(validateCiContainerCoverage(policy, overflowed)).toContain(
      'CI image group sidecars must contain 1-4 images, found 5',
    )
  })

  it('pins the seven continuous runtimes versus non-published CI descriptors', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const webMadeCiOnly = workflow.replace(
      '{"name":"web","dockerfile":"Dockerfile","tag":"repkey-web:ci","publish":true}',
      '{"name":"web","dockerfile":"Dockerfile","tag":"repkey-web:ci","publish":false}',
    )

    expect(validateCiContainerCoverage(policy, webMadeCiOnly)).toContain(
      'CI image publish bindings is missing web=>true',
    )
  })

  it('requires a cross-group success barrier before immutable SHA promotion', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const withoutBarrier = workflow.replace(
      "        if: needs.docker-images.result != 'success'\n",
      '',
    )

    expect(validateCiContainerCoverage(policy, withoutBarrier)).toContain(
      'CI must promote the exact complete staged image set before writing its digest map',
    )
  })

  it('requires an isolated read/write Buildx cache for every grouped image', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const withoutCacheExport = workflow.replace(
      '              --cache-to "type=gha,mode=max,scope=ci-image-${name}" \\\n',
      '',
    )

    expect(validateCiContainerCoverage(policy, withoutCacheExport)).toContain(
      'CI image builds is missing Dockerfile=>repkey-web:ci',
    )
  })

  it('merges every CI-built SBOM into the governed image artifact', () => {
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const aggregate = workflow.slice(workflow.indexOf('\n  docker:'))

    expect(workflow).toContain('name: sbom-image-group-${{ matrix.group }}-spdx')
    expect(aggregate).toContain('pattern: sbom-image-group-*-spdx')
    expect(aggregate).toContain('merge-multiple: true')
    expect(aggregate).toContain('name: sbom-images-spdx')
    expect(aggregate).toContain(
      `run: test "$(find image-sboms -maxdepth 1 -type f -name 'sbom-*.spdx.json' | wc -l)" -eq 9`,
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
})
