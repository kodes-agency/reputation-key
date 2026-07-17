// BQC program status — schema-validated machine-readable truth (BQC-0.1).
//
// Historical BQR prose is not live completion status. This manifest is.
// CI and generate-status both load the same schema so acceptance cannot
// be claimed without evidence and an independent reviewer.

import { z } from 'zod/v4'

/** Exact BQC status vocabulary (completion-program README). */
export const BQC_STATES = [
  'not_started',
  'implementation_in_progress',
  'implementation_complete',
  'evidence_pending',
  'accepted',
  'blocked',
] as const

export type BqcState = (typeof BQC_STATES)[number]

export const bqcStateSchema = z.enum(BQC_STATES)

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')

const isoDateTimeSchema = z.string().min(1)

export const bqcEntrySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^BQC-\d+(\.\d+)?$|^BQR-\d+(\.\d+)?$/, 'id must look like BQC-0 or BQR-5.1'),
    kind: z.enum(['phase', 'slice']),
    parentId: z.string().optional(),
    title: z.string().min(1),
    state: bqcStateSchema,
    implementation: z
      .object({
        pr: z.string().optional(),
        sha: z.string().optional(),
      })
      .optional(),
    requiredEvidenceIds: z.array(z.string()).default([]),
    evidenceEnvironment: z.string().optional(),
    releaseIdentity: z.string().optional(),
    owner: z.string().min(1),
    independentReviewer: z.string().optional(),
    openFindings: z.array(z.string()).default([]),
    exceptions: z.array(z.string()).default([]),
    blockedDependency: z.string().optional(),
    nextReviewDate: isoDateSchema.optional(),
    acceptedAt: isoDateTimeSchema.optional(),
    notes: z.string().optional(),
  })
  .superRefine((entry, ctx) => {
    if (entry.state === 'accepted') {
      if (entry.requiredEvidenceIds.length === 0) {
        ctx.addIssue({
          code: 'custom',
          message: `entry ${entry.id}: accepted requires requiredEvidenceIds`,
          path: ['requiredEvidenceIds'],
        })
      }
      if (!entry.independentReviewer) {
        ctx.addIssue({
          code: 'custom',
          message: `entry ${entry.id}: accepted requires independentReviewer`,
          path: ['independentReviewer'],
        })
      }
      if (!entry.acceptedAt) {
        ctx.addIssue({
          code: 'custom',
          message: `entry ${entry.id}: accepted requires acceptedAt`,
          path: ['acceptedAt'],
        })
      }
    }

    if (entry.state === 'blocked') {
      if (!entry.blockedDependency) {
        ctx.addIssue({
          code: 'custom',
          message: `entry ${entry.id}: blocked requires blockedDependency`,
          path: ['blockedDependency'],
        })
      }
      if (!entry.nextReviewDate) {
        ctx.addIssue({
          code: 'custom',
          message: `entry ${entry.id}: blocked requires nextReviewDate`,
          path: ['nextReviewDate'],
        })
      }
    }

    if (entry.kind === 'slice' && !entry.parentId) {
      ctx.addIssue({
        code: 'custom',
        message: `entry ${entry.id}: slice requires parentId`,
        path: ['parentId'],
      })
    }
  })

export type BqcEntry = z.infer<typeof bqcEntrySchema>

export const bqcStatusManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    program: z.literal('BQC'),
    updatedAt: isoDateTimeSchema,
    baseline: z.object({
      validationReport: z.string().min(1),
      /** SHA of the validation starting point (immutable evidence). */
      validationBaselineSha: z.string().min(7),
      /** SHA of the working tree this status describes (may advance). */
      workingTreeSha: z.string().min(7).optional(),
      lockfileSha256: z.string().optional(),
      migrationVersion: z.string().optional(),
      notes: z.string().optional(),
    }),
    entries: z.array(bqcEntrySchema).min(1),
  })
  .superRefine((manifest, ctx) => {
    const ids = new Set<string>()
    for (const entry of manifest.entries) {
      if (ids.has(entry.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate entry id: ${entry.id}`,
          path: ['entries'],
        })
      }
      ids.add(entry.id)
    }

    for (const entry of manifest.entries) {
      if (entry.parentId && !ids.has(entry.parentId)) {
        ctx.addIssue({
          code: 'custom',
          message: `entry ${entry.id}: parentId ${entry.parentId} not found`,
          path: ['entries'],
        })
      }
    }
  })

export type BqcStatusManifest = z.infer<typeof bqcStatusManifestSchema>

export type BqcValidationResult =
  | { ok: true; manifest: BqcStatusManifest }
  | { ok: false; errors: ReadonlyArray<string> }

/** Parse and validate an unknown JSON value as a BQC status manifest. */
export function validateBqcStatusManifest(input: unknown): BqcValidationResult {
  const parsed = bqcStatusManifestSchema.safeParse(input)
  if (parsed.success) {
    return { ok: true, manifest: parsed.data }
  }
  return {
    ok: false,
    errors: parsed.error.issues.map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : '(root)'
      return `${path}: ${issue.message}`
    }),
  }
}

/**
 * Reject invalid state transitions when an entry is updated.
 * Allowed edges are intentionally strict so "accepted" cannot be claimed casually.
 */
export function isAllowedStateTransition(from: BqcState, to: BqcState): boolean {
  if (from === to) return true
  const allowed: Record<BqcState, ReadonlyArray<BqcState>> = {
    not_started: ['implementation_in_progress', 'blocked'],
    implementation_in_progress: [
      'implementation_complete',
      'evidence_pending',
      'blocked',
      'not_started',
    ],
    implementation_complete: ['evidence_pending', 'accepted', 'blocked'],
    evidence_pending: ['accepted', 'implementation_in_progress', 'blocked'],
    accepted: [], // terminal for the entry's lifecycle (new work is a new slice)
    blocked: ['not_started', 'implementation_in_progress', 'evidence_pending'],
  }
  return allowed[from].includes(to)
}

export function assertAllowedStateTransition(from: BqcState, to: BqcState): void {
  if (!isAllowedStateTransition(from, to)) {
    throw new Error(`invalid BQC state transition: ${from} → ${to}`)
  }
}
