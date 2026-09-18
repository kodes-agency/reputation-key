// ADR 0059 against real PostgreSQL: the reporter is found from current
// membership, the outcome fact commits with the state, and the notification
// scope CHECK admits exactly one new shape.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import { betaFeedbackPseudonym } from '../application/beta-feedback-pseudonym'
import { BetaFeedbackTriageRepository } from './beta-feedback-triage.repository'
import { resolveBetaFeedbackReporter } from './beta-feedback-reporter'

const SECRET = 'integration-beta-feedback-outcome-secret'
const ORG = `org-bf-outcome-${randomUUID().slice(0, 8)}`
const REPORTER = `user-bf-reporter-${randomUUID().slice(0, 8)}`
const COLLEAGUE = `user-bf-colleague-${randomUUID().slice(0, 8)}`
const NOW = new Date('2026-09-18T08:00:00.000Z')

let lease: TestLease
let db: Database
let repository: BetaFeedbackTriageRepository
const references = new Set<string>()

const orgPseudonym = betaFeedbackPseudonym(SECRET, 'telemetry-organization', ORG)
const actorPseudonym = betaFeedbackPseudonym(SECRET, 'telemetry-actor', REPORTER)
const operator = betaFeedbackPseudonym(SECRET, 'triage-operator', 'operator-1')
const owner = betaFeedbackPseudonym(SECRET, 'triage-owner', 'operator-1')

const classification = {
  severity: 'P2',
  privacyClass: 'clear',
  securityClass: 'none',
  ownerQueue: 'engineering',
  ownerPseudonym: owner,
  customerResponse: 'pending',
  duplicateOfReference: null,
  engineeringIssueRef: null,
  supportEvidenceRef: 'ticket-bf-outcome',
} as const

/** A delivered report, screened and ready for a decision (revision 2). */
async function screenedReport(): Promise<string> {
  const reference = randomUUID()
  references.add(reference)
  await repository.prepare({
    reference,
    organizationPseudonym: orgPseudonym,
    actorPseudonym,
    feedbackType: 'bug',
    impactCode: 'cannot_complete',
    routeKey: 'inbox',
    viewport: 'wide',
    reporterRole: 'PropertyManager',
    clientErrorEventId: null,
    attachmentKind: 'none',
    attachmentCapturedAt: null,
    attachmentExpiresAt: null,
    maskedLayout: null,
    now: NOW,
  })
  await repository.markDelivered({
    reference,
    // Provider references are unique per report.
    providerReference: randomUUID().replaceAll('-', ''),
    expectedRevision: 0,
    now: NOW,
  })
  await repository.transition({
    transitionId: randomUUID(),
    reference,
    operatorPseudonym: operator,
    now: NOW,
    transition: {
      ...classification,
      expectedRevision: 1,
      toState: 'screened',
      reproduction: 'pending',
      dedupeDisposition: 'pending',
      reasonCode: 'screen',
    },
  })
  return reference
}

const accept = (
  reference: string,
  expectedRevision: number,
  transitionId = randomUUID(),
) => ({
  transitionId,
  reference,
  operatorPseudonym: operator,
  now: NOW,
  transition: {
    ...classification,
    expectedRevision,
    toState: 'accepted' as const,
    reproduction: 'reproduced' as const,
    dedupeDisposition: 'unique' as const,
    reasonCode: 'accept',
  },
})

async function outcomeFacts(reference: string) {
  const result = await lease.pool.query<{
    organization_id: string
    property_id: string | null
    payload: Record<string, unknown>
  }>(
    `SELECT organization_id, property_id, payload FROM outbox_events
     WHERE event_type = 'identity.beta_feedback.outcome_reached'
       AND payload->>'reference' = $1`,
    [reference],
  )
  return result.rows
}

beforeAll(async () => {
  // The app registers these at boot; the outbox refuses an unregistered fact.
  registerAllEventSchemas()
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  db = drizzle(lease.pool) as Database
  repository = BetaFeedbackTriageRepository.create(db)
  await seedOrgs(lease.pool, [ORG])
  for (const id of [REPORTER, COLLEAGUE]) {
    await lease.pool.query(
      `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $1, $2, true, $3, $3)`,
      [id, `${id}@example.test`, NOW],
    )
    await lease.pool.query(
      `INSERT INTO member (id, "userId", "organizationId", role, "createdAt")
       VALUES ($1, $2, $3, 'admin', $4)`,
      [`${id}-member`, id, ORG, NOW],
    )
  }
})

afterAll(async () => {
  const refs = [...references]
  if (refs.length > 0) {
    await lease.pool.query(
      `DELETE FROM outbox_events WHERE event_type = 'identity.beta_feedback.outcome_reached'
         AND payload->>'reference' = ANY($1::text[])`,
      [refs],
    )
    await lease.pool.query(
      'DELETE FROM beta_feedback_triage_transitions WHERE feedback_reference = ANY($1::uuid[])',
      [refs],
    )
    await lease.pool.query(
      'DELETE FROM beta_feedback_triage WHERE reference = ANY($1::uuid[])',
      [refs],
    )
  }
  await lease.pool.query('DELETE FROM notifications WHERE organization_id = $1', [ORG])
  await deleteTestOrganizations(lease.pool, [ORG])
  await lease.pool.query('DELETE FROM "user" WHERE id = ANY($1::text[])', [
    [REPORTER, COLLEAGUE],
  ])
  await lease.release()
})

describe('reporter resolution', () => {
  it('finds the reporter from their pseudonyms and current membership', async () => {
    await expect(
      resolveBetaFeedbackReporter(db, SECRET, {
        organizationPseudonym: orgPseudonym,
        actorPseudonym,
      }),
    ).resolves.toEqual({ organizationId: ORG, userId: REPORTER })
  })

  it('finds nobody under a different secret, so a pseudonym is not a lookup key', async () => {
    await expect(
      resolveBetaFeedbackReporter(db, 'another-secret', {
        organizationPseudonym: orgPseudonym,
        actorPseudonym,
      }),
    ).resolves.toBeNull()
  })

  it('finds nobody once the reporter has left the Organization', async () => {
    const leaver = betaFeedbackPseudonym(SECRET, 'telemetry-actor', 'user-who-left')

    await expect(
      resolveBetaFeedbackReporter(db, SECRET, {
        organizationPseudonym: orgPseudonym,
        actorPseudonym: leaver,
      }),
    ).resolves.toBeNull()
  })
})

describe('outcome fact', () => {
  it('commits with the transition that reaches an outcome', async () => {
    const reference = await screenedReport()

    await repository.transition({
      ...accept(reference, 2),
      outcomeRecipient: { organizationId: ORG, userId: REPORTER },
    })

    const facts = await outcomeFacts(reference)
    expect(facts).toHaveLength(1)
    expect(facts[0]).toMatchObject({
      organization_id: ORG,
      property_id: null,
      payload: { organizationId: ORG, userId: REPORTER, reference, outcome: 'accepted' },
    })
  })

  it('writes nothing when the reporter could not be found', async () => {
    const reference = await screenedReport()

    await repository.transition({ ...accept(reference, 2), outcomeRecipient: null })

    expect(await outcomeFacts(reference)).toEqual([])
  })

  it('writes nothing for a self-transition such as linking an issue', async () => {
    const reference = await screenedReport()
    const recipient = { organizationId: ORG, userId: REPORTER }
    await repository.transition({ ...accept(reference, 2), outcomeRecipient: recipient })

    await repository.transition({
      ...accept(reference, 3),
      transition: {
        ...accept(reference, 3).transition,
        engineeringIssueRef: '591',
        reasonCode: 'engineering_issue_linked',
      },
      outcomeRecipient: recipient,
    })

    expect(await outcomeFacts(reference)).toHaveLength(1)
  })

  it('does not write a second fact when a transition is replayed', async () => {
    const reference = await screenedReport()
    const transitionId = randomUUID()
    const recipient = { organizationId: ORG, userId: REPORTER }

    await repository.transition({
      ...accept(reference, 2, transitionId),
      outcomeRecipient: recipient,
    })
    await repository.transition({
      ...accept(reference, 2, transitionId),
      outcomeRecipient: recipient,
    })

    expect(await outcomeFacts(reference)).toHaveLength(1)
  })
})

describe('notification scope CHECK', () => {
  type Row = Readonly<{
    type: string
    category: string
    propertyId: string | null
    resourceType: string
  }>

  const insert = (row: Row) =>
    lease.pool.query(
      `INSERT INTO notifications
         (id, user_id, organization_id, property_id, type, category, priority, status,
          resource_type, resource_id, event_id, title)
       VALUES ($1, $2, $3, $4, $5, $6, 'normal', 'unread', $7, $8, $9, 'x')`,
      [
        randomUUID(),
        REPORTER,
        ORG,
        row.propertyId,
        row.type,
        row.category,
        row.resourceType,
        randomUUID(),
        randomUUID(),
      ],
    )

  const refusedBy = async (row: Row): Promise<string | undefined> => {
    const caught: unknown = await insert(row).then(
      () => null,
      (error: unknown) => error,
    )
    expect(caught, 'expected PostgreSQL to refuse the row').not.toBeNull()
    return (caught as { constraint?: string }).constraint
  }

  it('admits a report outcome scoped to the Organization and pointing at the report', async () => {
    await expect(
      insert({
        type: 'beta_feedback.outcome',
        category: 'workflow_collaboration',
        propertyId: null,
        resourceType: 'beta_feedback_report',
      }),
    ).resolves.toBeDefined()
  })

  it('still refuses any other non-mandatory notice without a Property', async () => {
    await expect(
      refusedBy({
        type: 'reply.approved',
        category: 'workflow_collaboration',
        propertyId: null,
        resourceType: 'beta_feedback_report',
      }),
    ).resolves.toBe('notifications_mandatory_scope_check')
  })

  it('refuses a report outcome pointing at the Organization', async () => {
    await expect(
      refusedBy({
        type: 'beta_feedback.outcome',
        category: 'workflow_collaboration',
        propertyId: null,
        resourceType: 'organization',
      }),
    ).resolves.toBe('notifications_mandatory_scope_check')
  })

  it('refuses a report outcome dressed as a mandatory notice', async () => {
    await expect(
      refusedBy({
        type: 'beta_feedback.outcome',
        category: 'mandatory',
        propertyId: null,
        resourceType: 'beta_feedback_report',
      }),
    ).resolves.toBe('notifications_mandatory_scope_check')
  })
})
