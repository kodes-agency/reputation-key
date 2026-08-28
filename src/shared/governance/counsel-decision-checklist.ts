/**
 * Open counsel decisions, extracted from the drafts into addressable items
 * (LEG-01).
 *
 * The four documents under `docs/legal/` name their unresolved questions in
 * prose, scattered across nine paragraphs and two tables. Prose cannot be
 * counted, cannot be assigned, and cannot block anything. This checklist
 * turns each question into a row that carries the exact sentence it came
 * from (`sourceAnchor`, verified verbatim against the document bytes), the
 * repository fact counsel needs in order to answer it, and the documents it
 * blocks — so `legal-document-registry` cannot move a document to `approved`
 * while an item pointing at it is still open.
 *
 * Two hard rules are enforced here rather than trusted:
 *
 * - No item may propose a second Data Cell. Beta is exactly `cell-us`; a
 *   legal question phrased as "and for the europe cell?" would smuggle a
 *   deployment decision into a legal review.
 * - Any item touching a dark capability (Contact Request, Portal upload,
 *   Recognition, Team, Bulk Close, Staff User login, Billing, MFA) must be
 *   tagged `capabilityPosture: 'dark'`, so counsel accepting the wording can
 *   never be read as authorizing the capability to become reachable.
 *
 * Anchors are matched after whitespace normalization: the drafts are
 * hard-wrapped Markdown, so a sentence that reads as one line to a human is
 * split across two in the bytes.
 */

import { z } from 'zod/v4'
import {
  canonicalGovernanceJson,
  LEGAL_DOCUMENT_REGISTRY,
  type LegalDocumentRegistry,
} from './legal-document-registry'

export const COUNSEL_DECISION_CHECKLIST_VERSION =
  'repkey-counsel-decision-checklist-1' as const

export const COUNSEL_DECISION_CHECKLIST_PATH =
  'docs/legal/counsel-decision-checklist.json'

export const COUNSEL_DECISION_CATEGORIES = [
  'roles',
  'lawful_bases',
  'rights',
  'dpia_and_regions',
  'retention_classes',
  'processors_and_transfers',
  'google_terms_and_expiry',
  'staff_metrics',
  'support_terms',
] as const

export type CounselDecisionCategory = (typeof COUNSEL_DECISION_CATEGORIES)[number]

export const CAPABILITY_POSTURES = ['core', 'controlled', 'dark'] as const

/**
 * Capabilities that have no activation path in beta. The patterns are
 * deliberately broad: a false positive costs one honest `dark` tag, a false
 * negative lets an approval read as an activation.
 */
export const DARK_CAPABILITY_TOPICS = Object.freeze([
  { capability: 'Contact Request', pattern: /Contact Requests?/u },
  { capability: 'Portal upload', pattern: /Portal (?:image )?upload/iu },
  { capability: 'Recognition', pattern: /Badge|Leaderboard|Recognition/u },
  { capability: 'Team', pattern: /\bTeams?\b/u },
  { capability: 'Bulk Close', pattern: /Bulk Close/iu },
  { capability: 'Staff User login', pattern: /Staff User login/u },
  { capability: 'Billing', pattern: /\bBilling\b/u },
  { capability: 'MFA', pattern: /\bMFA\b/u },
])

const SECOND_DATA_CELL_PATTERNS: readonly RegExp[] = Object.freeze([
  /cell-eu/iu,
  /cell-global/iu,
  /europe cell/iu,
  /global cell/iu,
])

const factReference = z
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
    'must be a normalized repository-relative reference',
  )

const counselDecisionItemSchema = z
  .object({
    id: z.string().regex(/^[a-z_]+\.[a-z0-9_]+$/u),
    category: z.enum(COUNSEL_DECISION_CATEGORIES),
    question: z.string().trim().min(12).max(512),
    sourceDocument: z.string().min(1).max(64),
    sourceAnchor: z.string().trim().min(8).max(512),
    repositoryFactRef: factReference,
    blocksDocuments: z.array(z.string().min(1).max(64)).min(1),
    capabilityPosture: z.enum(CAPABILITY_POSTURES),
    status: z.enum(['open', 'decided']),
    decision: z.string().trim().min(1).max(2048).nullable(),
    decidedBy: z.string().trim().min(1).max(256).nullable(),
    decidedOn: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/u)
      .nullable(),
    evidenceRef: factReference.nullable(),
  })
  .strict()
  .superRefine((item, context) => {
    if (!item.id.startsWith(`${item.category}.`)) {
      context.addIssue({
        code: 'custom',
        message: `item id must start with its category (${item.category})`,
      })
    }
    if (item.status === 'open') {
      if (
        item.decision !== null ||
        item.decidedBy !== null ||
        item.decidedOn !== null ||
        item.evidenceRef !== null
      ) {
        context.addIssue({
          code: 'custom',
          message: 'open item must not carry a decision record',
        })
      }
      return
    }
    if (
      item.decidedBy === null ||
      item.decidedOn === null ||
      item.evidenceRef === null ||
      item.decision === null
    ) {
      context.addIssue({
        code: 'custom',
        message: 'decided item must carry decidedBy, decidedOn, and evidenceRef',
      })
    }
  })

export type CounselDecisionItem = z.infer<typeof counselDecisionItemSchema>

const counselDecisionChecklistSchema = z
  .object({
    version: z.literal(COUNSEL_DECISION_CHECKLIST_VERSION),
    updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u),
    items: z.array(counselDecisionItemSchema).min(1),
  })
  .strict()
  .superRefine((checklist, context) => {
    const seen = new Set<string>()
    for (const item of checklist.items) {
      if (seen.has(item.id)) {
        context.addIssue({
          code: 'custom',
          message: `duplicate checklist item id: ${item.id}`,
        })
      }
      seen.add(item.id)
    }
    const ids = checklist.items.map((item) => item.id)
    const sorted = [...ids].sort()
    if (ids.some((id, index) => id !== sorted[index])) {
      context.addIssue({ code: 'custom', message: 'checklist item ids must be sorted' })
    }
  })

export type CounselDecisionChecklist = z.infer<typeof counselDecisionChecklistSchema>

/**
 * Sorted-key encoding used for digesting and for building candidate
 * checklists in tests. Unlike the registry artifact, the shipped checklist
 * file is formatter-owned rather than byte-pinned: its authority is the
 * anchor verification below, not its exact bytes.
 */
export function canonicalCounselDecisionChecklist(
  checklist: CounselDecisionChecklist,
): string {
  return canonicalGovernanceJson(checklist)
}

export type CounselDecisionChecklistParseResult =
  | Readonly<{ ok: true; checklist: CounselDecisionChecklist }>
  | Readonly<{ ok: false; errors: readonly string[] }>

export function parseCounselDecisionChecklist(
  content: string,
): CounselDecisionChecklistParseResult {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    return { ok: false, errors: ['counsel decision checklist is not valid JSON'] }
  }
  const parsed = counselDecisionChecklistSchema.safeParse(value)
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'checklist'}: ${issue.message}`,
      ),
    }
  }
  return { ok: true, checklist: Object.freeze(parsed.data) }
}

/** The drafts are hard-wrapped, so an anchor never matches the raw bytes. */
function normalizeProse(value: string): string {
  return value.replace(/\s+/gu, ' ').trim()
}

export type CounselDecisionValidationInput = Readonly<{
  checklist: CounselDecisionChecklist
  registry: LegalDocumentRegistry
  readDocument: (path: string) => Uint8Array
}>

export type CounselDecisionValidationResult =
  Readonly<{ ok: true }> | Readonly<{ ok: false; errors: readonly string[] }>

export function validateCounselDecisionChecklist(
  input: CounselDecisionValidationInput,
): CounselDecisionValidationResult {
  const errors: string[] = []
  const documentText = new Map<string, string>()

  for (const category of COUNSEL_DECISION_CATEGORIES) {
    const open = input.checklist.items.filter(
      (item) => item.category === category && item.status === 'open',
    )
    if (open.length === 0) {
      errors.push(`category ${category} has no extracted decision`)
    }
  }

  const registeredIds = new Set(input.registry.documents.map((document) => document.id))

  for (const item of input.checklist.items) {
    for (const documentId of item.blocksDocuments) {
      if (!registeredIds.has(documentId)) {
        errors.push(`checklist item ${item.id} blocks unknown document ${documentId}`)
      }
    }

    const text = `${item.question} ${item.sourceAnchor}`
    if (SECOND_DATA_CELL_PATTERNS.some((pattern) => pattern.test(text))) {
      errors.push(`checklist item ${item.id} must not propose a second data cell`)
    }
    if (item.capabilityPosture !== 'dark') {
      for (const topic of DARK_CAPABILITY_TOPICS) {
        if (topic.pattern.test(text)) {
          errors.push(
            `checklist item ${item.id} must be tagged capabilityPosture 'dark' (covers ${topic.capability})`,
          )
        }
      }
    }

    const source = input.registry.documents.find(
      (document) => document.id === item.sourceDocument,
    )
    if (source === undefined) {
      errors.push(
        `checklist item ${item.id} references unknown document ${item.sourceDocument}`,
      )
      continue
    }
    let body = documentText.get(source.path)
    if (body === undefined) {
      try {
        body = normalizeProse(new TextDecoder().decode(input.readDocument(source.path)))
      } catch {
        errors.push(`checklist item ${item.id} cannot read ${source.path}`)
        continue
      }
      documentText.set(source.path, body)
    }
    if (!body.includes(normalizeProse(item.sourceAnchor))) {
      errors.push(`checklist item ${item.id} anchor not found in ${item.sourceDocument}`)
    }
  }

  return errors.length > 0 ? { ok: false, errors } : { ok: true }
}

export function openCounselDecisionsBlocking(
  documentId: string,
  checklist: CounselDecisionChecklist = COUNSEL_DECISION_CHECKLIST,
): readonly string[] {
  return checklist.items
    .filter((item) => item.status === 'open' && item.blocksDocuments.includes(documentId))
    .map((item) => item.id)
}

/**
 * A document cannot be approved while a decision that blocks it is open.
 * This is the join between the two artifacts: it is what stops an approval
 * from being recorded ahead of the analysis it depends on.
 */
export function approvalBlockingDecisionErrors(
  registry: LegalDocumentRegistry = LEGAL_DOCUMENT_REGISTRY,
  checklist: CounselDecisionChecklist = COUNSEL_DECISION_CHECKLIST,
): readonly string[] {
  return registry.documents
    .filter((document) => document.status === 'approved')
    .flatMap((document) => {
      const open = openCounselDecisionsBlocking(document.id, checklist)
      if (open.length === 0) return []
      return [
        `cannot approve ${document.id}: ${open.length} open counsel decisions (${open.join(', ')})`,
      ]
    })
}

type OpenItem = Readonly<{
  id: string
  category: CounselDecisionCategory
  question: string
  sourceDocument: string
  sourceAnchor: string
  repositoryFactRef: string
  blocksDocuments: readonly string[]
  capabilityPosture: (typeof CAPABILITY_POSTURES)[number]
}>

const RETENTION_FACT = 'src/shared/jobs/retention-sweep.job.ts'
const RETENTION_SECTION =
  'docs/legal/implementation-facts-2026-08-26.md#4-current-retention-implementation'
const NOTICE_AND_TERMS = ['privacy-notice', 'internal-beta-agreement'] as const

function retentionItem(
  slug: string,
  question: string,
  anchor: string,
  overrides: Partial<OpenItem> = {},
): OpenItem {
  return {
    id: `retention_classes.${slug}`,
    category: 'retention_classes',
    question,
    sourceDocument: 'implementation-facts',
    sourceAnchor: anchor,
    repositoryFactRef: RETENTION_FACT,
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'controlled',
    ...overrides,
  }
}

const OPEN_ITEMS: readonly OpenItem[] = [
  {
    id: 'roles.controller_processor',
    category: 'roles',
    question:
      'Which controller and processor roles apply to Participant, Guest, and Google-sourced data, per party and per data class?',
    sourceDocument: 'privacy-notice',
    sourceAnchor: 'The final notice must state the accepted controller/processor roles',
    repositoryFactRef:
      'docs/legal/implementation-facts-2026-08-26.md#7-acceptance-checklist-outside-engineering-authority',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'roles.parties_and_governing_law',
    category: 'roles',
    question:
      'Who are the contracting parties, and what governing law, authority, and acceptance method bind the closed beta?',
    sourceDocument: 'internal-beta-agreement',
    sourceAnchor:
      'Counsel must finalize the parties, definitions, authority, governing law, and signature/acceptance method',
    repositoryFactRef: 'docs/legal/implementation-facts-2026-08-26.md',
    blocksDocuments: ['internal-beta-agreement'],
    capabilityPosture: 'core',
  },
  {
    id: 'lawful_bases.always_on_core_analytics',
    category: 'lawful_bases',
    question:
      'What lawful basis covers core operational analytics that a Participant cannot decline while continuing to use the workflow?',
    sourceDocument: 'privacy-notice',
    sourceAnchor:
      'Core analytics are part of the Service and do not have a product toggle to decline collection',
    repositoryFactRef: 'src/shared/governance/capability-fate.ts',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'lawful_bases.guest_private_rating',
    category: 'lawful_bases',
    question:
      'What lawful basis and notice cover the private Guest rating and optional private feedback collected before any Google action?',
    sourceDocument: 'privacy-notice',
    sourceAnchor: 'The private rating is not a Google rating and is not sent to Google',
    repositoryFactRef:
      'docs/legal/implementation-facts-2026-08-26.md#2-portal-and-guest-journey',
    blocksDocuments: [
      'privacy-notice',
      'internal-beta-agreement',
      'google-access-disclosure',
    ],
    capabilityPosture: 'controlled',
  },
  {
    id: 'rights.request_channel',
    category: 'rights',
    question:
      'What is the verified request channel, identity check, response time, exception set, and appeal path for data-subject requests?',
    sourceDocument: 'privacy-notice',
    sourceAnchor: 'The final notice must name the verified request channel',
    repositoryFactRef: 'src/shared/observability/beta-support-operations.ts',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'rights.export_promise',
    category: 'rights',
    question:
      'What portability commitment may the notice make while the full Organization Export workflow is inactive?',
    sourceDocument: 'privacy-notice',
    sourceAnchor: 'this draft does not promise an unavailable self-service export',
    repositoryFactRef: 'docs/legal/implementation-facts-2026-08-26.md',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'controlled',
  },
  {
    id: 'rights.contact_request_consent',
    category: 'rights',
    question:
      'What consent, notice, access, and withdrawal contract would a Contact Request need before it could ever be considered?',
    sourceDocument: 'privacy-notice',
    sourceAnchor:
      'Contact Request remains disabled until its separate consent and withdrawal contract is accepted',
    repositoryFactRef: 'src/shared/governance/capability-fate.ts',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'dark',
  },
  {
    id: 'dpia_and_regions.single_us_cell',
    category: 'dpia_and_regions',
    question:
      'Does routing every supported country to the single US Data Cell require an impact assessment or additional notice wording?',
    sourceDocument: 'privacy-notice',
    sourceAnchor: 'The target beta topology is exactly one Railway Data Cell, `cell-us`',
    repositoryFactRef: 'src/shared/domain/data-cell-catalogue.ts',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'dpia_and_regions.live_placement_evidence',
    category: 'dpia_and_regions',
    question:
      'What live placement evidence must be retained before the notice may describe where processing actually happens?',
    sourceDocument: 'privacy-notice',
    sourceAnchor: 'This target is not proof of current live placement',
    repositoryFactRef:
      'docs/legal/implementation-facts-2026-08-26.md#5-deployment-and-subprocessor-facts',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'dpia_and_regions.transfer_record',
    category: 'dpia_and_regions',
    question:
      'Which transfer mechanism and data-flow record cover Participants and Guests outside the United States?',
    sourceDocument: 'privacy-notice',
    sourceAnchor: 'Do not infer those facts from repository configuration alone',
    repositoryFactRef: 'docs/security/data-inventory.md',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'processors_and_transfers.provider_schedule',
    category: 'processors_and_transfers',
    question:
      'Which named providers, regions, and retention settings belong in the accepted subprocessor schedule?',
    sourceDocument: 'privacy-notice',
    sourceAnchor:
      'The final provider schedule must identify actual monitoring, email, hosting, database, cache/queue, object-storage, and AI providers and their configured regions and retention',
    repositoryFactRef: 'docs/security/data-inventory.md',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'processors_and_transfers.monitoring_region',
    category: 'processors_and_transfers',
    question:
      'Is the error-monitoring provider, its region, and its event retention acceptable as a named subprocessor?',
    sourceDocument: 'implementation-facts',
    sourceAnchor: 'rejects a non-Germany Sentry ingestion host',
    repositoryFactRef:
      'docs/legal/implementation-facts-2026-08-26.md#4a-error-monitoring-and-native-beta-feedback',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'processors_and_transfers.ai_provider_terms',
    category: 'processors_and_transfers',
    question:
      'Do the AI provider terms satisfy the no-training, minimum-retention, and regional commitments the drafts state?',
    sourceDocument: 'google-access-disclosure',
    sourceAnchor:
      'The provider must not train on the submitted data and must use the approved minimum-retention and regional configuration',
    repositoryFactRef:
      'docs/legal/implementation-facts-2026-08-26.md#3-ai-and-google-sourced-content',
    blocksDocuments: ['privacy-notice', 'google-access-disclosure'],
    capabilityPosture: 'controlled',
  },
  {
    id: 'google_terms_and_expiry.scope',
    category: 'google_terms_and_expiry',
    question:
      'Does the release stay inside the exact scope and conditions of the written Google Business Profile API Support response?',
    sourceDocument: 'google-access-disclosure',
    sourceAnchor:
      'the exact scope and conditions of that response reviewed against the release',
    repositoryFactRef:
      'docs/legal/implementation-facts-2026-08-26.md#3-ai-and-google-sourced-content',
    blocksDocuments: ['internal-beta-agreement', 'google-access-disclosure'],
    capabilityPosture: 'controlled',
  },
  {
    id: 'google_terms_and_expiry.change_monitoring_owner',
    category: 'google_terms_and_expiry',
    question:
      'Who owns rechecking Google public policy per material release, and when does the recorded review expire?',
    sourceDocument: 'google-access-disclosure',
    sourceAnchor: 'The release owner must recheck it for each material release',
    repositoryFactRef: 'docs/legal/implementation-facts-2026-08-26.md',
    blocksDocuments: ['google-access-disclosure'],
    capabilityPosture: 'controlled',
  },
  {
    id: 'google_terms_and_expiry.source_content_horizon',
    category: 'google_terms_and_expiry',
    question:
      'Is the 30-day provider source-content horizon acceptable as a published commitment before recurring production erasure is live?',
    sourceDocument: 'google-access-disclosure',
    sourceAnchor: 'a maximum of 30 calendar days from the latest successful fetch',
    repositoryFactRef: 'docs/operations/review-source-content-cutover.md',
    blocksDocuments: ['privacy-notice', 'google-access-disclosure'],
    capabilityPosture: 'controlled',
  },
  {
    id: 'staff_metrics.attribution_wording',
    category: 'staff_metrics',
    question:
      'What staff-attribution, manager-monitoring, and dispute wording must the participant notice carry?',
    sourceDocument: 'internal-beta-agreement',
    sourceAnchor:
      'The final agreement and participant notice must explain any staff attribution',
    repositoryFactRef: 'src/shared/governance/capability-fate.ts',
    blocksDocuments: NOTICE_AND_TERMS,
    capabilityPosture: 'core',
  },
  {
    id: 'staff_metrics.employment_use_prohibition',
    category: 'staff_metrics',
    question:
      'Is the employment-use prohibition enforceable as drafted in the jurisdictions the cohort operates in?',
    sourceDocument: 'internal-beta-agreement',
    sourceAnchor:
      'used as the sole basis for hiring, termination, discipline, compensation',
    repositoryFactRef: 'src/shared/governance/capability-fate.ts',
    blocksDocuments: ['internal-beta-agreement'],
    capabilityPosture: 'core',
  },
  {
    id: 'staff_metrics.recognition_retained_only',
    category: 'staff_metrics',
    question:
      'How must the agreement describe retained competitive scoring code that has no activation path?',
    sourceDocument: 'internal-beta-agreement',
    sourceAnchor: 'competitive Badge/Leaderboard behavior',
    repositoryFactRef: 'src/shared/governance/capability-fate.ts',
    blocksDocuments: ['internal-beta-agreement'],
    capabilityPosture: 'dark',
  },
  {
    id: 'support_terms.service_and_liability',
    category: 'support_terms',
    question:
      'Which service levels, support hours, recovery objectives, warranties, and liability limits are accepted for this exact release?',
    sourceDocument: 'internal-beta-agreement',
    sourceAnchor:
      'The final agreement must state only service levels, support hours, recovery objectives, warranties, disclaimers, and liability terms that counsel and operations have accepted',
    repositoryFactRef: 'src/shared/observability/beta-support-operations.ts',
    blocksDocuments: ['internal-beta-agreement'],
    capabilityPosture: 'core',
  },
  {
    id: 'support_terms.beta_triage_ownership',
    category: 'support_terms',
    question:
      'May a single-owner triage and incident-communication policy be stated as a beta commitment, and with what qualifiers?',
    sourceDocument: 'implementation-facts',
    sourceAnchor:
      'Local support policy assigns the beta triage, incident, and communications roles to Bozhidar Denev for the closed beta',
    repositoryFactRef: 'src/shared/observability/beta-support-operations.ts',
    blocksDocuments: ['internal-beta-agreement'],
    capabilityPosture: 'core',
  },
  retentionItem(
    'guest_response_session_binding',
    'Is a 24-hour absolute expiry for the Guest response session and destination-action receipt acceptable as a published horizon?',
    'Guest response session binding and destination-action receipt',
  ),
  retentionItem(
    'guest_private_feedback_text',
    'Is 90 days acceptable for private Guest feedback text, given the 24-hour withdrawal window?',
    'Guest private-feedback text',
  ),
  retentionItem(
    'canonical_guest_response_fact',
    'Is 24 calendar months acceptable for the de-identified Guest response fact and its tombstone?',
    'Canonical de-identified Guest response fact/tombstone',
  ),
  retentionItem(
    'guest_session_pseudonyms',
    'Is 24-hour redaction of the Guest session diagnostic pseudonym sufficient de-identification?',
    'Guest session pseudonyms',
  ),
  retentionItem(
    'guest_network_pressure_records',
    'Is the keyed seven-day network-pressure pseudonym acceptable as abuse-prevention processing?',
    'Guest network-pressure records',
  ),
  retentionItem(
    'published_outbox_facts',
    'Is 30 days acceptable for published outbox facts, consumer receipts, sync runs, and inbound webhook receipts?',
    'Published outbox facts, consumer receipts, sync/refresh runs, inbound webhook receipts',
  ),
  retentionItem(
    'terminal_notification_evidence',
    'Is 90 days acceptable for terminal notification, email, and digest evidence while open retry work is retained?',
    'Terminal notifications, terminal email work, and terminal digest evidence',
  ),
  retentionItem(
    'recent_activity_storage',
    'Is 90 days acceptable for Recent Activity, which carries actor labels?',
    'Recent Activity storage',
  ),
  retentionItem(
    'policy_decision_records',
    'Is 365 days acceptable for policy-decision and significant-action records held under legitimate interest?',
    'Policy-decision and significant-action records',
  ),
  retentionItem(
    'expiring_google_cache',
    'Is the per-row expiry of the Google cache consistent with the provider terms the disclosure states?',
    'Expiring Google cache',
    { blocksDocuments: ['privacy-notice', 'google-access-disclosure'] },
  ),
  retentionItem(
    'retention_run_evidence',
    'May retention-run evidence be kept indefinitely, and what content-free bound must the notice state?',
    'Retention-run evidence',
  ),
  retentionItem(
    'unresolved_base_guest_metric_facts',
    'What horizon applies to base Guest visit and destination facts that outlive the response session?',
    'base Guest visit/destination facts, legacy Guest rows, account/member deletion',
    { sourceDocument: 'privacy-notice', repositoryFactRef: RETENTION_SECTION },
  ),
  retentionItem(
    'unresolved_account_deletion',
    'What happens to account and member records on deletion, and over what period?',
    'account deletion',
    { repositoryFactRef: RETENTION_SECTION },
  ),
  retentionItem(
    'unresolved_manager_authored_content',
    'What horizon applies to manager-authored replies, Inbox notes, and other deliberate manager text?',
    'manager-authored content',
    { repositoryFactRef: RETENTION_SECTION },
  ),
  retentionItem(
    'unresolved_portal_publication_history',
    'How long may Portal configuration and publication history be retained as experience evidence?',
    'Portal configuration/publication history',
    { repositoryFactRef: RETENTION_SECTION },
  ),
  retentionItem(
    'unresolved_inbox_content',
    'What horizon applies to Inbox workflow content that is derived from provider source content?',
    'Inbox content',
    {
      repositoryFactRef: RETENTION_SECTION,
      blocksDocuments: [
        'privacy-notice',
        'internal-beta-agreement',
        'google-access-disclosure',
      ],
    },
  ),
  retentionItem(
    'unresolved_contact_requests',
    'What retention would apply to a capability that is currently disabled and unreachable?',
    'Contact Requests',
    { repositoryFactRef: RETENTION_SECTION, capabilityPosture: 'dark' },
  ),
  retentionItem(
    'unresolved_provider_reply_text',
    'How long may provider reply text be retained separately from the expiring source-content cache?',
    'provider reply text',
    {
      repositoryFactRef: RETENTION_SECTION,
      blocksDocuments: ['privacy-notice', 'google-access-disclosure'],
    },
  ),
  retentionItem(
    'unresolved_restored_backups',
    'How are deletion promises honoured in restored backups, and what does the notice say about that gap?',
    'restored backups',
    { repositoryFactRef: RETENTION_SECTION },
  ),
  retentionItem(
    'unresolved_legacy_compatibility_rows',
    'What lifecycle applies to retained legacy compatibility rows that no active writer produces?',
    'legacy compatibility rows',
    { repositoryFactRef: RETENTION_SECTION },
  ),
]

/**
 * Every item ships open: this artifact records what counsel must decide, and
 * Engineering has no authority to pre-answer any of it.
 */
export const COUNSEL_DECISION_CHECKLIST: CounselDecisionChecklist = Object.freeze(
  counselDecisionChecklistSchema.parse({
    version: COUNSEL_DECISION_CHECKLIST_VERSION,
    updatedAt: '2026-08-28',
    items: [...OPEN_ITEMS]
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
      .map((item) => ({
        ...item,
        blocksDocuments: [...item.blocksDocuments],
        status: 'open',
        decision: null,
        decidedBy: null,
        decidedOn: null,
        evidenceRef: null,
      })),
  }),
)
