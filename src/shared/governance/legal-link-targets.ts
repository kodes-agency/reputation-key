/**
 * In-product legal link and notice registry (LEG-01).
 *
 * The rule this module makes executable is one the program states twice —
 * "documents match deployed behavior" — and that nothing enforced: **a notice
 * rendered inside the product may not point at legal text that does not
 * exist, and may not point at legal text counsel has not approved.**
 *
 * Today `MERCHANT_AI_NOTICE_PAYLOAD` links a merchant to `/privacy` and
 * `/privacy#contact` before enabling AI processing. Neither is an application
 * route, and the notice they stand for (`privacy-notice`) is a candidate
 * draft. Prose could not say that; `unpublishableLegalLinkTargets()` says it
 * in a value, and it stops saying it the moment the registry row moves to
 * `approved`.
 *
 * Two design choices are deliberate:
 *
 * - The set of real application routes is INJECTED. This module never reads
 *   the filesystem, so the rule is testable, and its paired test reads the
 *   generated TanStack route tree — meaning deleting `/settings/ai` surfaces
 *   here rather than as a dead link in a consent dialog.
 * - Frozen in-product copy is pinned by digest under the same
 *   domain-separated scheme as `MERCHANT_AI_NOTICE_DIGEST`. Guest copy packs
 *   carry templated members (functions over runtime data) whose literal text
 *   is not addressable, so the snapshot pins every static string plus the
 *   NAMES of the templated members: copy cannot change, and a templated
 *   member cannot be added, dropped, or renamed, without the digest moving.
 */

import { createHash } from 'node:crypto'
import { canonicalizeRfc8785 } from '../canonical-json'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_PAYLOAD,
  MERCHANT_AI_NOTICE_VERSION,
} from '../merchant-ai-notice-contract'
import {
  LEGAL_DOCUMENT_REGISTRY,
  type LegalDocumentKind,
  type LegalDocumentRegistry,
} from './legal-document-registry'

/**
 * Domain separator for in-product copy digests, mirroring the
 * `merchant-ai-notice-v1\0` prefix in `merchant-ai-notice-contract.ts`: a
 * digest for one artifact kind can never be replayed as another.
 */
export const IN_PRODUCT_NOTICE_DIGEST_DOMAIN = 'repkey-in-product-notice-v1\0'

export type InProductCopySnapshot = Readonly<{
  literals: Readonly<Record<string, string>>
  templated: readonly string[]
}>

/**
 * Deterministic, JSON-safe projection of a frozen copy object. Static strings
 * are captured verbatim; templated members are captured by name because their
 * output depends on runtime data (and, for the two date formatters, on the
 * host ICU build, which would make the digest non-reproducible).
 */
export function inProductCopySnapshot(
  copy: Readonly<Record<string, unknown>>,
): InProductCopySnapshot {
  const entries = Object.entries(copy)
  return Object.freeze({
    literals: Object.fromEntries(
      entries
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .sort(([left], [right]) => (left < right ? -1 : 1)),
    ),
    templated: Object.freeze(
      entries
        .filter(([, value]) => typeof value === 'function')
        .map(([key]) => key)
        .sort(),
    ),
  })
}

export function inProductNoticeDigest(value: unknown): string {
  return createHash('sha256')
    .update(IN_PRODUCT_NOTICE_DIGEST_DOMAIN, 'utf8')
    .update(canonicalizeRfc8785(value), 'utf8')
    .digest('hex')
}

export type InProductNotice = Readonly<{
  id: string
  kind: Extract<LegalDocumentKind, 'in_product_notice'>
  title: string
  /** Repository path of the frozen copy this digest was taken over. */
  source: string
  version: string
  sha256: string
}>

/**
 * The notices the product itself renders. They are legal text by effect even
 * though they never appear under `docs/legal/`, so a release legal revision
 * set must name them alongside the counsel-owned documents — otherwise a
 * copy bump could ship without appearing anywhere in the approval record.
 */
export const IN_PRODUCT_NOTICES: readonly InProductNotice[] = Object.freeze([
  Object.freeze({
    id: 'guest-ui-bg-v1',
    kind: 'in_product_notice' as const,
    title: 'Guest public Portal copy (bg)',
    source:
      'src/components/features/guest/public-portal/guest-language-pack.ts#guest-ui-bg-v1',
    version: 'guest-ui-bg-v1',
    sha256: 'a76972a18975a60750c5ac62ac0c4e2e1c5273847a26e564a146a2de49e54bc0',
  }),
  Object.freeze({
    id: 'guest-ui-en-v1',
    kind: 'in_product_notice' as const,
    title: 'Guest public Portal copy (en)',
    source:
      'src/components/features/guest/public-portal/guest-language-pack.ts#guest-ui-en-v1',
    version: 'guest-ui-en-v1',
    sha256: 'fba36883104f4cc4ef295b9a563c88170eb2e69f002cbd793a589149b8c5b386',
  }),
  Object.freeze({
    id: 'merchant-ai-notice',
    kind: 'in_product_notice' as const,
    title: 'Merchant AI data-use notice',
    source: 'src/shared/merchant-ai-notice-contract.ts',
    version: MERCHANT_AI_NOTICE_VERSION,
    sha256: MERCHANT_AI_NOTICE_DIGEST,
  }),
])

/** Sorted, so the release revision set has one canonical required order. */
export const IN_PRODUCT_NOTICE_IDS: readonly string[] = Object.freeze(
  IN_PRODUCT_NOTICES.map((notice) => notice.id).sort(),
)

export type LegalLinkTarget = Readonly<{
  /** Exactly as written in the in-product payload, fragment included. */
  target: string
  /** The `docs/legal/` document id the target stands for. */
  documentId: string
  reason: string
}>

/**
 * Declared destinations that are NOT application routes. Each one resolves to
 * a registry document, so "is this link safe to show?" reduces to "is that
 * document approved?".
 */
export const LEGAL_LINK_TARGETS: readonly LegalLinkTarget[] = Object.freeze([
  Object.freeze({
    target: '/privacy',
    documentId: 'privacy-notice',
    reason:
      'The merchant AI notice links the privacy notice before AI processing is enabled.',
  }),
  Object.freeze({
    target: '/privacy#contact',
    documentId: 'privacy-notice',
    reason:
      'The retention and revocation section links the privacy contact channel of the same notice.',
  }),
])

export function findLegalLinkTarget(target: string): LegalLinkTarget | undefined {
  return LEGAL_LINK_TARGETS.find((entry) => entry.target === target)
}

const isExternal = (target: string): boolean =>
  target.startsWith('https://') || target.startsWith('http://')

/**
 * Every in-product destination the merchant AI notice can send a reader to,
 * excluding external provider documentation (which this repository does not
 * own and cannot approve). Sorted and de-duplicated so the contract is one
 * comparable value.
 */
export function merchantAiNoticeLinkTargets(): readonly string[] {
  return [
    ...new Set(
      MERCHANT_AI_NOTICE_PAYLOAD.sections
        .flatMap((section) => section.links.map((link) => link.target))
        .filter((target) => !isExternal(target)),
    ),
  ].sort()
}

/**
 * `unmapped legal link target <t>` for every in-product destination that is
 * neither a real application route nor a declared legal document target.
 */
export function legalLinkTargetErrors(
  applicationRoutes: ReadonlySet<string>,
): readonly string[] {
  return merchantAiNoticeLinkTargets().flatMap((target) =>
    applicationRoutes.has(target) || findLegalLinkTarget(target) !== undefined
      ? []
      : [`unmapped legal link target ${target}`],
  )
}

/**
 * A link is publishable when it does not stand for a legal document at all
 * (a plain application route) or when the document it stands for is approved.
 */
export function isLegalLinkPublishable(
  target: string,
  registry: LegalDocumentRegistry = LEGAL_DOCUMENT_REGISTRY,
): boolean {
  const declared = findLegalLinkTarget(target)
  if (declared === undefined) return true
  const document = registry.documents.find(
    (candidate) => candidate.id === declared.documentId,
  )
  return document?.status === 'approved'
}

/**
 * The in-product links that currently point at unapproved legal text. While
 * this list is non-empty the product is showing a reader a promise nobody has
 * signed, so it is a launch blocker rather than a warning.
 */
export function unpublishableLegalLinkTargets(
  registry: LegalDocumentRegistry = LEGAL_DOCUMENT_REGISTRY,
): readonly string[] {
  return LEGAL_LINK_TARGETS.map((entry) => entry.target).filter(
    (target) => !isLegalLinkPublishable(target, registry),
  )
}
