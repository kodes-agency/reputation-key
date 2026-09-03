import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getGuestPortalCopy } from '../../components/features/guest/public-portal/guest-language-pack'
import { canonicalizeRfc8785 } from '../canonical-json'
import {
  MERCHANT_AI_NOTICE_DIGEST,
  MERCHANT_AI_NOTICE_PAYLOAD,
} from '../merchant-ai-notice-contract'
import {
  IN_PRODUCT_NOTICES,
  IN_PRODUCT_NOTICE_IDS,
  LEGAL_LINK_TARGETS,
  findLegalLinkTarget,
  inProductCopySnapshot,
  inProductNoticeDigest,
  isLegalLinkPublishable,
  legalLinkTargetErrors,
  merchantAiNoticeLinkTargets,
} from './legal-link-targets'

const ROOT = resolve(import.meta.dirname, '../../..')

/**
 * The generated TanStack route tree is the only honest answer to "is this a
 * real application route?". Reading it here — rather than hardcoding a list —
 * means deleting `/settings/ai` turns the merchant AI notice link into a
 * declared-but-unmapped target instead of a silent 404.
 */
function applicationRoutes(): ReadonlySet<string> {
  const source = readFileSync(resolve(ROOT, 'src/routeTree.gen.ts'), 'utf8')
  const block = /export interface FileRoutesByFullPath \{(?<body>[^}]*)\}/u.exec(source)
  const body = block?.groups?.body
  if (body === undefined) throw new Error('route tree has no FileRoutesByFullPath block')
  return new Set([...body.matchAll(/^\s*'(?<path>[^']+)':/gmu)].map((m) => m[1]!))
}

describe('in-product legal link targets', () => {
  it('maps every non-external merchant AI notice link to a route or a registry document', () => {
    const routes = applicationRoutes()
    expect(merchantAiNoticeLinkTargets()).toEqual([
      '/privacy',
      '/privacy#contact',
      '/settings/ai',
    ])
    expect(routes.has('/settings/ai')).toBe(true)
    // The notice is the shipped payload, so this is the executable statement
    // that nothing in it points at an undeclared destination.
    expect(legalLinkTargetErrors(routes)).toEqual([])
  })

  it('names an undeclared target rather than letting it pass', () => {
    // An empty route set removes '/settings/ai' from the "real route" side of
    // the rule; it is not declared in LEGAL_LINK_TARGETS, so it must surface.
    expect(legalLinkTargetErrors(new Set<string>())).toEqual([
      'unmapped legal link target /settings/ai',
    ])
  })

  it('refuses to call the privacy links publishable while the notice is a draft', () => {
    expect(findLegalLinkTarget('/privacy')?.documentId).toBe('privacy-notice')
    expect(findLegalLinkTarget('/privacy#contact')?.documentId).toBe('privacy-notice')
    expect(isLegalLinkPublishable('/privacy')).toBe(false)
    expect(isLegalLinkPublishable('/settings/ai')).toBe(true)
  })

  it('becomes publishable only when the backing document is approved', () => {
    expect(
      isLegalLinkPublishable('/privacy', {
        version: 'repkey-legal-document-registry-1',
        updatedAt: '2026-08-28',
        documents: [
          {
            id: 'privacy-notice',
            kind: 'counsel_approved',
            title: 'Privacy Notice — Reputation Key Closed Beta',
            path: 'docs/legal/privacy-notice.md',
            version: '2.0',
            status: 'approved',
            sha256: 'a'.repeat(64),
            effectiveFrom: '2026-09-01',
            reviewDueOn: '2027-03-01',
            expiresOn: '2027-09-01',
            approvedAt: '2026-08-31T09:00:00.000Z',
            approver: {
              name: 'External Counsel',
              role: 'external_counsel',
              organization: 'Counsel LLP',
            },
            approvalEvidenceRef: 'docs/legal/approvals/privacy-notice.json',
          },
        ],
      }),
    ).toBe(true)
  })
})

describe('in-product notice registry', () => {
  it('registers the merchant AI notice at the digest the database CHECKs pin', () => {
    const merchant = IN_PRODUCT_NOTICES.find(
      (notice) => notice.id === 'merchant-ai-notice',
    )
    expect(merchant).toBeDefined()
    expect(merchant?.kind).toBe('in_product_notice')
    expect(merchant?.sha256).toBe(MERCHANT_AI_NOTICE_DIGEST)
    expect(MERCHANT_AI_NOTICE_DIGEST).toBe(
      'f0d809baa42995be174a536561a56f4c6656e9b1a60feb5773466f2d1eb2bf31',
    )

    // A notice bump that misses the two CHECK constraints would leave the
    // deployed database refusing the very consent rows the notice authorizes.
    const schema = readFileSync(
      resolve(ROOT, 'src/shared/db/schema/merchant-ai-authorization.schema.ts'),
      'utf8',
    )
    for (const constraint of [
      'merchant_ai_consent_evidence_notice_digest_valid',
      'merchant_ai_enablement_notice_digest_valid',
    ]) {
      expect(schema).toContain(constraint)
    }
    expect(
      schema.split(MERCHANT_AI_NOTICE_DIGEST).length - 1,
      'both CHECK constraints must pin the current notice digest',
    ).toBe(2)
  })

  it('registers both frozen guest publication snapshots at recomputed digests', () => {
    expect(IN_PRODUCT_NOTICE_IDS).toEqual([
      'guest-ui-bg-v1',
      'guest-ui-en-v1',
      'merchant-ai-notice',
    ])
    for (const [locale, id] of [
      ['en', 'guest-ui-en-v1'],
      ['bg', 'guest-ui-bg-v1'],
    ] as const) {
      const notice = IN_PRODUCT_NOTICES.find((entry) => entry.id === id)
      expect(notice?.kind).toBe('in_product_notice')
      expect(notice?.version).toBe(id)
      const copy = getGuestPortalCopy(locale) as unknown as Readonly<
        Record<string, unknown>
      >
      expect(notice?.sha256).toBe(inProductNoticeDigest(inProductCopySnapshot(copy)))
    }
  })

  it('projects a guest copy pack to a deterministic JSON-safe snapshot', () => {
    const copy = getGuestPortalCopy('en') as unknown as Readonly<Record<string, unknown>>
    const snapshot = inProductCopySnapshot(copy)

    expect(snapshot.literals['version']).toBe('guest-ui-en-v1')
    expect(snapshot.templated).toContain('portalLogoAlt')
    expect(snapshot.templated).toContain('ratingLabel')
    // Templated members are functions over runtime data; the snapshot pins
    // their presence, so one cannot be dropped or renamed without a digest
    // change, and canonicalizeRfc8785 stays applicable.
    expect(() => canonicalizeRfc8785(snapshot)).not.toThrow()
    expect(inProductNoticeDigest(snapshot)).toBe(
      createHash('sha256')
        .update('repkey-in-product-notice-v1\0', 'utf8')
        .update(canonicalizeRfc8785(snapshot), 'utf8')
        .digest('hex'),
    )
  })

  it('keeps the merchant notice payload the source of the declared link targets', () => {
    const targets = MERCHANT_AI_NOTICE_PAYLOAD.sections.flatMap((section) =>
      section.links.map((link) => link.target),
    )
    expect(targets).toContain('/privacy')
    expect(targets).toContain('/privacy#contact')
    expect(LEGAL_LINK_TARGETS.map((entry) => entry.target)).toEqual([
      '/privacy',
      '/privacy#contact',
    ])
  })
})
