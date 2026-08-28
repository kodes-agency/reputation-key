import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(import.meta.dirname, '../..')
const LEGAL = resolve(ROOT, 'docs/legal')

const draftPaths = [
  resolve(LEGAL, 'privacy-notice.md'),
  resolve(LEGAL, 'internal-beta-agreement.md'),
  resolve(LEGAL, 'google-access-disclosure.md'),
] as const

const read = (path: string): string => readFileSync(path, 'utf8')
const prose = (path: string): string => read(path).replace(/\s+/gu, ' ')

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

describe('candidate legal drafts', () => {
  it.each(draftPaths)(
    'stays visibly non-publishable and has valid local links: %s',
    (path) => {
      const source = read(path)
      expect(source).toContain('**Status:** Candidate draft')
      expect(source).toMatch(/do not publish/iu)
      expect(source).not.toMatch(/\*\*Status:\*\* (?:Approved|Effective)/u)
      for (const target of localMarkdownLinks(path)) {
        expect(existsSync(target), `missing local legal-draft link: ${target}`).toBe(true)
      }
    },
  )

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
  })

  it('keeps the agreement aligned to executable capability posture', () => {
    const source = prose(resolve(LEGAL, 'internal-beta-agreement.md'))
    expect(source).toContain('Core closed-beta functions')
    expect(source).toContain('Separately controlled beta functions')
    expect(source).toContain('Excluded or unavailable functions')
    expect(source).toContain('Portal Groups are the accepted grouping model')
    expect(source).toContain('All supported countries route to that single beta cell')
    expect(source).toContain('must not promise unavailable self-service export')
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
