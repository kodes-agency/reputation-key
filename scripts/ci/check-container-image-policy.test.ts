import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  loadContainerImagePolicy,
  validateCiContainerCoverage,
  validateContainerImagePolicy,
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

  it('rejects a classified image when any CI evidence stage is removed', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const withoutPerfScan = workflow.replace(
      /\n\s+- name: Vulnerability scan performance runner image \(grype\)[\s\S]*?(?=\n\s+- name:|\n\s{2}#)/u,
      '',
    )

    expect(validateCiContainerCoverage(policy, withoutPerfScan)).toContain(
      'CI vulnerability scans is missing repkey-perf-runner:ci',
    )
  })
})
