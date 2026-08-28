// LEG-01: the drafts and the legal document registry must be one source of
// truth, not two.
//
// This file used to hardcode three paths. A fourth counsel-owned document
// could therefore be added to `docs/legal/` and to the registry and stay
// completely uncovered here — the failure mode is silent, which is the worst
// kind for a gate whose subject is legal text. The paths are now derived from
// `docs/legal/legal-document-registry.json`, and the assertions switch on the
// registry `status`: a draft must LOOK non-publishable and an approved
// document must not, while also agreeing with the registry about its version
// and effective date. Neither direction can drift without a failure here.

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  parseLegalDocumentRegistry,
  type LegalDocument,
} from '../../src/shared/governance/legal-document-registry'

const ROOT = resolve(import.meta.dirname, '../..')
const LEGAL = resolve(ROOT, 'docs/legal')

const read = (path: string): string => readFileSync(path, 'utf8')
const prose = (path: string): string => read(path).replace(/\s+/gu, ' ')

const registryResult = parseLegalDocumentRegistry(
  read(resolve(ROOT, 'docs/legal/legal-document-registry.json')),
)
if (!registryResult.ok) {
  throw new Error(
    `legal document registry is invalid: ${registryResult.errors.join('; ')}`,
  )
}
const registry = registryResult.registry

/** Counsel-owned rows only: the fact map is engineering input, not legal text. */
const counselDocuments: readonly LegalDocument[] = registry.documents.filter(
  (document) => document.kind === 'counsel_approved',
)

const draftPaths = counselDocuments.map((document) => resolve(ROOT, document.path))

function localMarkdownLinks(path: string): readonly string[] {
  return [...read(path).matchAll(/\[[^\]]+\]\(([^)]+)\)/gu)]
    .map((match) => match[1]!)
    .filter(
      (target) =>
        !target.startsWith('https://') &&
        !target.startsWith('http://') &&
        !target.startsWith('#'),
    )
    .map((target) => resolve(dirname(path), target.split('#')[0]!))
}

describe('counsel-owned legal documents', () => {
  it('covers every counsel-owned registry row', () => {
    // The guard against the old hardcoded list: adding a fourth counsel
    // document must extend this suite, not slip past it.
    expect(counselDocuments.length).toBeGreaterThanOrEqual(3)
    expect(counselDocuments.map((document) => document.id)).toEqual(
      [...counselDocuments].map((document) => document.id).sort(),
    )
    for (const path of draftPaths) {
      expect(existsSync(path), `registered legal document is missing: ${path}`).toBe(true)
    }
  })

  it.each(counselDocuments.map((document) => [document.id, document] as const))(
    'matches the status the registry records for it: %s',
    (_id, document) => {
      const path = resolve(ROOT, document.path)
      const source = read(path)
      if (document.status === 'draft') {
        expect(source).toContain('**Status:** Candidate draft')
        expect(source).toMatch(/do not publish/iu)
        expect(source).not.toMatch(/\*\*Status:\*\* (?:Approved|Effective)/u)
      } else {
        expect(source).not.toContain('**Status:** Candidate draft')
        expect(source).not.toMatch(/do not publish/iu)
        expect(source).toMatch(/\*\*Status:\*\* (?:Approved|Effective)/u)
        // An approved file and its registry row cannot disagree about which
        // version counsel signed, or from when it applies.
        expect(source).toContain(`**Version:** ${document.version}`)
        expect(source).toContain(`**Effective from:** ${String(document.effectiveFrom)}`)
      }
      for (const target of localMarkdownLinks(path)) {
        expect(existsSync(target), `missing local legal-draft link: ${target}`).toBe(true)
      }
    },
  )

  it('never claims a second Data Cell anywhere under docs/legal', () => {
    // Beta is exactly one logical US Data Cell. A legal document that named a
    // second one would be describing a deployment that does not exist.
    const documents = readdirSync(LEGAL)
      .filter((entry) => entry.endsWith('.md'))
      .map((entry) => resolve(LEGAL, entry))
    expect(documents.length).toBeGreaterThan(0)
    for (const path of documents) {
      const source = read(path)
      for (const forbidden of ['cell-eu', 'cell-global']) {
        expect(source, `${path} names ${forbidden}`).not.toContain(forbidden)
      }
      for (const claim of [/europe cell/iu, /global cell/iu, /second Data Cell/iu]) {
        expect(claim.test(source), `${path} claims a second Data Cell`).toBe(false)
      }
    }
  })

  it('keeps the privacy draft aligned to Portal, analytics, AI, access, and one-cell facts', () => {
    const source = prose(resolve(LEGAL, 'privacy-notice.md'))
    expect(source).toContain('Core analytics are part of the Service')
    expect(source).toContain('same Google Review action is offered for all five ratings')
    expect(source).toContain('current responsible managers assigned to that Portal')
    expect(source).toContain(
      'Review Analysis, Reply Drafting, and Property Trends are independent',
    )
    expect(source).toContain('exactly one Railway Data Cell, `cell-us`')
    expect(source).toContain('This target is not proof of current live placement')
    // The always-offered Google opportunity and the configurable private
    // feedback threshold are the two Portal facts a well-meaning edit is most
    // likely to flatten into "low ratings go private".
    expect(source).toContain('is offered for all five ratings')
    expect(source).toContain('(default `3`)')
    expect(source).toContain('Portal Group')
  })

  it('keeps the agreement aligned to executable capability posture', () => {
    const source = prose(resolve(LEGAL, 'internal-beta-agreement.md'))
    expect(source).toContain('Core closed-beta functions')
    expect(source).toContain('Separately controlled beta functions')
    expect(source).toContain('Excluded or unavailable functions')
    expect(source).toContain('Portal Groups are the accepted grouping model')
    expect(source).toContain('All supported countries route to that single beta cell')
    expect(source).toContain('must not promise unavailable self-service export')
    expect(source).toContain('inclusive threshold (default `3`)')
    expect(source).toContain('Portal Group')
  })

  it('keeps the Google disclosure bound to actual scope, notification, and written evidence', () => {
    const source = prose(resolve(LEGAL, 'google-access-disclosure.md'))
    expect(source).toContain('`https://www.googleapis.com/auth/business.manage`')
    expect(source).toContain('Google Cloud Pub/Sub notifications')
    expect(source).toContain(
      '../product-readiness-program-2026-07/google-business-profile-ai-policy-response-2026-07-14.md',
    )
    expect(source).toContain('does not claim that the guest completed or published')
    expect(source).toContain('production erasure is still a release gate')
  })

  it('does not restore superseded provider or live-infrastructure promises', () => {
    const source = draftPaths.map(read).join('\n')
    expect(source).not.toContain('**Neon**')
    expect(source).not.toContain('**Amazon Web Services**')
    expect(source).not.toContain('EU-West-3')
    expect(source).not.toContain('We respond within 30 days')
    expect(source).not.toContain('point-in-time recovery with ≤15-minute')
    expect(source).not.toContain('Guest interactions (when guest features are enabled')
  })

  it('records the candidate reconciliation without claiming acceptance', () => {
    const source = prose(resolve(LEGAL, 'implementation-facts-2026-08-26.md'))
    expect(source).toContain('**Last candidate-draft reconciliation:** 2026-08-28')
    expect(source).toContain('remain non-publishable drafts')
    expect(source).toContain('Still required before publication')
    expect(source).toContain('`LEG-01` cannot be marked complete')
  })
})
