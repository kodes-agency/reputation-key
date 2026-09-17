// What a beta report may look like on a PUBLIC issue tracker.
//
// `kodes-agency/reputation-key` is public, and GitHub is not a listed processor
// in the accepted privacy notice (`docs/legal/privacy-notice.md` §5: Railway,
// OpenAI, Google, Sentry). Reporter free text therefore never reaches an issue
// — not automatically, and not by an operator pasting it. The issue carries the
// controlled triage vocabulary plus a link an authenticated engineer can follow
// to the report itself in monitoring.
//
// The two pseudonyms are also withheld. They are stable HMACs, so on a public
// tracker they would become a durable handle for correlating every report from
// one organization or one person across issues — exactly what pseudonymising
// them was meant to prevent.

import type {
  BetaFeedbackImpact,
  BetaFeedbackRouteKey,
  BetaFeedbackType,
} from '#/shared/beta-feedback-contract'

export type BetaFeedbackIssueSource = Readonly<{
  reference: string
  feedbackType: BetaFeedbackType
  impactCode: BetaFeedbackImpact
  routeKey: BetaFeedbackRouteKey
  viewport: 'compact' | 'regular' | 'wide'
  reporterRole: string
  severity: string
  triageState: string
  clientErrorEventId: string | null
  createdAt: Date
}>

export type BetaFeedbackIssue = Readonly<{
  title: string
  body: string
  labels: ReadonlyArray<string>
}>

/** Only labels that already exist on the repository are ever requested. */
const TYPE_LABEL: Readonly<Record<BetaFeedbackType, string>> = {
  bug: 'bug',
  suggestion: 'enhancement',
}

function monitoringLink(
  label: string,
  id: string | null,
  searchUrlBase: string | null,
): string {
  if (!id) return `- ${label}: none`
  if (!searchUrlBase) return `- ${label}: \`${id}\``
  return `- ${label}: [\`${id}\`](${searchUrlBase}${encodeURIComponent(id)})`
}

/**
 * Render the issue for one triaged report.
 *
 * `searchUrlBase` is the monitoring search prefix an event id is appended to;
 * pass null when it is not configured and the ids render as bare text.
 */
export function buildBetaFeedbackIssue(
  source: BetaFeedbackIssueSource,
  providerReference: string | null,
  searchUrlBase: string | null,
): BetaFeedbackIssue {
  const kind = source.feedbackType === 'bug' ? 'Bug' : 'Suggestion'
  const title = `[Beta ${kind}] ${source.routeKey} — ${source.impactCode}`

  const body = [
    '> Filed from RepKey beta feedback. **The reporter’s own words are not',
    '> reproduced here** — they stay in monitoring, which is the only accepted',
    '> destination for them. Follow the link below to read the report.',
    '',
    '## Report',
    '',
    `- Type: ${kind}`,
    `- Reported impact: \`${source.impactCode}\``,
    `- Triage severity: \`${source.severity}\``,
    `- Surface: \`${source.routeKey}\``,
    `- Viewport: \`${source.viewport}\``,
    `- Reporter role: \`${source.reporterRole}\``,
    `- Submitted: ${source.createdAt.toISOString()}`,
    '',
    '## Monitoring',
    '',
    monitoringLink('Report', providerReference, searchUrlBase),
    monitoringLink('Recorded browser error', source.clientErrorEventId, searchUrlBase),
    '',
    '## Triage reference',
    '',
    `\`${source.reference}\``,
    '',
    'Close this issue and run `pnpm ops:feedback-sync` to mark the report resolved.',
  ].join('\n')

  return {
    title,
    body,
    labels: [TYPE_LABEL[source.feedbackType], 'needs-triage'],
  }
}

/** GitHub returns the issue URL; the triage column stores the number only. */
export function issueNumberFromUrl(url: string): string {
  const match = /\/issues\/(\d+)\s*$/u.exec(url.trim())
  if (!match?.[1]) throw new Error(`Unrecognized GitHub issue URL: ${url}`)
  return match[1]
}
