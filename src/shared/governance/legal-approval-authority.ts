/**
 * Fail-closed legal approval authority (LEG-01).
 *
 * The program rule this module encodes is one sentence: **Engineering cannot
 * self-approve this gate.** Prose said so; nothing enforced it. Here the rule
 * is executable in two ways.
 *
 * 1. Approval is bound to bytes. The registry records the sha256 of each
 *    document, so an approved file that is edited afterwards fails the check
 *    instead of silently carrying counsel's name over text counsel never saw.
 *    Drafts are held to the same digest discipline for the mirror-image
 *    reason: counsel must be reviewing exactly the bytes in the repository.
 * 2. The approver must be external. A counsel-owned document approved by an
 *    engineering role, by a prohibited individual, or by the operating
 *    company itself is rejected — the operator cannot sign its own consent.
 *
 * Every check needs the document bytes and the current date, both injected,
 * so the rules are testable without the filesystem and the CLI supplies the
 * real ones.
 */

import { createHash } from 'node:crypto'
import {
  LEGAL_DOCUMENT_REGISTRY,
  type LegalDocument,
  type LegalDocumentRegistry,
} from './legal-document-registry'

/**
 * Identities that can never appear as the approver of a counsel-owned
 * document. These are the operator's own accountable people and the
 * operating company: an approval signed by them is self-approval no matter
 * which role string it claims.
 */
export const LEGAL_SELF_APPROVAL_PROHIBITED: readonly string[] = Object.freeze([
  'Bozhidar Denev',
  'Kodes Agency',
])

/**
 * The counsel-owned documents that gate external beta, in publication order
 * (the notice governs the agreement, which references the disclosure).
 */
export const LEGAL_PUBLICATION_DOCUMENT_IDS: readonly string[] = Object.freeze([
  'privacy-notice',
  'internal-beta-agreement',
  'google-access-disclosure',
])

/**
 * Markers a candidate draft must carry and an approved document must not.
 * They are the only visible signal a reader has that the text is not yet
 * legal advice, so losing one is treated as a defect in both directions.
 */
const NON_PUBLISHABLE_MARKERS: readonly RegExp[] = Object.freeze([
  /Candidate draft/u,
  /do not publish/iu,
])

export type LegalRegistryValidationInput = Readonly<{
  registry: LegalDocumentRegistry
  /** Repository-relative reader; throws when the document is absent. */
  readDocument: (path: string) => Uint8Array
  now: Date
}>

export type LegalRegistryValidationResult =
  | Readonly<{ ok: true; blockers: readonly string[] }>
  | Readonly<{ ok: false; errors: readonly string[] }>

function isProhibitedIdentity(value: string): boolean {
  const normalized = value.trim().toLowerCase()
  return LEGAL_SELF_APPROVAL_PROHIBITED.some(
    (prohibited) => prohibited.toLowerCase() === normalized,
  )
}

function carriesNonPublishableMarker(body: string): boolean {
  return NON_PUBLISHABLE_MARKERS.some((marker) => marker.test(body))
}

function calendarDate(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function documentErrors(
  document: LegalDocument,
  input: LegalRegistryValidationInput,
): readonly string[] {
  const errors: string[] = []

  if (
    document.kind === 'counsel_approved' &&
    document.approver !== null &&
    (document.approver.role !== 'external_counsel' ||
      isProhibitedIdentity(document.approver.name) ||
      isProhibitedIdentity(document.approver.organization))
  ) {
    errors.push(`engineering cannot self-approve ${document.id}`)
  }

  // The mirror of the rule above. An operator-acknowledged document is exactly
  // the case where the operator IS the approver, so the prohibition does not
  // apply — but it must not dress itself as counsel, because that is the one
  // claim the rule above exists to make unforgeable.
  if (
    document.kind === 'operator_acknowledged' &&
    document.approver !== null &&
    document.approver.role === 'external_counsel'
  ) {
    errors.push(
      `${document.id}: operator-acknowledged documents cannot claim an external counsel approver`,
    )
  }

  if (document.status === 'approved' && document.expiresOn !== null) {
    const today = calendarDate(input.now)
    if (document.expiresOn < today) {
      errors.push(
        `${document.id}: approval expired (expiresOn ${document.expiresOn}, now ${today})`,
      )
    }
  }

  let bytes: Uint8Array
  try {
    bytes = input.readDocument(document.path)
  } catch {
    errors.push(`${document.id}: legal document cannot be read at ${document.path}`)
    return errors
  }

  const digest = createHash('sha256').update(bytes).digest('hex')
  if (digest !== document.sha256) {
    errors.push(
      document.status === 'approved'
        ? `${document.id}: approved document changed after approval (registry ${document.sha256}, file ${digest})`
        : `${document.id}: draft document digest is stale (registry ${document.sha256}, file ${digest})`,
    )
  }

  const body = new TextDecoder().decode(bytes)
  const marked = carriesNonPublishableMarker(body)
  if (document.status === 'approved' && marked) {
    errors.push(`${document.id}: approved document still carries non-publishable markers`)
  }
  if (document.status === 'draft' && !marked) {
    errors.push(`${document.id}: draft document is missing its non-publishable marker`)
  }

  return errors
}

export function validateLegalDocumentRegistry(
  input: LegalRegistryValidationInput,
): LegalRegistryValidationResult {
  const errors = input.registry.documents.flatMap((document) =>
    documentErrors(document, input),
  )
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, blockers: legalPublicationBlockers(input.registry) }
}

/**
 * The counsel-owned ids that are not yet approved. An empty list is the only
 * state in which external beta text may be published.
 */
export function legalPublicationBlockers(
  registry: LegalDocumentRegistry = LEGAL_DOCUMENT_REGISTRY,
): readonly string[] {
  return LEGAL_PUBLICATION_DOCUMENT_IDS.filter((id) => {
    const document = registry.documents.find((candidate) => candidate.id === id)
    if (document === undefined || document.status !== 'approved') return true
    // Approved by the operator is enough to RUN a closed beta and not enough to
    // PUBLISH to anyone else, so it stays on the blocker list. That is what
    // makes opening the beta surface these documents instead of inheriting a
    // clean list from the closed phase.
    return document.kind === 'operator_acknowledged'
  })
}
