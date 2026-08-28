/**
 * Machine-readable legal document registry (LEG-01).
 *
 * Counsel approval was previously representable only as prose inside the
 * drafts themselves, so nothing in the repository could answer "is this
 * document approved, by whom, over which exact bytes?" — and nothing could
 * fail when the answer was "no". This module makes that record addressable:
 * every file under `docs/legal/` has one row carrying its id, version,
 * status, byte digest and — only once counsel has actually signed — the
 * effective/review/expiry dates, the named approver, and the approval
 * evidence reference.
 *
 * Two shapes of dishonesty are rejected structurally rather than by review:
 * a `draft` row that carries approval fields (an approval that never
 * happened) and an `approved` row that is missing any of them (an approval
 * that cannot be audited). The digest and the self-approval refusal live in
 * `legal-approval-authority.ts`, which needs the document bytes and the
 * current time; this module stays a pure artifact contract.
 *
 * The registry is declared here and mirrored to
 * `docs/legal/legal-document-registry.json` in canonical bytes so that
 * runtime code never reads `docs/` and a human reviewing the diff sees the
 * status change. The paired test asserts the two cannot drift.
 */

import { createHash } from 'node:crypto'
import { z } from 'zod/v4'

export const LEGAL_DOCUMENT_REGISTRY_VERSION = 'repkey-legal-document-registry-1' as const

export const LEGAL_DOCUMENT_REGISTRY_PATH = 'docs/legal/legal-document-registry.json'

/** Directory the registry must describe exhaustively. */
export const LEGAL_DOCUMENT_DIRECTORY = 'docs/legal'

export const LEGAL_DOCUMENT_KINDS = [
  /** Customer-facing text that only external counsel may approve. */
  'counsel_approved',
  /** Frozen copy shown inside the product and pinned by a digest. */
  'in_product_notice',
  /** Engineering input for counsel; never published as legal text. */
  'engineering_fact_map',
] as const

export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number]

export const LEGAL_APPROVER_ROLES = [
  'external_counsel',
  'engineering',
  'product',
  'security',
  'operations',
] as const

export type LegalApproverRole = (typeof LEGAL_APPROVER_ROLES)[number]

export const LEGAL_DOCUMENT_STATUSES = ['draft', 'approved'] as const

export type LegalDocumentStatus = (typeof LEGAL_DOCUMENT_STATUSES)[number]

const sha256Pattern = z.string().regex(/^[0-9a-f]{64}$/u)
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u)
const isoTimestamp = z.iso.datetime({ offset: false })
const boundedIdentity = z.string().trim().min(1).max(256)

/**
 * Same containment rules the release evidence bundle applies
 * (src/shared/release/gate-f-evidence.ts): a registry entry must not be able
 * to reach outside the repository tree to claim a digest.
 */
const safeEvidencePath = z
  .string()
  .min(1)
  .max(512)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !value.includes('\\') &&
      !value.split('/').includes('..') &&
      !value.split('/').includes('.') &&
      !value.split('/').includes(''),
    'must be a normalized relative path without empty or parent segments',
  )

const approverSchema = z
  .object({
    name: boundedIdentity,
    role: z.enum(LEGAL_APPROVER_ROLES),
    organization: boundedIdentity,
  })
  .strict()

export type LegalApprover = z.infer<typeof approverSchema>

const APPROVAL_FIELDS = [
  'effectiveFrom',
  'approvedAt',
  'approver',
  'approvalEvidenceRef',
  'reviewDueOn',
  'expiresOn',
] as const

const legalDocumentSchema = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]{2,63}$/u),
    kind: z.enum(LEGAL_DOCUMENT_KINDS),
    title: z.string().trim().min(1).max(256),
    path: safeEvidencePath,
    version: z.string().trim().min(1).max(64),
    status: z.enum(LEGAL_DOCUMENT_STATUSES),
    sha256: sha256Pattern,
    effectiveFrom: calendarDate.nullable(),
    reviewDueOn: calendarDate.nullable(),
    expiresOn: calendarDate.nullable(),
    approvedAt: isoTimestamp.nullable(),
    approver: approverSchema.nullable(),
    approvalEvidenceRef: safeEvidencePath.nullable(),
  })
  .strict()
  .superRefine((document, context) => {
    if (document.status === 'draft') {
      const carried = APPROVAL_FIELDS.some((field) => document[field] !== null)
      if (carried) {
        context.addIssue({
          code: 'custom',
          message: 'draft document must not carry approval fields',
        })
      }
      return
    }
    for (const field of APPROVAL_FIELDS) {
      if (document[field] === null) {
        context.addIssue({
          code: 'custom',
          message: `approved document must carry ${field}`,
        })
      }
    }
    const { effectiveFrom, reviewDueOn, expiresOn } = document
    if (effectiveFrom !== null && reviewDueOn !== null && effectiveFrom > reviewDueOn) {
      context.addIssue({
        code: 'custom',
        message: 'effectiveFrom must be on or before reviewDueOn',
      })
    }
    if (reviewDueOn !== null && expiresOn !== null && reviewDueOn > expiresOn) {
      context.addIssue({
        code: 'custom',
        message: 'reviewDueOn must be on or before expiresOn',
      })
    }
  })

export type LegalDocument = z.infer<typeof legalDocumentSchema>

const legalDocumentRegistrySchema = z
  .object({
    version: z.literal(LEGAL_DOCUMENT_REGISTRY_VERSION),
    updatedAt: calendarDate,
    documents: z.array(legalDocumentSchema).min(1),
  })
  .strict()
  .superRefine((registry, context) => {
    const seen = new Set<string>()
    for (const document of registry.documents) {
      if (seen.has(document.id)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate legal document id: ${document.id}`,
        })
      }
      seen.add(document.id)
    }
    const ids = registry.documents.map((document) => document.id)
    const sorted = [...ids].sort()
    if (ids.some((id, index) => id !== sorted[index])) {
      context.addIssue({ code: 'custom', message: 'legal document ids must be sorted' })
    }
    const paths = new Set<string>()
    for (const document of registry.documents) {
      if (paths.has(document.path)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate legal document path: ${document.path}`,
        })
      }
      paths.add(document.path)
    }
  })

export type LegalDocumentRegistry = z.infer<typeof legalDocumentRegistrySchema>

type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

function sortedJson(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortedJson)
  if (value !== null && typeof value === 'object') {
    const record = value as Readonly<Record<string, JsonValue>>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, sortedJson(record[key] ?? null)]),
    )
  }
  return value
}

/**
 * Canonical bytes: sorted keys, two-space indentation, one trailing newline.
 * Indentation is part of the canonical form on purpose — these artifacts live
 * in `docs/`, which the formatter owns, and a compact encoding would be
 * reformatted on the next `pnpm format` and silently break its own digest.
 */
export function canonicalGovernanceJson(value: unknown): string {
  return `${JSON.stringify(sortedJson(value as JsonValue), null, 2)}\n`
}

export function canonicalLegalDocumentRegistry(registry: LegalDocumentRegistry): string {
  return canonicalGovernanceJson(registry)
}

export function legalDocumentSha256(content: string | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export type LegalDocumentRegistryParseResult =
  | Readonly<{ ok: true; registry: LegalDocumentRegistry }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function parseLegalDocumentRegistry(
  content: string,
): LegalDocumentRegistryParseResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['legal document registry is not valid JSON'] }
  }
  const parsed = legalDocumentRegistrySchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'registry'}: ${issue.message}`,
      ),
    }
  }
  if (content !== canonicalLegalDocumentRegistry(parsed.data)) {
    return {
      ok: false,
      errors: ['legal document registry must use canonical JSON encoding'],
    }
  }
  return { ok: true, registry: Object.freeze(parsed.data) }
}

export function findLegalDocument(
  id: string,
  registry: LegalDocumentRegistry = LEGAL_DOCUMENT_REGISTRY,
): LegalDocument | undefined {
  return registry.documents.find((document) => document.id === id)
}

const UNAPPROVED = {
  effectiveFrom: null,
  reviewDueOn: null,
  expiresOn: null,
  approvedAt: null,
  approver: null,
  approvalEvidenceRef: null,
} as const

/**
 * The shipped registry. Every counsel-owned row is a draft with a null
 * approver: moving one to `approved` requires the named external counsel,
 * the evidence reference, and the dates, so the change is a reviewable diff
 * rather than an implicit consequence of editing prose.
 */
export const LEGAL_DOCUMENT_REGISTRY: LegalDocumentRegistry = Object.freeze(
  legalDocumentRegistrySchema.parse({
    version: LEGAL_DOCUMENT_REGISTRY_VERSION,
    updatedAt: '2026-08-28',
    documents: [
      {
        id: 'google-access-disclosure',
        kind: 'counsel_approved',
        title: 'Google Business Profile Access Disclosure',
        path: 'docs/legal/google-access-disclosure.md',
        version: '2.0-draft',
        status: 'draft',
        sha256: 'a5a47c263b50c322f7583a4ab47567a821ec68555ff5b106ab0a1fe6b44a6cd3',
        ...UNAPPROVED,
      },
      {
        id: 'implementation-facts',
        kind: 'engineering_fact_map',
        title: 'Engineering implementation facts for legal and release review',
        path: 'docs/legal/implementation-facts-2026-08-26.md',
        version: '2026-08-28',
        status: 'draft',
        sha256: 'bff0a58b6d7e380ccf4e6cd2f3ced5eca12d1b526684e440471d57b69a30fb76',
        ...UNAPPROVED,
      },
      {
        id: 'internal-beta-agreement',
        kind: 'counsel_approved',
        title: 'Closed Beta Participation Agreement — Reputation Key',
        path: 'docs/legal/internal-beta-agreement.md',
        version: '2.0-draft',
        status: 'draft',
        sha256: '4a5de42eef4bcca86bcd7ba5d2a878dc7105b92d04055ac736095e3d0e61b9b5',
        ...UNAPPROVED,
      },
      {
        id: 'legal-revision-set-schema',
        kind: 'engineering_fact_map',
        title: 'Release legal artifacts — schema reference',
        path: 'docs/legal/revision-set.schema.md',
        version: '2026-08-28',
        status: 'draft',
        sha256: 'a2d6ee3509d6e72f8d3ef637468ca5535aabaebc4b260e70a1e9d915d7b39bb0',
        ...UNAPPROVED,
      },
      {
        id: 'privacy-notice',
        kind: 'counsel_approved',
        title: 'Privacy Notice — Reputation Key Closed Beta',
        path: 'docs/legal/privacy-notice.md',
        version: '2.0-draft',
        status: 'draft',
        sha256: '26eabaadb01a32a0ce1c0e0baa4056fd70e6795fdc628978770ca922352a2c41',
        ...UNAPPROVED,
      },
    ],
  }),
)
