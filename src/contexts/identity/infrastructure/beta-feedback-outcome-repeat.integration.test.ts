// ADR 0059 against real PostgreSQL: a report that returns to an outcome the
// reporter was already told about is not announced a second time.

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { drizzle } from 'drizzle-orm/node-postgres'
import type { Database } from '#/shared/db'
import { getEnv } from '#/shared/config/env'
import { acquireTestLease, type TestLease } from '#/shared/testing/test-environment-lease'
import { deleteTestOrganizations, seedOrgs } from '#/shared/testing/integration-helpers'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { BetaFeedbackTriageState } from '../domain/betaFeedbackTriage'
import { betaFeedbackPseudonym } from '../application/beta-feedback-pseudonym'
import { BetaFeedbackTriageRepository } from './beta-feedback-triage.repository'

const SECRET = 'integration-beta-feedback-outcome-repeat-secret'
const ORG = `org-bf-repeat-${randomUUID().slice(0, 8)}`
const REPORTER = `user-bf-repeat-${randomUUID().slice(0, 8)}`
const NOW = new Date('2026-09-18T08:00:00.000Z')
const RECIPIENT = { organizationId: ORG, userId: REPORTER }

let lease: TestLease
let repository: BetaFeedbackTriageRepository
const references = new Set<string>()

const operator = betaFeedbackPseudonym(SECRET, 'triage-operator', 'operator-1')
const owner = betaFeedbackPseudonym(SECRET, 'triage-owner', 'operator-1')

/** Walk a delivered report through `states`, one transition each. */
async function reportThrough(states: ReadonlyArray<BetaFeedbackTriageState>) {
  const reference = randomUUID()
  references.add(reference)
  await repository.prepare({
    reference,
    organizationPseudonym: betaFeedbackPseudonym(SECRET, 'telemetry-organization', ORG),
    actorPseudonym: betaFeedbackPseudonym(SECRET, 'telemetry-actor', REPORTER),
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
    providerReference: randomUUID().replaceAll('-', ''),
    expectedRevision: 0,
    now: NOW,
  })
  let revision = 1
  for (const toState of states) {
    await repository.transition({
      transitionId: randomUUID(),
      reference,
      operatorPseudonym: operator,
      now: NOW,
      outcomeRecipient: RECIPIENT,
      transition: {
        severity: 'P2',
        privacyClass: 'clear',
        securityClass: 'none',
        ownerQueue: 'engineering',
        ownerPseudonym: owner,
        customerResponse: toState === 'resolved' ? 'sent' : 'pending',
        duplicateOfReference: null,
        engineeringIssueRef: null,
        supportEvidenceRef: 'ticket-bf-repeat',
        expectedRevision: revision,
        toState,
        reproduction: toState === 'screened' ? 'pending' : 'reproduced',
        dedupeDisposition: toState === 'screened' ? 'pending' : 'unique',
        reasonCode: toState,
      },
    })
    revision += 1
  }
  return reference
}

async function announcedOutcomes(reference: string): Promise<ReadonlyArray<string>> {
  const result = await lease.pool.query<{ outcome: string }>(
    `SELECT payload->>'outcome' AS outcome FROM outbox_events
     WHERE event_type = 'identity.beta_feedback.outcome_reached'
       AND payload->>'reference' = $1`,
    [reference],
  )
  // Every fact carries the same test clock, so only the set is comparable.
  return result.rows.map((row) => row.outcome).sort()
}

beforeAll(async () => {
  registerAllEventSchemas()
  lease = await acquireTestLease(getEnv().DATABASE_URL)
  repository = BetaFeedbackTriageRepository.create(drizzle(lease.pool) as Database)
  await seedOrgs(lease.pool, [ORG])
})

afterAll(async () => {
  const refs = [...references]
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
  await deleteTestOrganizations(lease.pool, [ORG])
  await lease.release()
})

describe('an outcome the reporter was already told about', () => {
  it('is not announced again after the report went back to reproducing', async () => {
    const reference = await reportThrough([
      'screened',
      'accepted',
      'reproducing',
      'accepted',
    ])

    expect(await announcedOutcomes(reference)).toEqual(['accepted'])
  })

  it('is not announced again when a declined report is screened and declined again', async () => {
    const reference = await reportThrough([
      'screened',
      'declined',
      'screened',
      'declined',
    ])

    expect(await announcedOutcomes(reference)).toEqual(['declined'])
  })

  it('still announces an outcome that differs from the last one told', async () => {
    const reference = await reportThrough([
      'screened',
      'accepted',
      'resolved',
      'screened',
      'accepted',
    ])

    expect(await announcedOutcomes(reference)).toEqual([
      'accepted',
      'accepted',
      'resolved',
    ])
  })
})
