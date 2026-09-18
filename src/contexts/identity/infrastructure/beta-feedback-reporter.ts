// ADR 0059 — who filed a beta report, found only at the moment it matters.
//
// The triage row stores the reporter as a keyed pseudonym and deliberately
// nothing that names them. To tell them their report reached an outcome, the
// recipient is recovered here by recomputing those pseudonyms over Identity's
// own directory, then handed straight to the fact the transition writes. No
// user-to-report link is ever persisted to do it.
//
// Current membership is the scan's domain, and that is the intended rule: a
// reporter who has since left the Organization does not match, and is not
// sent a notice about an Organization they can no longer open.
//
// Cost is one digest per Organization and then one per member of the matched
// Organization, per outcome transition — operator-driven and rare, and bounded
// by a beta whose Organizations are operator-provisioned.

import { timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { member, organization } from '#/shared/db/schema/auth'
import { betaFeedbackPseudonym } from '../application/beta-feedback-pseudonym'

export type BetaFeedbackReporter = Readonly<{
  organizationId: string
  userId: string
}>

type ReporterPseudonyms = Readonly<{
  organizationPseudonym: string
  actorPseudonym: string
}>

/**
 * Constant-time digest comparison. Not an authentication path — the scan runs
 * operator-side over Identity's own rows — but it costs nothing to compare
 * keyed digests the way keyed digests should be compared.
 */
function sameDigest(left: string, right: string): boolean {
  const a = Buffer.from(left, 'utf8')
  const b = Buffer.from(right, 'utf8')
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The reporter behind a triage row, or null when they are no longer a member. */
export async function resolveBetaFeedbackReporter(
  db: Database,
  secret: string,
  pseudonyms: ReporterPseudonyms,
): Promise<BetaFeedbackReporter | null> {
  const organizations = await db.select({ id: organization.id }).from(organization)
  const match = organizations.find(({ id }) =>
    sameDigest(
      betaFeedbackPseudonym(secret, 'telemetry-organization', id),
      pseudonyms.organizationPseudonym,
    ),
  )
  if (!match) return null

  const members = await db
    .select({ userId: member.userId })
    .from(member)
    .where(eq(member.organizationId, match.id))
  const reporter = members.find(({ userId }) =>
    sameDigest(
      betaFeedbackPseudonym(secret, 'telemetry-actor', userId),
      pseudonyms.actorPseudonym,
    ),
  )
  return reporter ? { organizationId: match.id, userId: reporter.userId } : null
}
