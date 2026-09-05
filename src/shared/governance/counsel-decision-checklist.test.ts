import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { LEGAL_DOCUMENT_REGISTRY } from './legal-document-registry'
import {
  approvalBlockingDecisionErrors,
  canonicalCounselDecisionChecklist,
  COUNSEL_DECISION_CATEGORIES,
  COUNSEL_DECISION_CHECKLIST,
  COUNSEL_DECISION_CHECKLIST_PATH,
  type CounselDecisionItem,
  openCounselDecisionsBlocking,
  parseCounselDecisionChecklist,
  validateCounselDecisionChecklist,
} from './counsel-decision-checklist'

const ROOT = resolve(import.meta.dirname, '../../..')

const readDocument = (path: string): Uint8Array => readFileSync(resolve(ROOT, path))

const items = COUNSEL_DECISION_CHECKLIST.items

const validate = (
  candidateItems: readonly CounselDecisionItem[] = items,
): readonly string[] => {
  const result = validateCounselDecisionChecklist({
    checklist: { ...COUNSEL_DECISION_CHECKLIST, items: [...candidateItems] },
    registry: LEGAL_DOCUMENT_REGISTRY,
    readDocument,
  })
  return result.ok ? [] : result.errors
}

const idsIn = (category: string): readonly string[] =>
  items.filter((item) => item.category === category).map((item) => item.id)

describe('counsel decision checklist', () => {
  it('ships an artifact that parses to exactly the runtime constant', () => {
    const bytes = readFileSync(resolve(ROOT, COUNSEL_DECISION_CHECKLIST_PATH), 'utf8')
    const parsed = parseCounselDecisionChecklist(bytes)

    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(canonicalCounselDecisionChecklist(parsed.checklist)).toBe(
      canonicalCounselDecisionChecklist(COUNSEL_DECISION_CHECKLIST),
    )
  })

  it('covers exactly the nine counsel decision categories', () => {
    expect(COUNSEL_DECISION_CATEGORIES).toEqual([
      'roles',
      'lawful_bases',
      'rights',
      'dpia_and_regions',
      'retention_classes',
      'processors_and_transfers',
      'google_terms_and_expiry',
      'staff_metrics',
      'support_terms',
    ])
  })

  it('extracts at least one decision for every category', () => {
    for (const category of COUNSEL_DECISION_CATEGORIES) {
      expect(items.filter((item) => item.category === category)).not.toEqual([])
    }
  })

  it('accepts a category whose extracted decisions are all decided', () => {
    const withDecidedRoles = items.map((item) =>
      item.category === 'roles'
        ? {
            ...item,
            status: 'decided' as const,
            decision: 'Accepted as written.',
            decidedBy: 'External Counsel',
            decidedOn: '2026-09-03',
            evidenceRef: item.repositoryFactRef,
          }
        : item,
    )

    expect(validate(withDecidedRoles)).toEqual([])
  })

  it('fails when a category has no extracted decision', () => {
    const withoutRoles = items.filter((item) => item.category !== 'roles')

    expect(validate(withoutRoles)).toContain('category roles has no extracted decision')
  })

  it('anchors every item on text that is literally present in its source document', () => {
    expect(validate()).toEqual([])
    for (const item of items) {
      expect(item.question.length).toBeGreaterThan(0)
      expect(LEGAL_DOCUMENT_REGISTRY.documents.map((document) => document.id)).toContain(
        item.sourceDocument,
      )
    }
  })

  it('fails an item whose anchor is not in the document it names', () => {
    const invented: CounselDecisionItem = {
      ...items[0]!,
      sourceAnchor: 'counsel has already accepted every open question',
    }

    expect(validate([invented, ...items.slice(1)])).toContain(
      `checklist item ${invented.id} anchor not found in ${invented.sourceDocument}`,
    )
  })

  it('points every item at a repository fact that exists on disk', () => {
    for (const item of items) {
      const path = item.repositoryFactRef.split('#')[0]!
      expect(existsSync(resolve(ROOT, path)), `missing fact ref: ${path}`).toBe(true)
    }
  })

  it('keeps one retention decision per enforced and per unresolved class', () => {
    expect(idsIn('retention_classes')).toEqual([
      'retention_classes.canonical_guest_response_fact',
      'retention_classes.expiring_google_cache',
      'retention_classes.guest_network_pressure_records',
      'retention_classes.guest_private_feedback_text',
      'retention_classes.guest_response_session_binding',
      'retention_classes.guest_session_pseudonyms',
      'retention_classes.policy_decision_records',
      'retention_classes.published_outbox_facts',
      'retention_classes.recent_activity_storage',
      'retention_classes.retention_run_evidence',
      'retention_classes.terminal_notification_evidence',
      'retention_classes.unresolved_account_deletion',
      'retention_classes.unresolved_base_guest_metric_facts',
      'retention_classes.unresolved_contact_requests',
      'retention_classes.unresolved_inbox_content',
      'retention_classes.unresolved_legacy_compatibility_rows',
      'retention_classes.unresolved_manager_authored_content',
      'retention_classes.unresolved_portal_publication_history',
      'retention_classes.unresolved_provider_reply_text',
      'retention_classes.unresolved_restored_backups',
    ])
  })

  it('records every decision as open with no decision recorded today', () => {
    expect(
      items.filter(
        (item) =>
          item.status !== 'open' ||
          item.decision !== null ||
          item.decidedBy !== null ||
          item.decidedOn !== null ||
          item.evidenceRef !== null,
      ),
    ).toEqual([])
  })

  it('refuses a decided item that carries no decision evidence', () => {
    const halfDecided = {
      ...items[0]!,
      status: 'decided',
      decision: 'Accepted as drafted.',
      decidedBy: null,
      decidedOn: null,
      evidenceRef: null,
    }
    const content = canonicalCounselDecisionChecklist({
      ...COUNSEL_DECISION_CHECKLIST,
      items: [halfDecided, ...items.slice(1)] as CounselDecisionItem[],
    })
    const parsed = parseCounselDecisionChecklist(content)

    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.errors).toContain(
      'items.0: decided item must carry decidedBy, decidedOn, and evidenceRef',
    )
  })

  it('makes every open item block at least one registered document', () => {
    const registeredIds = LEGAL_DOCUMENT_REGISTRY.documents.map((document) => document.id)

    for (const item of items) {
      expect(item.blocksDocuments).not.toEqual([])
      for (const documentId of item.blocksDocuments) {
        expect(registeredIds).toContain(documentId)
      }
    }
  })

  it('fails an item that blocks a document nobody registered', () => {
    const dangling: CounselDecisionItem = {
      ...items[0]!,
      blocksDocuments: ['terms-of-service'],
    }

    expect(validate([dangling, ...items.slice(1)])).toContain(
      `checklist item ${dangling.id} blocks unknown document terms-of-service`,
    )
  })

  it('never proposes a second data cell', () => {
    for (const item of items) {
      const text = `${item.question} ${item.sourceAnchor}`
      expect(text).not.toMatch(/cell-eu/iu)
      expect(text).not.toMatch(/europe cell/iu)
    }

    const secondCell: CounselDecisionItem = {
      ...items[0]!,
      question: 'Does the europe cell need its own controller analysis?',
    }

    expect(validate([secondCell, ...items.slice(1)])).toContain(
      `checklist item ${secondCell.id} must not propose a second data cell`,
    )
  })

  it('tags every dark capability decision so approval cannot read as activation', () => {
    const darkItems = items.filter((item) => item.capabilityPosture === 'dark')

    expect(darkItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        'retention_classes.unresolved_contact_requests',
        'rights.contact_request_consent',
      ]),
    )

    const mislabelled: CounselDecisionItem = {
      ...items[0]!,
      question: 'Which lawful basis covers Staff User login and MFA enrolment?',
      capabilityPosture: 'core',
    }

    expect(validate([mislabelled, ...items.slice(1)])).toEqual(
      expect.arrayContaining([
        `checklist item ${mislabelled.id} must be tagged capabilityPosture 'dark' (covers Staff User login)`,
        `checklist item ${mislabelled.id} must be tagged capabilityPosture 'dark' (covers MFA)`,
      ]),
    )
  })

  it('lists the open decisions that block a named document', () => {
    const blocking = openCounselDecisionsBlocking('privacy-notice')

    expect(blocking).toContain('roles.controller_processor')
    expect(openCounselDecisionsBlocking('terms-of-service')).toEqual([])
  })

  it('refuses an approved document while its blocking decisions are open', () => {
    const approvedRegistry = {
      ...LEGAL_DOCUMENT_REGISTRY,
      documents: LEGAL_DOCUMENT_REGISTRY.documents.map((document) =>
        document.id === 'privacy-notice'
          ? { ...document, status: 'approved' as const }
          : document,
      ),
    }
    const blocking = openCounselDecisionsBlocking('privacy-notice')

    expect(approvalBlockingDecisionErrors(approvedRegistry)).toEqual([
      `cannot approve privacy-notice: ${blocking.length} open counsel decisions (${blocking.join(', ')})`,
    ])
    expect(approvalBlockingDecisionErrors(LEGAL_DOCUMENT_REGISTRY)).toEqual([])
  })
})
