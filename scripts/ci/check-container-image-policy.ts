import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const CONTAINER_IMAGE_CLASSIFICATIONS = [
  'production-runtime',
  'production-rollout-tool',
  'acceptance-test-support',
  'acceptance-operator-tool',
] as const

type ContainerImageClassification = (typeof CONTAINER_IMAGE_CLASSIFICATIONS)[number]

export type ContainerImagePolicyRow = Readonly<{
  id: string
  dockerfile: string
  ciImage: string
  classification: ContainerImageClassification
  promotion: 'release-candidate' | 'ci-only'
  releaseRole?: string
  purpose: string
}>

export type ContainerImagePolicy = Readonly<{
  version: 1
  images: readonly ContainerImagePolicyRow[]
}>

const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.output',
  'coverage',
  'node_modules',
  'storybook-static',
  'test-results',
])

function isIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRECTORIES.has(name) || name === 'dist' || name.startsWith('dist-')
}

function isDockerfile(name: string): boolean {
  if (name.endsWith('.dockerignore')) return false
  return (
    name === 'Dockerfile' ||
    name.startsWith('Dockerfile.') ||
    name.endsWith('.dockerfile')
  )
}

export function discoverDockerfiles(root: string): readonly string[] {
  const discovered: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!isIgnoredDirectory(entry.name)) walk(join(directory, entry.name))
        continue
      }
      if (!entry.isFile() || !isDockerfile(entry.name)) continue
      discovered.push(relative(root, join(directory, entry.name)).split('\\').join('/'))
    }
  }
  walk(root)
  return discovered.sort()
}

function objectRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

export function parseContainerImagePolicy(value: unknown): ContainerImagePolicy {
  const root = objectRecord(value, 'container image policy')
  if (root.version !== 1) throw new Error('container image policy version must be 1')
  if (!Array.isArray(root.images))
    throw new Error('container image policy images must be an array')

  const images = root.images.map((candidate, index): ContainerImagePolicyRow => {
    const row = objectRecord(candidate, `container image policy row ${index}`)
    for (const field of [
      'id',
      'dockerfile',
      'ciImage',
      'classification',
      'promotion',
      'purpose',
    ]) {
      if (typeof row[field] !== 'string' || row[field].trim() === '') {
        throw new Error(`container image policy row ${index} requires ${field}`)
      }
    }
    if (
      !CONTAINER_IMAGE_CLASSIFICATIONS.includes(
        row.classification as ContainerImageClassification,
      )
    ) {
      throw new Error(`container image policy row ${index} has unknown classification`)
    }
    if (row.promotion !== 'release-candidate' && row.promotion !== 'ci-only') {
      throw new Error(`container image policy row ${index} has unknown promotion posture`)
    }
    if (row.promotion === 'release-candidate') {
      if (typeof row.releaseRole !== 'string' || row.releaseRole.trim() === '') {
        throw new Error(`release-candidate row ${index} requires releaseRole`)
      }
    } else if (row.releaseRole !== undefined) {
      throw new Error(`ci-only row ${index} must not declare releaseRole`)
    }

    return row as unknown as ContainerImagePolicyRow
  })

  for (const field of ['id', 'dockerfile', 'ciImage', 'releaseRole'] as const) {
    const values = images
      .map((row) => row[field])
      .filter((value): value is string => value !== undefined)
    if (new Set(values).size !== values.length) {
      throw new Error(`container image policy contains duplicate ${field}`)
    }
  }

  return { version: 1, images }
}

export function loadContainerImagePolicy(root: string): ContainerImagePolicy {
  return parseContainerImagePolicy(
    JSON.parse(
      readFileSync(join(root, 'security/container-images.json'), 'utf8'),
    ) as unknown,
  )
}

export function validateDockerfileInventory(
  policy: ContainerImagePolicy,
  discovered: readonly string[],
): readonly string[] {
  const classified = policy.images.map(({ dockerfile }) => dockerfile).sort()
  const actual = [...discovered].sort()
  const unclassified = actual.filter((dockerfile) => !classified.includes(dockerfile))
  const stale = classified.filter((dockerfile) => !actual.includes(dockerfile))
  return [
    ...unclassified.map((dockerfile) => `${dockerfile} is not classified`),
    ...stale.map((dockerfile) => `${dockerfile} is classified but does not exist`),
  ]
}

type WorkflowStep = Readonly<{ name: string; content: string }>
type CiImageMatrixRow = Readonly<{ name: string; dockerfile: string; ciImage: string }>

function workflowSteps(workflow: string): readonly WorkflowStep[] {
  const lines = workflow.split('\n')
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s{6}- name:\s*\S/u.test(line))
  return starts.map(({ line, index }, position) => ({
    name: line.replace(/^\s{6}- name:\s*/u, '').trim(),
    content: lines.slice(index, starts[position + 1]?.index ?? lines.length).join('\n'),
  }))
}

function ciImageMatrixRows(workflow: string): readonly CiImageMatrixRow[] {
  const job = /^ {2}docker-images:\s*$([\s\S]*?)(?=^ {2}[a-z0-9-]+:\s*$)/mu.exec(
    workflow,
  )?.[1]
  if (!job) return []

  return [
    ...job.matchAll(
      /^\s{10}- name:\s*(\S+)\s*\n\s{12}dockerfile:\s*(\S+)\s*\n\s{12}tag:\s*(\S+)\s*$/gmu,
    ),
  ].map((match) => ({
    name: match[1],
    dockerfile: match[2],
    ciImage: match[3],
  }))
}

function listDifference(
  expected: readonly string[],
  actual: readonly string[],
  label: string,
): readonly string[] {
  const missing = expected.filter((value) => !actual.includes(value))
  const unexpected = actual.filter((value) => !expected.includes(value))
  const duplicate = [
    ...new Set(actual.filter((value, index) => actual.indexOf(value) !== index)),
  ]
  return [
    ...missing.map((value) => `${label} is missing ${value}`),
    ...unexpected.map((value) => `${label} contains unclassified ${value}`),
    ...duplicate.map((value) => `${label} contains duplicate ${value}`),
  ]
}

export function validateCiContainerCoverage(
  policy: ContainerImagePolicy,
  workflow: string,
): readonly string[] {
  const expectedImages = policy.images.map(({ ciImage }) => ciImage)
  const matrixRows = ciImageMatrixRows(workflow)
  const steps = workflowSteps(workflow)
  const webBuild = steps.find(({ name }) => name === 'Build web image')
  const nonWebBuild = steps.find(({ name }) => name === 'Build non-web image')
  const buildsFromMatrix =
    webBuild?.content.includes("if: matrix.image.name == 'web'") === true &&
    nonWebBuild?.content.includes("if: matrix.image.name != 'web'") === true &&
    [webBuild, nonWebBuild].every(
      (step) =>
        step?.content.includes('-f "${{ matrix.image.dockerfile }}"') === true &&
        step.content.includes('-t "${{ matrix.image.tag }}"'),
    )

  const violations: string[] = [
    ...listDifference(
      policy.images.map(({ dockerfile, ciImage }) => `${dockerfile}=>${ciImage}`),
      (buildsFromMatrix ? matrixRows : []).map(
        ({ dockerfile, ciImage }) => `${dockerfile}=>${ciImage}`,
      ),
      'CI image builds',
    ),
    ...listDifference(
      policy.images.map(({ id, ciImage }) => `${id}=>${ciImage}`),
      matrixRows.map(({ name, ciImage }) => `${name}=>${ciImage}`),
      'CI image matrix bindings',
    ),
  ]

  const smoke = steps.find(({ name }) => name.startsWith('Smoke images'))
  if (!smoke) {
    violations.push('CI has no image smoke-contract step')
  } else {
    const executableSmoke = smoke.content
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    for (const image of expectedImages) {
      const hasExecutableContract = executableSmoke
        .split('\n')
        .some(
          (line) =>
            line.includes(image) &&
            /(docker run|docker image inspect|smoke-provider-redis-image\.sh)/u.test(
              line,
            ),
        )
      if (!hasExecutableContract)
        violations.push(`CI smoke contracts are missing ${image}`)
    }
  }

  const sbom = steps.find(({ name }) => name === 'SBOM matrix image')
  const sbomImages =
    sbom?.content.includes('image: ${{ matrix.image.tag }}') === true &&
    sbom.content.includes('output-file: sbom-${{ matrix.image.name }}.spdx.json')
      ? matrixRows.map(({ ciImage }) => ciImage)
      : []
  violations.push(...listDifference(expectedImages, sbomImages, 'CI image SBOMs'))

  const scan = steps.find(
    ({ name }) => name === 'Vulnerability scan matrix image (grype)',
  )
  const scannedImages =
    scan?.content.includes('sbom: sbom-${{ matrix.image.name }}.spdx.json') === true &&
    scan.content.includes('fail-build: true') &&
    scan.content.includes('severity-cutoff: high') &&
    scan.content.includes('config: .grype.yaml')
      ? matrixRows.map(({ ciImage }) => ciImage)
      : []
  violations.push(
    ...listDifference(expectedImages, scannedImages, 'CI vulnerability scans'),
  )

  return violations
}

function releaseMatrixRows(workflow: string): readonly Readonly<{
  role: string
  dockerfile: string
}>[] {
  const rows: Array<{ role: string; dockerfile: string }> = []
  const lines = workflow.split('\n')
  for (const [index, line] of lines.entries()) {
    const role = /^\s+- role:\s*(\S+)\s*$/u.exec(line)?.[1]
    if (!role) continue
    const slice = lines.slice(index + 1, index + 6).join('\n')
    const dockerfile = /^\s+dockerfile:\s*(\S+)\s*$/mu.exec(slice)?.[1]
    if (dockerfile) rows.push({ role, dockerfile })
  }
  return rows
}

export function validateReleaseContainerCoverage(
  policy: ContainerImagePolicy,
  workflow: string,
): readonly string[] {
  const expected = policy.images
    .filter(({ promotion }) => promotion === 'release-candidate')
    .map(({ releaseRole, dockerfile }) => `${releaseRole}=>${dockerfile}`)
  const actual = releaseMatrixRows(workflow).map(
    ({ role, dockerfile }) => `${role}=>${dockerfile}`,
  )
  return listDifference(expected, actual, 'release image matrix')
}

/**
 * Prove that the caller-supplied beta-evidence digest names a retained,
 * non-expired artifact from the exact CI run. Copying an arbitrary digest into
 * a signed manifest is not an evidence binding.
 */
export function validateReleaseEvidenceBinding(workflow: string): readonly string[] {
  const requiredFragments = [
    'BETA_EVIDENCE_MANIFEST_SHA256: ${{ inputs.beta_evidence_manifest_sha256 }}',
    'test "$GITHUB_RUN_ATTEMPT" = "1"',
    'test "$(jq -r \'.run_attempt\' <<<"$run_json")" = "1"',
    'actions/runs/${CI_RUN_ID}/artifacts?per_page=100',
    'beta-local-smoke-${BETA_EVIDENCE_MANIFEST_SHA256}',
    'select(.name == $name and .expired == false)',
    'test "$(jq \'length\' <<<"$beta_artifacts")" -eq 1',
    'actions/artifacts/${beta_artifact_id}/zip',
    'test "${#manifest_checksums[@]}" -eq 1',
    'test "$(basename "$manifest_dir")" = "$BETA_EVIDENCE_MANIFEST_SHA256"',
    '(cd "$manifest_dir" && sha256sum --check manifest.sha256)',
    '--argjson betaEvidenceArtifacts "$beta_artifacts"',
    'betaEvidenceManifestSha256:$betaEvidenceManifestSha256',
    'betaEvidenceArtifacts:$betaEvidenceArtifacts',
    'RELEASE_RUNNER_LABEL: ubuntu-24.04',
    'RELEASE_DOCKER_VERSION: 29.7.2',
    'RELEASE_BUILDX_VERSION: 0.32.1',
    'RELEASE_BUILDKIT_VERSION: 0.30.0',
    'RELEASE_BUILDKIT_IMAGE: moby/buildkit:v0.30.0@sha256:0168606be2315b7c807a03b3d8aa79beefdb31c98740cebdffdfeebf31190c9f',
    'uses: docker/setup-docker-action@77e84dbf09b47d1e29270283c22f16145aa85ca1 # v5.4.0',
    'uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c # v4.2.0',
    'test "$docker_version" = "$RELEASE_DOCKER_VERSION $RELEASE_DOCKER_VERSION"',
    'test "$buildx_version" = "$RELEASE_BUILDX_VERSION"',
    'repkey-image-provenance-2',
    'runnerImageVersion',
    'buildkitImage',
  ] as const
  const violations = requiredFragments
    .filter((fragment) => !workflow.includes(fragment))
    .map((fragment) => `release CI evidence binding is missing ${fragment}`)
  if (workflow.includes('runs-on: ubuntu-latest')) {
    violations.push('release workflow uses mutable runner label ubuntu-latest')
  }
  if (workflow.includes('docker buildx create')) {
    violations.push('release workflow bypasses the pinned Buildx setup action')
  }
  return violations
}

function dependabotDockerDirectories(configuration: string): readonly string[] {
  const lines = configuration.split('\n')
  const directories: string[] = []
  for (const [index, line] of lines.entries()) {
    if (!/^\s*- package-ecosystem:\s*["']?docker["']?\s*$/u.test(line)) continue
    const indentation = line.match(/^\s*/u)?.[0].length ?? 0
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = lines[cursor]!
      if (
        candidate.trim() !== '' &&
        (candidate.match(/^\s*/u)?.[0].length ?? 0) <= indentation
      ) {
        break
      }
      const directory = /^\s+directory:\s*["']?([^"'\s]+)["']?\s*$/u.exec(candidate)?.[1]
      if (directory) directories.push(directory)
    }
  }
  return directories
}

export function validateDependabotContainerCoverage(
  policy: ContainerImagePolicy,
  configuration: string,
): readonly string[] {
  const required = [
    ...new Set(
      policy.images.map(({ dockerfile }) => {
        const directory = posix.dirname(dockerfile)
        return directory === '.' ? '/' : `/${directory}`
      }),
    ),
  ].sort()
  const configured = dependabotDockerDirectories(configuration)
  return required
    .filter((directory) => !configured.includes(directory))
    .map((directory) => `Dependabot docker ecosystem is missing directory ${directory}`)
}

function validateDockerfileSupplyChain(
  root: string,
  policy: ContainerImagePolicy,
): readonly string[] {
  const violations: string[] = []
  for (const { dockerfile } of policy.images) {
    const content = readFileSync(join(root, dockerfile), 'utf8')
    const stages = new Set<string>()
    for (const match of content.matchAll(/^FROM\s+(\S+)(?:\s+AS\s+(\S+))?/gimu)) {
      const image = match[1]!
      if (!stages.has(image) && !/@sha256:[0-9a-f]{64}$/u.test(image)) {
        violations.push(
          `${dockerfile} has an external FROM that is not digest-pinned: ${image}`,
        )
      }
      if (match[2]) stages.add(match[2])
    }
    if (!content.includes('org.opencontainers.image.revision')) {
      violations.push(`${dockerfile} does not label its source revision`)
    }
  }
  return violations
}

/** Validate one Dockerfile's plain COPY sources against a `**` allowlist. */
export function validateDockerfileContextAllowlist(
  dockerfile: string,
  dockerfileContent: string,
  ignore: string,
): readonly string[] {
  if (!ignore.split('\n').some((line) => line.trim() === '**')) return []
  const allowed = new Set(
    ignore
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('!'))
      .map((line) => line.slice(1).replace(/^\.\//u, '')),
  )
  const violations: string[] = []
  for (const line of dockerfileContent.split('\n')) {
    if (!/^COPY\s+/iu.test(line) || /^COPY\s+--from=/iu.test(line)) continue
    const tokens = line.trim().split(/\s+/u).slice(1)
    const sources = tokens.filter((token) => !token.startsWith('--')).slice(0, -1)
    for (const source of sources) {
      const normalized = source.replace(/^\.\//u, '')
      if (normalized === '.' || normalized.includes('*') || allowed.has(normalized)) {
        continue
      }
      violations.push(`${dockerfile}.dockerignore excludes COPY source ${normalized}`)
    }
  }
  return violations
}

/**
 * A Dockerfile-specific allowlist (`**` followed by `!path`) can silently
 * exclude a source that the Dockerfile later COPYs. Validate every plain-file
 * COPY source against that allowlist before CI spends time starting a build.
 */
function validateDockerfileContextAllowlists(
  root: string,
  policy: ContainerImagePolicy,
): readonly string[] {
  const violations: string[] = []
  for (const { dockerfile } of policy.images) {
    const ignorePath = join(root, `${dockerfile}.dockerignore`)
    if (!existsSync(ignorePath)) continue
    violations.push(
      ...validateDockerfileContextAllowlist(
        dockerfile,
        readFileSync(join(root, dockerfile), 'utf8'),
        readFileSync(ignorePath, 'utf8'),
      ),
    )
  }
  return violations
}

export function validateContainerImagePolicy(root: string): readonly string[] {
  try {
    const policy = loadContainerImagePolicy(root)
    return [
      ...validateDockerfileInventory(policy, discoverDockerfiles(root)),
      ...validateCiContainerCoverage(
        policy,
        readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8'),
      ),
      ...validateReleaseContainerCoverage(
        policy,
        readFileSync(join(root, '.github/workflows/release-images.yml'), 'utf8'),
      ),
      ...validateReleaseEvidenceBinding(
        readFileSync(join(root, '.github/workflows/release-images.yml'), 'utf8'),
      ),
      ...validateDependabotContainerCoverage(
        policy,
        readFileSync(join(root, '.github/dependabot.yml'), 'utf8'),
      ),
      ...validateDockerfileSupplyChain(root, policy),
      ...validateDockerfileContextAllowlists(root, policy),
    ]
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)]
  }
}

export function runContainerImagePolicyCli(args: readonly string[]): number {
  const root = resolve(args[0] ?? join(dirname(fileURLToPath(import.meta.url)), '../..'))
  const violations = validateContainerImagePolicy(root)
  if (violations.length > 0) {
    process.stderr.write(
      `[container-images] FAILED — ${violations.length} violation(s):\n${violations
        .map((violation) => `  - ${violation}`)
        .join('\n')}\n`,
    )
    return 1
  }
  const policy = loadContainerImagePolicy(root)
  const promoted = policy.images.filter(
    ({ promotion }) => promotion === 'release-candidate',
  )
  process.stdout.write(
    `[container-images] OK — ${policy.images.length} Dockerfiles: ${promoted.length} promoted, ${policy.images.length - promoted.length} CI-only; every image built, smoke-tested, SBOMed, scanned, and dependency-monitored\n`,
  )
  return 0
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runContainerImagePolicyCli(process.argv.slice(2))
}
