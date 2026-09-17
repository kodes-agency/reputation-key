import { describe, expect, it } from 'vitest'
import {
  buildBetaFeedbackIssue,
  issueNumberFromUrl,
  type BetaFeedbackIssueSource,
} from './beta-feedback-issue'

const SEARCH = 'https://sentry.io/organizations/kodes/issues/?query='
const PROVIDER = 'a'.repeat(32)
const CLIENT_ERROR = 'b'.repeat(32)

const source: BetaFeedbackIssueSource = {
  reference: '00000000-0000-4000-8000-0000000000f1',
  feedbackType: 'bug',
  impactCode: 'cannot_complete',
  routeKey: 'properties.property.reviews',
  viewport: 'wide',
  reporterRole: 'PropertyManager',
  severity: 'P2',
  triageState: 'accepted',
  clientErrorEventId: CLIENT_ERROR,
  createdAt: new Date('2026-09-18T08:00:00.000Z'),
}

describe('beta feedback issue', () => {
  it('titles the issue from controlled vocabulary alone', () => {
    const issue = buildBetaFeedbackIssue(source, PROVIDER, SEARCH)

    expect(issue.title).toBe('[Beta Bug] properties.property.reviews — cannot_complete')
  })

  it('carries the triage facts an engineer needs', () => {
    const issue = buildBetaFeedbackIssue(source, PROVIDER, SEARCH)

    expect(issue.body).toContain('`cannot_complete`')
    expect(issue.body).toContain('`P2`')
    expect(issue.body).toContain('`properties.property.reviews`')
    expect(issue.body).toContain('`PropertyManager`')
    expect(issue.body).toContain('2026-09-18T08:00:00.000Z')
    expect(issue.body).toContain(source.reference)
  })

  it('links both monitoring events through the configured search', () => {
    const issue = buildBetaFeedbackIssue(source, PROVIDER, SEARCH)

    expect(issue.body).toContain(`${SEARCH}${PROVIDER}`)
    expect(issue.body).toContain(`${SEARCH}${CLIENT_ERROR}`)
  })

  it('renders bare ids when no monitoring search is configured', () => {
    const issue = buildBetaFeedbackIssue(source, PROVIDER, null)

    expect(issue.body).toContain(`\`${PROVIDER}\``)
    expect(issue.body).not.toContain('](http')
  })

  it('says so when there is nothing to link', () => {
    const issue = buildBetaFeedbackIssue(
      { ...source, clientErrorEventId: null },
      null,
      SEARCH,
    )

    expect(issue.body).toContain('- Report: none')
    expect(issue.body).toContain('- Recorded browser error: none')
  })

  it('never carries a pseudonym onto the public tracker', () => {
    // Pseudonyms are stable HMACs: on a public repo they would correlate every
    // report from one organization or person across issues.
    const withPseudonyms = {
      ...source,
      organizationPseudonym: 'c'.repeat(64),
      actorPseudonym: 'd'.repeat(64),
      ownerPseudonym: 'e'.repeat(64),
    } as BetaFeedbackIssueSource

    const issue = buildBetaFeedbackIssue(withPseudonyms, PROVIDER, SEARCH)
    const rendered = `${issue.title} ${issue.body}`

    for (const pseudonym of ['c', 'd', 'e']) {
      expect(rendered).not.toContain(pseudonym.repeat(64))
    }
  })

  it('states that the report text is elsewhere', () => {
    const issue = buildBetaFeedbackIssue(source, PROVIDER, SEARCH)

    expect(issue.body).toContain('not')
    expect(issue.body.toLowerCase()).toContain('reproduced here')
  })

  it('requests only labels that exist on the repository', () => {
    expect(buildBetaFeedbackIssue(source, PROVIDER, SEARCH).labels).toEqual([
      'bug',
      'needs-triage',
    ])
    expect(
      buildBetaFeedbackIssue(
        { ...source, feedbackType: 'suggestion', impactCode: 'important' },
        PROVIDER,
        SEARCH,
      ).labels,
    ).toEqual(['enhancement', 'needs-triage'])
  })

  it('reads the issue number back out of the created URL', () => {
    expect(
      issueNumberFromUrl('https://github.com/kodes-agency/reputation-key/issues/472'),
    ).toBe('472')
    expect(
      issueNumberFromUrl('https://github.com/kodes-agency/reputation-key/issues/472\n'),
    ).toBe('472')
  })

  it.each(['', 'not a url', 'https://github.com/kodes-agency/reputation-key/pull/12'])(
    'refuses %s rather than storing a wrong reference',
    (url) => {
      expect(() => issueNumberFromUrl(url)).toThrow()
    },
  )
})
