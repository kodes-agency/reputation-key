import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'

export const ACCEPTED_REVIEW_BASELINE_SHA =
  '718fad1807b7422885584660bd3580f2a3a49113' as const

const repositoryPath = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith('/') && !path.includes('..'), {
    message: 'must be a repository-relative path without parent traversal',
  })
const markers = z.array(z.string().min(1)).min(1)
const packageId = z.string().regex(/^[A-Z]+-\d{2}$/u)

const evidence = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('git_source'),
      path: repositoryPath,
      contains: markers,
      omits: z.array(z.string().min(1)).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('retained_file'),
      path: repositoryPath,
      sha256: z.string().regex(/^[0-9a-f]{64}$/u),
      contains: markers,
    })
    .strict(),
])

const closure = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('current_test'),
      path: repositoryPath,
      contains: markers,
      expected: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('planned_in_package'),
      package: packageId,
      expected: z.string().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal('external_evidence'),
      dependency: z.string().min(1),
      expected: z.string().min(1),
    })
    .strict(),
])

const revalidatedFinding = z
  .object({
    id: z.string().regex(/^[A-Z]+-\d{2}$/u),
    disposition: z.enum([
      'closed',
      'configuration-dependent',
      'confirmed',
      'inferred',
      'reproduced',
      'superseded',
    ]),
    ownerPackage: packageId,
    targetPackages: z.array(packageId).min(1),
    reachability: z.enum([
      'active',
      'controlled',
      'dark',
      'operator_only',
      'configuration_dependent',
      'not_reachable',
    ]),
    impact: z.string().min(1),
    frozenEvidence: z.array(evidence).min(1),
    closure: closure,
    note: z.string().min(1),
  })
  .strict()

const findingRevalidation = z
  .object({
    version: z.literal(1),
    frozenSha: z.literal(ACCEPTED_REVIEW_BASELINE_SHA),
    sourceRegisterSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    assessedAt: z.iso.date(),
    findings: z.array(revalidatedFinding),
  })
  .strict()

const baselineFinding = z
  .object({
    id: z.string().regex(/^[A-Z]+-\d{2}$/u),
    targetPackages: z.array(packageId),
  })
  .passthrough()

type RevalidationReaders = Readonly<{
  readFrozenSource: (path: string) => string
  readCurrentFile: (path: string) => Buffer
}>

const defaultReaders: RevalidationReaders = {
  readFrozenSource(path) {
    return execFileSync('git', ['show', `${ACCEPTED_REVIEW_BASELINE_SHA}:${path}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  },
  readCurrentFile(path) {
    return readFileSync(resolve(path))
  },
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function planPackageIds(plan: string): ReadonlySet<string> {
  return new Set(
    [...plan.matchAll(/^### ([A-Z]+-\d{2}) — /gmu)].map((match) => match[1]!),
  )
}

function assertContains(
  label: string,
  content: string,
  required: readonly string[],
  forbidden: readonly string[] = [],
): void {
  for (const marker of required) {
    if (!content.includes(marker)) {
      throw new Error(`${label} does not contain ${JSON.stringify(marker)}`)
    }
  }
  for (const marker of forbidden) {
    if (content.includes(marker)) {
      throw new Error(`${label} unexpectedly contains ${JSON.stringify(marker)}`)
    }
  }
}

type RevalidatedFinding = z.infer<typeof revalidatedFinding>

function assertPackageAssignment(
  finding: RevalidatedFinding,
  original: z.infer<typeof baselineFinding>,
  packages: ReadonlySet<string>,
): void {
  if (
    JSON.stringify(finding.targetPackages) !== JSON.stringify(original.targetPackages)
  ) {
    throw new Error(`${finding.id} target packages differ from the frozen register`)
  }
  if (!finding.targetPackages.includes(finding.ownerPackage)) {
    throw new Error(`${finding.id} ownerPackage must be one of its targetPackages`)
  }
  for (const target of finding.targetPackages) {
    if (!packages.has(target)) {
      throw new Error(`${finding.id} references unknown implementation package ${target}`)
    }
  }
}

function assertFrozenEvidence(
  finding: RevalidatedFinding,
  readers: RevalidationReaders,
): void {
  for (const proof of finding.frozenEvidence) {
    if (proof.kind === 'git_source') {
      assertContains(
        `${finding.id} frozen source ${proof.path}`,
        readers.readFrozenSource(proof.path),
        proof.contains,
        proof.omits,
      )
      continue
    }
    const bytes = readers.readCurrentFile(proof.path)
    if (sha256(bytes) !== proof.sha256) {
      throw new Error(`${finding.id} retained evidence digest differs for ${proof.path}`)
    }
    assertContains(
      `${finding.id} retained evidence ${proof.path}`,
      bytes.toString('utf8'),
      proof.contains,
    )
  }
}

function assertClosure(finding: RevalidatedFinding, readers: RevalidationReaders): void {
  if (finding.closure.kind === 'current_test') {
    assertContains(
      `${finding.id} closure test ${finding.closure.path}`,
      readers.readCurrentFile(finding.closure.path).toString('utf8'),
      finding.closure.contains,
    )
    return
  }
  if (
    finding.closure.kind === 'planned_in_package' &&
    !finding.targetPackages.includes(finding.closure.package)
  ) {
    throw new Error(`${finding.id} closure package is not assigned to the finding`)
  }
}

export function validateFindingRevalidation(
  input: unknown,
  sourceRegisterText: string,
  plan: string,
  readers: RevalidationReaders = defaultReaders,
): readonly string[] {
  const index = findingRevalidation.parse(input)
  if (index.sourceRegisterSha256 !== sha256(sourceRegisterText)) {
    throw new Error('source finding-register digest does not match')
  }

  const baseline = z.array(baselineFinding).parse(JSON.parse(sourceRegisterText))
  const expectedIds = baseline.map(({ id }) => id)
  const actualIds = index.findings.map(({ id }) => id)
  if (JSON.stringify(actualIds) !== JSON.stringify(expectedIds)) {
    throw new Error(
      'revalidation must contain every frozen finding exactly once and in order',
    )
  }

  const packages = planPackageIds(plan)
  if (packages.size === 0) throw new Error('implementation plan contains no packages')

  for (const [position, finding] of index.findings.entries()) {
    assertPackageAssignment(finding, baseline[position]!, packages)
    assertFrozenEvidence(finding, readers)
    assertClosure(finding, readers)
  }

  return actualIds
}

function runFindingRevalidationCli(args: readonly string[]): number {
  try {
    const indexPath = resolve(
      args[0] ?? 'docs/release-evidence/review/finding-revalidation-2026-08-26.json',
    )
    const registerPath = resolve(
      args[1] ??
        'docs/release-evidence/review/718fad1807b7422885584660bd3580f2a3a49113/local-darwin-arm64-node22.23.2/finding-register.json',
    )
    const planPath = resolve(
      args[2] ?? 'docs/comprehensive-beta-implementation-program-2026-08-25.md',
    )
    const input = JSON.parse(readFileSync(indexPath, 'utf8')) as unknown
    const register = readFileSync(registerPath, 'utf8')
    const ids = validateFindingRevalidation(
      input,
      register,
      readFileSync(planPath, 'utf8'),
    )
    const parsed = findingRevalidation.parse(input)
    const dispositions = Object.fromEntries(
      [
        'closed',
        'configuration-dependent',
        'confirmed',
        'inferred',
        'reproduced',
        'superseded',
      ].map((disposition) => [
        disposition,
        parsed.findings.filter((finding) => finding.disposition === disposition).length,
      ]),
    )
    process.stdout.write(`${JSON.stringify({ findings: ids.length, dispositions })}\n`)
    return 0
  } catch (error) {
    process.stderr.write(
      `finding revalidation invalid: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runFindingRevalidationCli(process.argv.slice(2))
}
