import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { validateCiImagePipeline } from './check-image-pipeline-policy'
import {
  dockerfileSecretMountIds,
  loadContainerImagePolicy,
  validateBuildSecretMounts,
  validateCiContainerCoverage,
  validateContainerImagePolicy,
  validateDockerfileBuildArguments,
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
      'CI vulnerability scans is missing repkey-provider-sandbox:ci',
    )
  })

  it('rejects a classified image missing from a bounded evidence group', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const withoutSandboxRow = workflow.replace(
      ',{"name":"provider-sandbox","dockerfile":"Dockerfile.sandbox","tag":"repkey-provider-sandbox:ci","publish":false}',
      '',
    )
    const violations = validateCiContainerCoverage(policy, withoutSandboxRow)

    expect(violations).toContain(
      'CI image builds is missing Dockerfile.sandbox=>repkey-provider-sandbox:ci',
    )
    expect(violations).toContain('CI image SBOMs is missing repkey-provider-sandbox:ci')
    expect(violations).toContain(
      'CI vulnerability scans is missing repkey-provider-sandbox:ci',
    )
  })

  it('rejects a group with more than four image contracts', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const overflowed = workflow.replace(
      '{"name":"provider-sandbox","dockerfile":"Dockerfile.sandbox","tag":"repkey-provider-sandbox:ci","publish":false}]',
      '{"name":"provider-sandbox","dockerfile":"Dockerfile.sandbox","tag":"repkey-provider-sandbox:ci","publish":false},{"name":"overflow-1","dockerfile":"Dockerfile","tag":"overflow-1:ci","publish":false},{"name":"overflow-2","dockerfile":"Dockerfile","tag":"overflow-2:ci","publish":false},{"name":"overflow-3","dockerfile":"Dockerfile","tag":"overflow-3:ci","publish":false}]',
    )

    expect(validateCiContainerCoverage(policy, overflowed)).toContain(
      'CI image group worker-tools must contain 1-4 images, found 5',
    )
  })

  it('pins the three production runtimes versus one CI-only descriptor', () => {
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
      `run: test "$(find image-sboms -maxdepth 1 -type f -name 'sbom-*.spdx.json' | wc -l)" -eq 4`,
    )
  })

  it('mounts the source-map upload token as a build secret, never as a build argument', () => {
    const dockerfile = readFileSync(resolve(ROOT, 'Dockerfile'), 'utf8')
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')

    expect(dockerfileSecretMountIds(dockerfile)).toContain('sentry_auth_token')
    expect(workflow).toContain('--secret "id=sentry_auth_token,env=SENTRY_AUTH_TOKEN"')
    expect(workflow).not.toContain('--build-arg "SENTRY_AUTH_TOKEN=')
    expect(validateDockerfileBuildArguments('Dockerfile', dockerfile)).toEqual([])
  })

  it('rejects a secret-shaped build argument in a Dockerfile', () => {
    expect(
      validateDockerfileBuildArguments(
        'Dockerfile',
        'FROM scratch\nARG SENTRY_AUTH_TOKEN\nARG SOURCE_REVISION\n',
      ),
    ).toEqual([
      'Dockerfile declares secret-shaped build argument SENTRY_AUTH_TOKEN; mount it with --mount=type=secret instead',
    ])
  })

  it('rejects a secret-shaped build argument passed by CI', () => {
    const policy = loadContainerImagePolicy(ROOT)
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
    const withTokenArgument = workflow.replace(
      '                --build-arg "SENTRY_ORG=$SENTRY_ORG"',
      '                --build-arg "SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN"\n                --build-arg "SENTRY_ORG=$SENTRY_ORG"',
    )

    expect(validateCiContainerCoverage(policy, withTokenArgument)).toContain(
      'CI passes secret-shaped build argument SENTRY_AUTH_TOKEN; deliver it with --secret id=… instead',
    )
  })

  it('rejects a build secret that no classified Dockerfile mounts', () => {
    const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')

    expect(validateBuildSecretMounts(['sentry_upload_token'], workflow)).toContain(
      'CI passes build secret sentry_auth_token, which no classified Dockerfile mounts',
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

describe('replacement image pipeline policy', () => {
  const policy = loadContainerImagePolicy(ROOT)
  const workflow = readFileSync(resolve(ROOT, '.github/workflows/ci.yml'), 'utf8')
  // The image groups above the pipeline share some of its lines, and a string
  // replace edits the first match: edit only the jobs from `image-build` on.
  const editPipeline = (edit: (jobs: string) => string): string => {
    const start = workflow.indexOf('\n  image-build:\n')
    return workflow.slice(0, start) + edit(workflow.slice(start))
  }

  it('builds, smokes, inventories, scans and stages every classified image', () => {
    expect(validateCiImagePipeline(policy, workflow)).toEqual([])
  })

  it('rejects a workflow without the three image jobs', () => {
    expect(validateCiImagePipeline(policy, 'jobs:\n  check:\n    steps: []\n')).toEqual([
      'CI has no image-build, image-scan and image jobs',
    ])
  })

  it('rejects the pipeline when its vulnerability scan is removed', () => {
    const withoutScan = workflow.replace(
      /\n\s+- name: Vulnerability scan images \(grype\)[\s\S]*?(?=\n\s+- name:|\n\s{2}#)/u,
      '',
    )

    expect(validateCiImagePipeline(policy, withoutScan)).toContain(
      'CI image pipeline scans is missing repkey-provider-sandbox:ci',
    )
  })

  it('rejects a classified image missing from the build rows', () => {
    const withoutSandboxRow = workflow.replace(
      ',{"name":"provider-sandbox","dockerfile":"Dockerfile.sandbox","tags":["repkey-provider-sandbox:ci"]}',
      '',
    )

    expect(validateCiImagePipeline(policy, withoutSandboxRow)).toContain(
      'CI image pipeline builds is missing Dockerfile.sandbox=>repkey-provider-sandbox:ci',
    )
  })

  it('rejects a classified image missing from the scan list', () => {
    const withoutWorker = workflow.replace(
      '{"name":"worker","tag":"repkey-worker:ci","publish":true},',
      '',
    )
    const violations = validateCiImagePipeline(policy, withoutWorker)

    expect(violations).toContain(
      'CI image pipeline bindings is missing worker=>repkey-worker:ci',
    )
    expect(violations).toContain('CI image pipeline SBOMs is missing repkey-worker:ci')
    expect(violations).toContain('CI image pipeline scans is missing repkey-worker:ci')
  })

  it('pins the three production runtimes versus one CI-only descriptor', () => {
    const webMadeCiOnly = workflow.replace(
      '{"name":"web","tag":"repkey-web:ci","publish":true}',
      '{"name":"web","tag":"repkey-web:ci","publish":false}',
    )

    expect(validateCiImagePipeline(policy, webMadeCiOnly)).toContain(
      'CI image pipeline publish bindings is missing web=>true',
    )
  })

  it('keys the Grype database cache on the database build, not the day', () => {
    const keyedOnDate = workflow.replace(
      'key: grype-db-v0.116.1-${{ steps.grype-db.outputs.built }}',
      'key: grype-db-v0.116.1-${{ steps.grype-db-date.outputs.utc }}',
    )

    expect(validateCiImagePipeline(policy, keyedOnDate)).toContain(
      'CI image pipeline scans is missing repkey-web:ci',
    )
  })

  it('rejects staging that a main push or a pull request could reach', () => {
    const unguarded = workflow.replace(
      "      - name: Stage scanned images\n        if: github.event_name == 'workflow_dispatch'\n",
      '      - name: Stage scanned images\n',
    )

    expect(validateCiImagePipeline(policy, unguarded)).toContain(
      'CI image pipeline must stage scanned images under unique run tags',
    )
  })

  it('rejects a digest map written without reading the registry back', () => {
    const withoutReadBack = editPipeline((jobs) =>
      jobs.replace('            test "$staged_digest" = "$expected_digest"\n', ''),
    )

    expect(validateCiImagePipeline(policy, withoutReadBack)).toContain(
      'CI image pipeline must read back the staged image set before writing its digest map',
    )
  })

  it('rejects an image job barrier that no longer gates the map', () => {
    const withoutBarrier = workflow.replace(
      "        if: needs.image-build.result != 'success' || needs.image-scan.result != 'success'\n",
      '',
    )

    expect(validateCiImagePipeline(policy, withoutBarrier)).toContain(
      'CI image pipeline must read back the staged image set before writing its digest map',
    )
  })

  it('rejects a secret-shaped build argument in the single build', () => {
    const withTokenArgument = editPipeline((jobs) =>
      jobs.replace(
        '                --build-arg "SENTRY_ORG=$SENTRY_ORG"',
        '                --build-arg "SENTRY_AUTH_TOKEN=$SENTRY_AUTH_TOKEN"\n                --build-arg "SENTRY_ORG=$SENTRY_ORG"',
      ),
    )

    expect(validateCiImagePipeline(policy, withTokenArgument)).toContain(
      'CI passes secret-shaped build argument SENTRY_AUTH_TOKEN; deliver it with --secret id=… instead',
    )
  })

  it('checks the secrets the single build passes against the Dockerfile mounts', () => {
    expect(
      validateBuildSecretMounts(['sentry_upload_token'], workflow).filter((violation) =>
        violation.includes('sentry_auth_token'),
      ),
    ).toHaveLength(1)
  })
})
