import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod/v4'

export const ACCEPTED_REVIEW_SHA = '718fad1807b7422885584660bd3580f2a3a49113' as const

export const REVALIDATED_FAMILIES = ['ARCH', 'AUTH', 'DATA', 'DEC', 'EVT'] as const

export const REVALIDATED_FAMILIES_BY_FRAGMENT = {
  'arch-auth-data-dec-evt': REVALIDATED_FAMILIES,
  'gate-gov-ops': ['GATE', 'GOV', 'OPS'],
  ui: ['UI'],
} as const

type RevalidationFragmentId = keyof typeof REVALIDATED_FAMILIES_BY_FRAGMENT

const repositoryPath = z
  .string()
  .min(1)
  .refine((path) => !path.startsWith('/') && !path.includes('..'), {
    message: 'must be a repository-relative path without parent traversal',
  })
const digest = z.string().regex(/^[0-9a-f]{64}$/u)
const markers = z.array(z.string().min(1)).min(1)
const proofId = z.string().regex(/^(?:frozen|current)\.[a-z0-9][a-z0-9.-]+$/u)
const packageId = z.string().regex(/^[A-Z]+-\d{2}$/u)
const gitPathspec = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith('-') && !value.includes('..'), {
    message: 'must not be an option or contain parent traversal',
  })

const immutableProof = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('git_file'),
      path: repositoryPath,
      sha256: digest,
      contains: markers,
      omits: z.array(z.string().min(1)).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('git_tree'),
      path: repositoryPath,
      sha256: digest,
      includes: markers,
      excludes: z.array(z.string().min(1)).default([]),
    })
    .strict(),
  z
    .object({
      kind: z.literal('git_search'),
      pattern: z.string().min(1),
      pathspecs: z.array(gitPathspec).min(1),
      sha256: digest,
      contains: markers,
      omits: z.array(z.string().min(1)).default([]),
    })
    .strict(),
])

const closure = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('verified_current'),
      evidence: z.array(proofId).min(1),
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

const finding = z
  .object({
    id: z.string().regex(/^[A-Z]+-\d{2}$/u),
    frozenPosition: z.number().int().positive(),
    frozenSeverity: z.string().min(1),
    frozenSourceLine: z.number().int().positive(),
    frozenSummary: z.string().min(1),
    disposition: z.enum([
      'closed',
      'configuration-dependent',
      'confirmed',
      'inferred',
      'reproduced',
      'superseded',
    ]),
    reachability: z.enum([
      'active',
      'controlled',
      'dark',
      'operator_only',
      'configuration_dependent',
      'not_reachable',
    ]),
    impact: z.string().min(1),
    ownerPackage: packageId,
    targetPackages: z.array(packageId).min(1),
    frozenEvidence: z.array(proofId).min(1),
    currentEvidence: z.array(proofId).min(1),
    closure,
    note: z.string().min(1),
  })
  .strict()

const fragmentSchema = z
  .object({
    version: z.literal(1),
    fragmentId: z.enum(['arch-auth-data-dec-evt', 'gate-gov-ops', 'ui']),
    frozenSha: z.literal(ACCEPTED_REVIEW_SHA),
    comparisonSha: z.string().regex(/^[0-9a-f]{40}$/u),
    sourceRegisterSha256: digest,
    assessedAt: z.iso.date(),
    families: z.array(
      z.enum(['ARCH', 'AUTH', 'DATA', 'DEC', 'EVT', 'GATE', 'GOV', 'OPS', 'UI']),
    ),
    evidence: z
      .object({
        frozen: z.record(proofId, immutableProof),
        current: z.record(proofId, immutableProof),
      })
      .strict(),
    findings: z.array(finding),
  })
  .strict()

function familiesForFragment(fragmentId: RevalidationFragmentId): readonly string[] {
  return REVALIDATED_FAMILIES_BY_FRAGMENT[fragmentId]
}

const baselineFinding = z
  .object({
    id: z.string().regex(/^[A-Z]+-\d{2}$/u),
    severity: z.string().min(1),
    sourceLine: z.number().int().positive(),
    summary: z.string().min(1),
    targetPackages: z.array(packageId),
  })
  .passthrough()

export type FragmentReaders = Readonly<{
  readFileAt: (revision: string, path: string) => Buffer
  listTreeAt: (revision: string, path: string) => Buffer
  searchAt: (revision: string, pattern: string, pathspecs: readonly string[]) => Buffer
  isAncestor: (ancestor: string, descendant: string) => boolean
}>

const defaultReaders: FragmentReaders = {
  readFileAt(revision, path) {
    return execFileSync('git', ['show', `${revision}:${path}`])
  },
  listTreeAt(revision, path) {
    return execFileSync('git', ['ls-tree', '-r', '--name-only', revision, '--', path])
  },
  searchAt(revision, pattern, pathspecs) {
    return execFileSync('git', [
      'grep',
      '-n',
      '-E',
      pattern,
      revision,
      '--',
      ...pathspecs,
    ])
  },
  isAncestor(ancestor, descendant) {
    try {
      execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant])
      return true
    } catch {
      return false
    }
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

function assertMarkers(
  label: string,
  content: string,
  required: readonly string[],
  forbidden: readonly string[],
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

function validateProof(
  id: string,
  proof: z.infer<typeof immutableProof>,
  revision: string,
  readers: FragmentReaders,
): void {
  const bytes =
    proof.kind === 'git_file'
      ? readers.readFileAt(revision, proof.path)
      : proof.kind === 'git_tree'
        ? readers.listTreeAt(revision, proof.path)
        : readers.searchAt(revision, proof.pattern, proof.pathspecs)
  if (sha256(bytes) !== proof.sha256) {
    throw new Error(`${id} digest differs from immutable ${revision} evidence`)
  }
  if (proof.kind === 'git_file' || proof.kind === 'git_search') {
    assertMarkers(id, bytes.toString('utf8'), proof.contains, proof.omits)
  } else {
    assertMarkers(id, bytes.toString('utf8'), proof.includes, proof.excludes)
  }
}

export function validateFindingRevalidationFragment(
  input: unknown,
  sourceRegisterText: string,
  plan: string,
  readers: FragmentReaders = defaultReaders,
): readonly string[] {
  const fragment = fragmentSchema.parse(input)
  const selectedFamilies = familiesForFragment(fragment.fragmentId)
  if (JSON.stringify(fragment.families) !== JSON.stringify(selectedFamilies)) {
    throw new Error('fragment families must match its governed fragment identifier')
  }
  if (!readers.isAncestor(fragment.frozenSha, fragment.comparisonSha)) {
    throw new Error('comparison revision must descend from the frozen review SHA')
  }
  if (fragment.sourceRegisterSha256 !== sha256(sourceRegisterText)) {
    throw new Error('source finding-register digest does not match')
  }

  const register = z.array(baselineFinding).parse(JSON.parse(sourceRegisterText))
  const expected = register
    .map((row, index) => ({ row, position: index + 1 }))
    .filter(({ row }) =>
      selectedFamilies.some((family) => row.id.startsWith(`${family}-`)),
    )
  const actualIds = fragment.findings.map(({ id }) => id)
  if (JSON.stringify(actualIds) !== JSON.stringify(expected.map(({ row }) => row.id))) {
    throw new Error(
      'fragment must contain every selected frozen finding once and in order',
    )
  }

  const packages = planPackageIds(plan)
  if (packages.size === 0) throw new Error('implementation plan contains no packages')

  const usedFrozen = new Set<string>()
  const usedCurrent = new Set<string>()
  const proofFor = (catalogue: 'frozen' | 'current', id: string) => {
    if (!id.startsWith(`${catalogue}.`)) {
      throw new Error(`${id} is referenced from the wrong evidence catalogue`)
    }
    const proof = fragment.evidence[catalogue][id]
    if (!proof) throw new Error(`unknown ${catalogue} evidence ${id}`)
    ;(catalogue === 'frozen' ? usedFrozen : usedCurrent).add(id)
    return proof
  }

  for (const [index, entry] of fragment.findings.entries()) {
    const original = expected[index]!
    if (
      entry.frozenPosition !== original.position ||
      entry.frozenSeverity !== original.row.severity ||
      entry.frozenSourceLine !== original.row.sourceLine ||
      entry.frozenSummary !== original.row.summary
    ) {
      throw new Error(`${entry.id} frozen register fields differ`)
    }
    if (
      JSON.stringify(entry.targetPackages) !== JSON.stringify(original.row.targetPackages)
    ) {
      throw new Error(`${entry.id} target packages differ from the frozen register`)
    }
    if (!entry.targetPackages.includes(entry.ownerPackage)) {
      throw new Error(`${entry.id} ownerPackage must be one of its targetPackages`)
    }
    for (const target of entry.targetPackages) {
      if (!packages.has(target)) {
        throw new Error(`${entry.id} references unknown implementation package ${target}`)
      }
    }

    for (const id of entry.frozenEvidence) proofFor('frozen', id)
    for (const id of entry.currentEvidence) proofFor('current', id)

    if (entry.disposition === 'closed') {
      if (entry.reachability !== 'not_reachable') {
        throw new Error(`${entry.id} closed finding must be not_reachable`)
      }
      if (entry.closure.kind !== 'verified_current') {
        throw new Error(`${entry.id} closed finding requires verified current evidence`)
      }
    }
    if (entry.disposition === 'superseded' && entry.reachability !== 'not_reachable') {
      throw new Error(`${entry.id} superseded finding must be not_reachable`)
    }

    if (entry.closure.kind === 'verified_current') {
      for (const id of entry.closure.evidence) {
        proofFor('current', id)
        if (!entry.currentEvidence.includes(id)) {
          throw new Error(`${entry.id} closure evidence is not current finding evidence`)
        }
      }
    } else if (
      entry.closure.kind === 'planned_in_package' &&
      !entry.targetPackages.includes(entry.closure.package)
    ) {
      throw new Error(`${entry.id} closure package is not assigned to the finding`)
    }
  }

  for (const [id, proof] of Object.entries(fragment.evidence.frozen)) {
    if (!usedFrozen.has(id)) throw new Error(`unused frozen evidence ${id}`)
    validateProof(id, proof, fragment.frozenSha, readers)
  }
  for (const [id, proof] of Object.entries(fragment.evidence.current)) {
    if (!usedCurrent.has(id)) throw new Error(`unused current evidence ${id}`)
    validateProof(id, proof, fragment.comparisonSha, readers)
  }

  return actualIds
}

export function runFindingRevalidationFragmentCli(args: readonly string[]): number {
  try {
    const fragmentPath = resolve(
      args[0] ??
        'docs/release-evidence/review/finding-revalidation-fragments/arch-auth-data-dec-evt-2026-08-26.json',
    )
    const registerPath = resolve(
      args[1] ??
        'docs/release-evidence/review/718fad1807b7422885584660bd3580f2a3a49113/local-darwin-arm64-node22.23.2/finding-register.json',
    )
    const planPath = resolve(
      args[2] ?? 'docs/comprehensive-beta-implementation-program-2026-08-25.md',
    )
    const input = JSON.parse(readFileSync(fragmentPath, 'utf8')) as unknown
    const ids = validateFindingRevalidationFragment(
      input,
      readFileSync(registerPath, 'utf8'),
      readFileSync(planPath, 'utf8'),
    )
    const parsed = fragmentSchema.parse(input)
    const dispositions = Object.fromEntries(
      [...new Set(parsed.findings.map(({ disposition }) => disposition))]
        .sort()
        .map((disposition) => [
          disposition,
          parsed.findings.filter((finding) => finding.disposition === disposition).length,
        ]),
    )
    process.stdout.write(
      `${JSON.stringify({ fragment: parsed.fragmentId, findings: ids.length, dispositions })}\n`,
    )
    return 0
  } catch (error) {
    process.stderr.write(
      `finding revalidation fragment invalid: ${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 1
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : undefined
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = runFindingRevalidationFragmentCli(process.argv.slice(2))
}
