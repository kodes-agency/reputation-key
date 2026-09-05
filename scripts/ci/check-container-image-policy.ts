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

// CI publishes the seven continuously deployed production runtimes. The
// Google import compatibility image remains a governed release-candidate
// rollout tool, but is promoted by release-images.yml rather than every main
// build; sandbox and perf-runner never leave CI.
const CI_PUBLISHED_IMAGE_IDS = [
  'ai-egress-gateway',
  'ai-execution-admission',
  'google-egress-gateway',
  'google-execution-admission',
  'google-provider-redis',
  'web',
  'worker',
] as const

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
type CiImageMatrixRow = Readonly<{
  name: string
  dockerfile: string
  ciImage: string
  publish: boolean
}>
type CiImageMatrixGroup = Readonly<{
  name: string
  images: readonly CiImageMatrixRow[]
}>

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

function ciImageMatrixGroups(workflow: string): readonly CiImageMatrixGroup[] {
  const job = /^ {2}docker-images:\s*$([\s\S]*?)(?=^ {2}[a-z0-9-]+:\s*$)/mu.exec(
    workflow,
  )?.[1]
  if (!job) return []

  return [
    ...job.matchAll(
      /^\s{10}- group:\s*(\S+)\s*\n\s{12}images:\s*>-\s*\n\s{14}(\[.*\])\s*$/gmu,
    ),
  ].map((match) => {
    let candidates: unknown = []
    try {
      candidates = JSON.parse(match[2]) as unknown
    } catch {
      // A malformed descriptor becomes an empty group and fails coverage below.
    }
    const images = Array.isArray(candidates)
      ? candidates.flatMap((candidate): readonly CiImageMatrixRow[] => {
          if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate))
            return []
          const row = candidate as Record<string, unknown>
          if (
            typeof row.name !== 'string' ||
            typeof row.dockerfile !== 'string' ||
            typeof row.tag !== 'string' ||
            typeof row.publish !== 'boolean'
          )
            return []
          return [
            {
              name: row.name,
              dockerfile: row.dockerfile,
              ciImage: row.tag,
              publish: row.publish,
            },
          ]
        })
      : []
    return { name: match[1], images }
  })
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

/** The grouped build must come from the matrix rows themselves, with the GHA
 * layer cache scoped per image, or a row could silently build something the
 * policy never named. */
function ciBuildViolations(
  policy: ContainerImagePolicy,
  workflow: string,
  matrixGroups: readonly CiImageMatrixGroup[],
  matrixRows: readonly CiImageMatrixGroup['images'][number][],
  steps: readonly WorkflowStep[],
): readonly string[] {
  const build = steps.find(({ name }) => name === 'Build grouped images')
  const buildsFromMatrix =
    workflow.includes(
      'uses: docker/setup-buildx-action@bb05f3f5519dd87d3ba754cc423b652a5edd6d2c',
    ) &&
    build?.content.includes('docker buildx build') === true &&
    build.content.includes('--load') &&
    build.content.includes('--cache-from "type=gha,scope=ci-image-${name}"') &&
    build.content.includes('--cache-to "type=gha,mode=max,scope=ci-image-${name}"') &&
    build.content.includes('-f "$dockerfile"') &&
    build.content.includes('-t "$tag"')

  return [
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
    ...listDifference(
      policy.images.map(
        ({ id }) =>
          `${id}=>${CI_PUBLISHED_IMAGE_IDS.includes(
            id as (typeof CI_PUBLISHED_IMAGE_IDS)[number],
          )}`,
      ),
      matrixRows.map(({ name, publish }) => `${name}=>${publish}`),
      'CI image publish bindings',
    ),
    ...ciMatrixShapeViolations(matrixGroups),
  ]
}

/** Bounded groups are what keep the job count inside the account's concurrent
 * runner limit; web and worker stay apart so the two heaviest builds overlap. */
function ciMatrixShapeViolations(
  matrixGroups: readonly CiImageMatrixGroup[],
): readonly string[] {
  const violations: string[] = []
  if (matrixGroups.length !== 3)
    violations.push(
      `CI image matrix must use exactly 3 bounded groups, found ${matrixGroups.length}`,
    )
  for (const group of matrixGroups) {
    if (group.images.length < 1 || group.images.length > 4) {
      violations.push(
        `CI image group ${group.name} must contain 1-4 images, found ${group.images.length}`,
      )
    }
  }
  const webGroup = matrixGroups.find(({ images }) =>
    images.some(({ name }) => name === 'web'),
  )?.name
  const workerGroup = matrixGroups.find(({ images }) =>
    images.some(({ name }) => name === 'worker'),
  )?.name
  if (webGroup !== undefined && webGroup === workerGroup)
    violations.push('CI image groups must keep web and worker in separate runner rows')
  return violations
}

/** A commented-out contract proves nothing, so only executable lines count. */
function ciSmokeViolations(
  expectedImages: readonly string[],
  steps: readonly WorkflowStep[],
): readonly string[] {
  const smoke = steps.find(({ name }) => name.startsWith('Smoke images'))
  if (!smoke) return ['CI has no image smoke-contract step']
  const executableLines = smoke.content
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
  return expectedImages.flatMap((image) => {
    const hasExecutableContract = executableLines.some(
      (line) =>
        line.includes(image) &&
        /(docker run|docker image inspect|smoke-provider-redis-image\.sh)/u.test(line),
    )
    return hasExecutableContract ? [] : [`CI smoke contracts are missing ${image}`]
  })
}

/** Inventory and scan are pinned by version: an unpinned Syft or Grype makes
 * every downstream digest claim unreproducible. */
function ciEvidenceViolations(
  expectedImages: readonly string[],
  matrixRows: readonly CiImageMatrixGroup['images'][number][],
  steps: readonly WorkflowStep[],
): readonly string[] {
  const syft = steps.find(({ name }) => name === 'Install pinned Syft')
  const sbom = steps.find(({ name }) => name === 'Generate grouped image SBOMs')
  const sbomImages =
    syft?.content.includes('syft-version: v1.42.3') === true &&
    sbom?.content.includes('"$SYFT_CMD" scan "$tag"') === true &&
    sbom.content.includes('-o "spdx-json=sbom-${name}.spdx.json"')
      ? matrixRows.map(({ ciImage }) => ciImage)
      : []

  const grype = steps.find(({ name }) => name === 'Install pinned Grype')
  const scan = steps.find(
    ({ name }) => name === 'Vulnerability scan grouped images (grype)',
  )
  const scannedImages =
    grype?.content.includes('grype-version: v0.116.1') === true &&
    scan?.content.includes('"$GRYPE_CMD"') === true &&
    scan.content.includes('--fail-on high') &&
    scan.content.includes('-c .grype.yaml') &&
    scan.content.includes('"sbom:sbom-${name}.spdx.json"')
      ? matrixRows.map(({ ciImage }) => ciImage)
      : []

  return [
    ...listDifference(expectedImages, sbomImages, 'CI image SBOMs'),
    ...listDifference(expectedImages, scannedImages, 'CI vulnerability scans'),
  ]
}

/** Staging tags are unique per run attempt and must be pushed only AFTER the
 * scan step, never rebuilt, so what is promoted is what was scanned. */
function ciStagingViolations(steps: readonly WorkflowStep[]): readonly string[] {
  const named = requiredSteps(steps, [
    'Authenticate production image stager',
    'Stage scanned production images',
    'Stage scanned image descriptors',
    'Vulnerability scan grouped images (grype)',
  ])
  const failure = ['CI must stage scanned main images under unique run-attempt tags']
  if (!named) return failure
  const [stagingAuth, stageImages, stageDescriptors, scan] = named
  const contract = [
    stagingAuth.content.includes(CI_MAIN_ONLY_GUARD),
    stageImages.content.includes(CI_MAIN_ONLY_GUARD),
    stageDescriptors.content.includes(CI_MAIN_ONLY_GUARD),
    stageImages.content.includes('[[ "$(jq -r \'.publish\' <<<"$image")" == "true" ]]'),
    stageImages.content.includes(
      'staged_reference="${repository}:ci-run-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
    ),
    stageImages.content.includes('docker tag "$IMAGE_TAG" "$staged_reference"'),
    stageImages.content.includes('docker push "$staged_reference"'),
    !stageImages.content.includes('docker buildx build'),
    !stageImages.content.includes(':latest'),
    // Staging after the scan is the whole point: it is what makes the promoted
    // digest the scanned digest rather than a hopeful rebuild.
    steps.indexOf(scan) < steps.indexOf(stageImages),
  ]
  return contract.every(Boolean) ? [] : failure
}

/** Promotion is by digest across the complete staged set, and the digest map is
 * written only after the last read-back, so a consumer never sees a partial map. */
function ciPromotionViolations(
  workflow: string,
  steps: readonly WorkflowStep[],
): readonly string[] {
  const named = requiredSteps(steps, [
    'Require every image matrix entry to succeed',
    'Validate complete staged production image set',
    'Authenticate production image promoter',
    'Promote complete production image set',
  ])
  const failure = [
    'CI must promote the exact complete staged image set before writing its digest map',
  ]
  if (!named) return failure
  const [barrier, validateStaged, promotionAuth, promote] = named
  const mapWrite = 'validated-image-digests.json > ci-image-digest-map.json'
  const finalVerification = promote.content.lastIndexOf(
    'final_digest=$(docker buildx imagetools inspect',
  )
  const contract = [
    barrier.content.includes("if: needs.docker-images.result != 'success'"),
    validateStaged.content.includes(CI_MAIN_ONLY_GUARD),
    validateStaged.content.includes(JSON.stringify([...CI_PUBLISHED_IMAGE_IDS])),
    validateStaged.content.includes('staged image set is incomplete or unexpected'),
    validateStaged.content.includes(
      '.repository != ("ghcr.io/kodes-agency/repkey-" + .image)',
    ),
    promotionAuth.content.includes(CI_MAIN_ONLY_GUARD),
    promote.content.includes(CI_MAIN_ONLY_GUARD),
    promote.content.includes('docker buildx imagetools create'),
    promote.content.includes('--prefer-index=false'),
    promote.content.includes('"${repository}@${expected_digest}"'),
    promote.content.includes('final_reference="${repository}:${GITHUB_SHA}"'),
    !promote.content.includes('docker buildx build'),
    !promote.content.includes(':latest'),
    finalVerification >= 0,
    // The map must be written strictly after the last digest read-back.
    promote.content.indexOf(mapWrite) > finalVerification,
    workflow.includes('name: ci-image-digest-map-${{ github.sha }}'),
  ]
  return contract.every(Boolean) ? [] : failure
}

/** Resolves every named step or nothing, so callers assert content without
 * repeating an `undefined` check per step. */
function requiredSteps(
  steps: readonly WorkflowStep[],
  names: readonly string[],
): readonly WorkflowStep[] | null {
  const found = names.map((name) => steps.find((step) => step.name === name))
  return found.every((step): step is WorkflowStep => step !== undefined) ? found : null
}

const CI_MAIN_ONLY_GUARD =
  "if: github.event_name == 'push' && github.ref == 'refs/heads/main'"

export function validateCiContainerCoverage(
  policy: ContainerImagePolicy,
  workflow: string,
): readonly string[] {
  const expectedImages = policy.images.map(({ ciImage }) => ciImage)
  const matrixGroups = ciImageMatrixGroups(workflow)
  const matrixRows = matrixGroups.flatMap(({ images }) => images)
  const steps = workflowSteps(workflow)
  return [
    ...ciBuildViolations(policy, workflow, matrixGroups, matrixRows, steps),
    ...ciSmokeViolations(expectedImages, steps),
    ...ciEvidenceViolations(expectedImages, matrixRows, steps),
    ...ciStagingViolations(steps),
    ...ciPromotionViolations(workflow, steps),
  ]
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
