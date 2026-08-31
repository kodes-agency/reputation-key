/**
 * The immutable candidate freeze record (REL-01-T9).
 *
 * REL-01 candidate creation step 1 says: "Freeze dependencies, generated
 * artifacts, migration heads, Data Cell catalogue, IaC revision, capability
 * manifest, browser versions, and legal document revisions." Nothing in the
 * repository produced that list, so "the candidate" was whatever the operator
 * happened to have checked out when they ran the next command.
 *
 * This record is the pin. Every field is a digest or a version of something
 * that can silently move between the moment a candidate is declared and the
 * moment it is promoted — the lockfile, the migration head, the generated
 * route tree, the release controller's own source, the Railway IaC graph, the
 * capability and Data Cell catalogue policy versions, the browser the
 * deployed-journey runner will drive, and the legal revision set.
 *
 * `cells` is the exact tuple `['us']`. Beta is one logical US Data Cell; a
 * freeze that names a second cell is describing a different program.
 */

import { z } from 'zod/v4'
import { CAPABILITY_POLICY_VERSION } from '../auth/beta-capabilities'
import { DATA_CELL_CATALOGUE_POLICY_VERSION } from '../domain/data-cell-catalogue'
import {
  canonicalReleaseEvidence,
  parseCanonicalReleaseEvidence,
  releaseEvidenceIdentitySchema,
  releaseEvidenceSha256Schema,
  releaseEvidenceSourceRevisionSchema,
  releaseEvidenceTimestampSchema,
  type CanonicalReleaseEvidenceParseResult,
} from './candidate-bound-evidence'

export const CANDIDATE_FREEZE_RECORD_VERSION = 'repkey-candidate-freeze-1' as const

/**
 * The generated-artifact gates that must be re-run at freeze time. A freeze
 * taken while a generated fixture is stale pins a candidate that CI will
 * reject, or worse, one whose committed artifacts do not describe its code.
 */
export const REQUIRED_FREEZE_DRIFT_GATES = [
  'check:ai-governance-artifacts',
  'check:google-provider-fixtures',
  'check:schema-drift',
] as const

const MIGRATION_TAG = /^[0-9]{4}_[a-z0-9_]{1,120}$/u
// Deliberately non-backtracking: the pre-release tail is a single bounded
// character class rather than a nested group, so a long adversarial version
// string cannot blow up the matcher.
const SEMVER_LIKE = /^[0-9]{1,9}\.[0-9]{1,9}\.[0-9]{1,9}[0-9A-Za-z.-]{0,64}$/u

const browserSchema = z
  .object({
    name: z.enum(['chromium', 'firefox', 'webkit']),
    version: z.string().trim().min(1).max(128),
  })
  .strict()

const candidateFreezeRecordSchema = z
  .object({
    version: z.literal(CANDIDATE_FREEZE_RECORD_VERSION),
    evidenceKind: z.literal('candidate-freeze'),
    releaseSha: releaseEvidenceSourceRevisionSchema,
    frozenAt: releaseEvidenceTimestampSchema,
    frozenBy: releaseEvidenceIdentitySchema,
    changeRecord: releaseEvidenceIdentitySchema,
    cells: z.tuple([z.literal('us')]),
    dependencies: z
      .object({
        lockfilePath: z.literal('pnpm-lock.yaml'),
        lockfileSha256: releaseEvidenceSha256Schema,
        nodeVersion: z.string().regex(SEMVER_LIKE),
        packageManager: z.string().trim().min(1).max(64),
      })
      .strict(),
    migrations: z
      .object({
        journalPath: z.literal('drizzle/meta/_journal.json'),
        journalSha256: releaseEvidenceSha256Schema,
        migrationHead: z.string().regex(MIGRATION_TAG),
        entryCount: z.number().int().safe().positive(),
      })
      .strict(),
    generatedArtifacts: z
      .object({
        routeTreePath: z.literal('src/routeTree.gen.ts'),
        routeTreeSha256: releaseEvidenceSha256Schema,
        /** The drift gates that must report clean for the freeze to stand. */
        driftGates: z
          .array(
            z
              .object({
                script: z.string().trim().min(1).max(128),
                outcome: z.literal('clean'),
              })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    authority: z
      .object({
        releaseControllerSha256: releaseEvidenceSha256Schema,
        iacSha256: releaseEvidenceSha256Schema,
      })
      .strict(),
    policy: z
      .object({
        capabilityPolicyVersion: z.literal(CAPABILITY_POLICY_VERSION),
        dataCellCataloguePolicyVersion: z.literal(DATA_CELL_CATALOGUE_POLICY_VERSION),
      })
      .strict(),
    browsers: z
      .object({
        playwrightPackageVersion: z.string().regex(SEMVER_LIKE),
        installed: z.array(browserSchema).min(1),
      })
      .strict(),
    legalRevisionSetSha256: releaseEvidenceSha256Schema,
  })
  .strict()
  .superRefine((value, context) => {
    const names = value.browsers.installed.map(({ name }) => name)
    if (new Set(names).size !== names.length) {
      context.addIssue({
        code: 'custom',
        path: ['browsers', 'installed'],
        message: 'duplicate browser entry',
      })
    }
    const scripts = value.generatedArtifacts.driftGates.map(({ script }) => script)
    if (new Set(scripts).size !== scripts.length) {
      context.addIssue({
        code: 'custom',
        path: ['generatedArtifacts', 'driftGates'],
        message: 'duplicate drift gate',
      })
    }
    for (const required of REQUIRED_FREEZE_DRIFT_GATES) {
      if (!scripts.includes(required)) {
        context.addIssue({
          code: 'custom',
          path: ['generatedArtifacts', 'driftGates'],
          message: `missing required drift gate ${required}`,
        })
      }
    }
  })

export type CandidateFreezeRecord = z.infer<typeof candidateFreezeRecordSchema>

export function canonicalCandidateFreezeRecord(value: CandidateFreezeRecord): string {
  return canonicalReleaseEvidence(value)
}

export function parseCandidateFreezeRecord(
  content: string,
): CanonicalReleaseEvidenceParseResult<CandidateFreezeRecord> {
  return parseCanonicalReleaseEvidence({
    content,
    schema: candidateFreezeRecordSchema,
    label: 'Candidate freeze record',
  })
}

/** The canonical freeze artifact path for a candidate. */
export function candidateFreezeRecordPath(releaseSha: string): string {
  return `docs/release-evidence/beta/freeze/${releaseSha}.json`
}
