// The replacement image pipeline's half of the container image policy: the
// `image-build`, `image-scan` and `image` jobs of ci.yml owe the same promises as
// the `docker-images` and `docker` jobs, and are read from the workflow text the
// same way.

import {
  ciBuildArgumentViolations,
  CI_PUBLISHED_IMAGE_IDS,
  ciSmokeViolations,
  listDifference,
  requiredSteps,
  workflowJob,
  workflowSteps,
  type WorkflowStep,
} from './ci-workflow-text'

/** The part of the container image policy this check reads. */
type ImagePipelinePolicy = Readonly<{
  images: readonly Readonly<{
    id: string
    dockerfile: string
    ciImage: string
  }>[]
}>

const CI_DISPATCH_ONLY_GUARD = "if: github.event_name == 'workflow_dispatch'"

function descriptorLists(job: string, pattern: RegExp): readonly unknown[][] {
  return [...job.matchAll(pattern)].map((match) => {
    try {
      const parsed: unknown = JSON.parse(match[1]!)
      return Array.isArray(parsed) ? (parsed as unknown[]) : []
    } catch {
      return []
    }
  })
}

type PipelineBuildRow = Readonly<{
  name: string
  dockerfile: string
  tags: readonly string[]
}>
type PipelineScanRow = Readonly<{ name: string; tag: string; publish: boolean }>

function pipelineBuildRows(job: string): readonly PipelineBuildRow[] {
  return descriptorLists(job, /^\s{12}images:\s*>-\s*\n\s{14}(\[.*\])\s*$/gmu)
    .flat()
    .flatMap((candidate): readonly PipelineBuildRow[] => {
      const row = candidate as Record<string, unknown> | null
      if (
        !row ||
        typeof row.name !== 'string' ||
        typeof row.dockerfile !== 'string' ||
        !Array.isArray(row.tags) ||
        !row.tags.every((tag) => typeof tag === 'string')
      )
        return []
      return [{ name: row.name, dockerfile: row.dockerfile, tags: row.tags as string[] }]
    })
}

function pipelineScanRows(job: string): readonly PipelineScanRow[] {
  return descriptorLists(job, /^\s{6}IMAGES_JSON:\s*>-\s*\n\s{8}(\[.*\])\s*$/gmu)
    .flat()
    .flatMap((candidate): readonly PipelineScanRow[] => {
      const row = candidate as Record<string, unknown> | null
      if (
        !row ||
        typeof row.name !== 'string' ||
        typeof row.tag !== 'string' ||
        typeof row.publish !== 'boolean'
      )
        return []
      return [{ name: row.name, tag: row.tag, publish: row.publish }]
    })
}

/**
 * The replacement pipeline holds the same promises as the groups above it, from
 * the jobs `image-build`, `image-scan` and `image`: every classified image is
 * built from the Dockerfile the policy names, smoke-tested, inventoried and
 * scanned from one archive of the build, staged only after the scan, and named
 * in a digest map only after the registry answers for it.
 */
export function validateCiImagePipeline(
  policy: ImagePipelinePolicy,
  workflow: string,
): readonly string[] {
  const build = workflowJob(workflow, 'image-build')
  const scan = workflowJob(workflow, 'image-scan')
  const aggregate = workflowJob(workflow, 'image')
  if (build === '' || scan === '' || aggregate === '') {
    return ['CI has no image-build, image-scan and image jobs']
  }
  const buildSteps = workflowSteps(build)
  const scanSteps = workflowSteps(scan)
  const aggregateSteps = workflowSteps(aggregate)
  const expectedImages = policy.images.map(({ ciImage }) => ciImage)
  const buildRows = pipelineBuildRows(build)
  const scanRows = pipelineScanRows(scan)
  const buildStep = buildSteps.find(({ name }) => name === 'Build images')
  const buildsFromRows =
    /uses: docker\/setup-buildx-action@[0-9a-f]{40}\b/u.test(build) &&
    buildStep?.content.includes('docker buildx build') === true &&
    buildStep.content.includes('--output "type=docker,dest=images/${name}.tar"') &&
    buildStep.content.includes('build_flags+=(-t "$tag")') &&
    buildStep.content.includes('-f "$dockerfile"')

  return [
    ...listDifference(
      policy.images.map(({ dockerfile, ciImage }) => `${dockerfile}=>${ciImage}`),
      (buildsFromRows ? buildRows : []).flatMap(({ dockerfile, tags }) =>
        tags.map((tag) => `${dockerfile}=>${tag}`),
      ),
      'CI image pipeline builds',
    ),
    ...listDifference(
      policy.images.map(({ id, ciImage }) => `${id}=>${ciImage}`),
      scanRows.map(({ name, tag }) => `${name}=>${tag}`),
      'CI image pipeline bindings',
    ),
    ...listDifference(
      policy.images.map(
        ({ id }) =>
          `${id}=>${CI_PUBLISHED_IMAGE_IDS.includes(
            id as (typeof CI_PUBLISHED_IMAGE_IDS)[number],
          )}`,
      ),
      scanRows.map(({ name, publish }) => `${name}=>${publish}`),
      'CI image pipeline publish bindings',
    ),
    ...ciBuildArgumentViolations(buildStep),
    ...pipelineLoadViolations(scanSteps),
    ...ciSmokeViolations(expectedImages, scanSteps),
    ...pipelineEvidenceViolations(expectedImages, scanRows, scanSteps),
    ...pipelineStagingViolations(scanSteps),
    ...pipelineMapViolations(workflow, aggregateSteps),
  ]
}

/** What is smoked, inventoried and scanned must be what the build made. */
function pipelineLoadViolations(steps: readonly WorkflowStep[]): readonly string[] {
  const named = requiredSteps(steps, [
    'Download images',
    'Load images',
    'Smoke images (contract, non-root, prod-deps purity)',
  ])
  const failure = ['CI image pipeline must smoke the images it loads from the build']
  if (!named) return failure
  const [download, load, smoke] = named
  return download.content.includes('pattern: images-*') &&
    load.content.includes('docker load') &&
    !load.content.includes('docker buildx build') &&
    !smoke.content.includes('docker buildx build')
    ? []
    : failure
}

/** Inventory and scan are pinned by version and read the image list, so an
 * image is scanned by being listed; the database cache is keyed on its build. */
function pipelineEvidenceViolations(
  expectedImages: readonly string[],
  scanRows: readonly PipelineScanRow[],
  steps: readonly WorkflowStep[],
): readonly string[] {
  const syft = steps.find(({ name }) => name === 'Install pinned Syft')
  const sbom = steps.find(({ name }) => name === 'Generate image SBOMs')
  const sbomImages =
    syft?.content.includes('syft-version: v1.42.3') === true &&
    sbom?.content.includes('"$SYFT_CMD" scan "$tag"') === true &&
    sbom.content.includes('-o "spdx-json=image-sboms/sbom-${name}.spdx.json"') &&
    sbom.content.includes('<<<"$IMAGES_JSON"')
      ? scanRows.map(({ tag }) => tag)
      : []

  const grype = steps.find(({ name }) => name === 'Install pinned Grype')
  const database = steps.find(({ name }) => name === 'Restore Grype vulnerability DB')
  const scan = steps.find(({ name }) => name === 'Vulnerability scan images (grype)')
  const scannedImages =
    grype?.content.includes('grype-version: v0.116.1') === true &&
    database?.content.includes('steps.grype-db.outputs.built') === true &&
    scan?.content.includes('"$GRYPE_CMD"') === true &&
    scan.content.includes('--fail-on high') &&
    scan.content.includes('-c .grype.yaml') &&
    scan.content.includes('"sbom:image-sboms/sbom-${name}.spdx.json"') &&
    scan.content.includes('<<<"$IMAGES_JSON"')
      ? scanRows.map(({ tag }) => tag)
      : []

  return [
    ...listDifference(expectedImages, sbomImages, 'CI image pipeline SBOMs'),
    ...listDifference(expectedImages, scannedImages, 'CI image pipeline scans'),
  ]
}

/** Staged after the scan, under a tag no other run can hold, from the loaded
 * image and never a rebuild; only a dispatched run stages here, because a main
 * push stages and promotes through the `docker` job. */
function pipelineStagingViolations(steps: readonly WorkflowStep[]): readonly string[] {
  const named = requiredSteps(steps, [
    'Authenticate image stager',
    'Stage scanned images',
    'Stage scanned image descriptors',
    'Vulnerability scan images (grype)',
  ])
  const failure = ['CI image pipeline must stage scanned images under unique run tags']
  if (!named) return failure
  const [stagingAuth, stageImages, stageDescriptors, scan] = named
  const contract = [
    stagingAuth.content.includes(CI_DISPATCH_ONLY_GUARD),
    stageImages.content.includes(CI_DISPATCH_ONLY_GUARD),
    stageDescriptors.content.includes(CI_DISPATCH_ONLY_GUARD),
    stageImages.content.includes('[[ "$(jq -r \'.publish\' <<<"$image")" == "true" ]]'),
    stageImages.content.includes(
      'staged_reference="${repository}:ci-run-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
    ),
    stageImages.content.includes('docker tag "$IMAGE_TAG" "$staged_reference"'),
    stageImages.content.includes('docker push "$staged_reference"'),
    !stageImages.content.includes('docker buildx build'),
    !stageImages.content.includes(':latest'),
    steps.indexOf(scan) < steps.indexOf(stageImages),
  ]
  return contract.every(Boolean) ? [] : failure
}

/** The map names a digest only after the registry answers for it, and no
 * dispatched run tags a commit: that is the main push's, and builds differ. */
function pipelineMapViolations(
  workflow: string,
  steps: readonly WorkflowStep[],
): readonly string[] {
  const named = requiredSteps(steps, [
    'Require every image job to succeed',
    'Validate complete staged image set',
    'Authenticate image reader',
    'Write image digest map',
    'Upload image digest map',
  ])
  const failure = [
    'CI image pipeline must read back the staged image set before writing its digest map',
  ]
  if (!named) return failure
  const [barrier, validateStaged, auth, write, upload] = named
  const readBack = write.content.indexOf(
    'staged_digest=$(docker buildx imagetools inspect',
  )
  const mapWrite = 'validated-image-digests.json > ci-image-digest-map.json'
  const contract = [
    barrier.content.includes(
      "if: needs.image-build.result != 'success' || needs.image-scan.result != 'success'",
    ),
    validateStaged.content.includes(CI_DISPATCH_ONLY_GUARD),
    validateStaged.content.includes(JSON.stringify([...CI_PUBLISHED_IMAGE_IDS])),
    validateStaged.content.includes('staged image set is incomplete or unexpected'),
    validateStaged.content.includes(
      '.repository != ("ghcr.io/kodes-agency/repkey-" + .image)',
    ),
    auth.content.includes(CI_DISPATCH_ONLY_GUARD),
    write.content.includes(CI_DISPATCH_ONLY_GUARD),
    upload.content.includes(CI_DISPATCH_ONLY_GUARD),
    write.content.includes('test "$staged_digest" = "$expected_digest"'),
    write.content.includes('event:"workflow_dispatch"'),
    !write.content.includes('docker buildx build'),
    !write.content.includes('imagetools create'),
    !write.content.includes(':latest'),
    readBack >= 0,
    write.content.indexOf(mapWrite) > readBack,
    upload.content.includes('name: ci-image-digest-map-${{ github.sha }}'),
    workflow.includes('name: ci-image-digest-map-${{ github.sha }}'),
  ]
  return contract.every(Boolean) ? [] : failure
}
