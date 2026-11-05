// What the image policy reads out of ci.yml: its steps and jobs by name, and the
// checks both image pipelines owe. A commented-out contract proves nothing, so
// each of these reads only executable lines.

// CI builds all four classified image descriptors. On main, it publishes the
// three production runtimes below under immutable source-revision tags;
// the provider sandbox remains CI-only.
export const CI_PUBLISHED_IMAGE_IDS = ['google-provider-redis', 'web', 'worker'] as const

export type WorkflowStep = Readonly<{ name: string; content: string }>

export function workflowSteps(workflow: string): readonly WorkflowStep[] {
  const lines = workflow.split('\n')
  const starts = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^\s{6}- name:\s*\S/u.test(line))
  return starts.map(({ line, index }, position) => ({
    name: line.replace(/^\s{6}- name:\s*/u, '').trim(),
    content: lines.slice(index, starts[position + 1]?.index ?? lines.length).join('\n'),
  }))
}

export function listDifference(
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

/**
 * A build argument is not a secret. BuildKit records its value in the image
 * history, in build provenance, and in the exported layer cache, so a token
 * handed to `--build-arg` is readable by anyone who can pull or inspect the
 * image — the source-map upload token shipped this way until 2026-09-24.
 * Secret material belongs in `--secret id=…`, which binds to a single RUN and
 * is never written into a layer.
 *
 * The match is on the NAME, so the gate costs nothing at runtime and never
 * needs the value. A legitimately non-secret name that trips it (some future
 * `CACHE_KEY`) is an exception decision, not a reason to widen the pattern.
 */
const SECRET_SHAPED_BUILD_INPUT =
  /(?:^|_)(?:TOKEN|SECRET|PASSWORD|PASSWD|PASSPHRASE|CREDENTIAL|CREDENTIALS|KEY|APIKEY)(?:_|$)/u

export function secretShapedBuildInputs(names: readonly string[]): readonly string[] {
  return names.filter((name) => SECRET_SHAPED_BUILD_INPUT.test(name.toUpperCase()))
}

export function ciBuildArgumentViolations(
  build: WorkflowStep | undefined,
): readonly string[] {
  if (!build) return []
  const passed = [
    ...build.content.matchAll(/--build-arg\s+"?([A-Za-z_][A-Za-z0-9_]*)=/gu),
  ].map((match) => match[1]!)
  return secretShapedBuildInputs(passed).map(
    (name) =>
      `CI passes secret-shaped build argument ${name}; deliver it with --secret id=… instead`,
  )
}

/** A commented-out contract proves nothing, so only executable lines count. */
export function ciSmokeViolations(
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

/** Resolves every named step or nothing, so callers assert content without
 * repeating an `undefined` check per step. */
export function requiredSteps(
  steps: readonly WorkflowStep[],
  names: readonly string[],
): readonly WorkflowStep[] | null {
  const found = names.map((name) => steps.find((step) => step.name === name))
  return found.every((step): step is WorkflowStep => step !== undefined) ? found : null
}

/** One top-level job's text: its key line to the next job's. */
export function workflowJob(workflow: string, id: string): string {
  const match = new RegExp(
    `^ {2}${id}:\\s*$([\\s\\S]*?)(?=^ {2}[a-z0-9-]+:\\s*$|(?![\\s\\S]))`,
    'mu',
  ).exec(workflow)
  return match?.[0] ?? ''
}
