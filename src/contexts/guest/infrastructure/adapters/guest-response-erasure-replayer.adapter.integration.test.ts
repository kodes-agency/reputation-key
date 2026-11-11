// Journaled Guest response erasures against real PostgreSQL: replay stays inside the
// entry's Organization and ids, and the operator erase commits without a session match.
// An outer transaction always rolls the proof back.

import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { getDb } from '#/shared/db'
import type { Database } from '#/shared/db'
import type { BackupErasureLedgerEntry } from '#/shared/db/lifecycle/backup-erasure-ledger'
import { decodeErasureJournalEntry } from '#/shared/db/lifecycle/erasure-journal.server'
import {
  guestResponseId,
  guestSessionId,
  organizationId as toOrganizationId,
  portalId as toPortalId,
  propertyId as toPropertyId,
} from '#/shared/domain/ids'
import { registerAllEventSchemas } from '#/shared/events/schema-registrations'
import type { Tx } from '#/shared/outbox/commit'
import type { GuestResponse } from '../../domain/guest-response'
import { createAtomicGuestResponseCommandStore } from '../guest-response-command-store'
import {
  createGuestFeedbackErasureReplayer,
  createGuestResponseErasureReplayer,
} from './guest-response-erasure-replayer.adapter'

const db = getDb()

beforeAll(() => {
  registerAllEventSchemas()
})
const ROLLBACK = new Error('rollback guest response erasure replay proof')
const ERASED_AT = new Date('2026-11-08T12:00:00.000Z')
const PRIVATE_TEXT = 'NEVER_SURVIVE_REPLAY_FEEDBACK_BODY'
const CONTACT_CIPHERTEXT = 'NEVER_SURVIVE_REPLAY_CONTACT_CIPHERTEXT'

type Cell = Readonly<{
  organizationId: string
  propertyId: string
  portalId: string
  responseId: string
  otherResponseId: string
}>

async function seedResponse(
  tx: Tx,
  cell: Pick<Cell, 'organizationId' | 'propertyId' | 'portalId'>,
  responseId: string,
): Promise<void> {
  await tx.execute(sql`
    INSERT INTO guest_responses (
      id, organization_id, property_id, portal_id, status, rating, response_consent,
      text_consent, private_feedback_threshold, correction_count,
      rating_source_event_id, feedback_source_event_id, submitted_at,
      feedback_submitted_at, feedback_submission_revision, retention_deadline,
      created_at, updated_at
    ) VALUES (
      ${responseId}::uuid, ${cell.organizationId}, ${cell.propertyId}::uuid,
      ${cell.portalId}::uuid, 'submitted', 2, true, true, 3, 0,
      ${randomUUID()}, ${randomUUID()}, clock_timestamp(), clock_timestamp(), 1,
      clock_timestamp() + interval '700 days', clock_timestamp(), clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_response_private_feedback (
      response_id, organization_id, property_id, portal_id, body, submitted_at,
      expires_at, created_at
    ) VALUES (
      ${responseId}::uuid, ${cell.organizationId}, ${cell.propertyId}::uuid,
      ${cell.portalId}::uuid, ${PRIVATE_TEXT}, clock_timestamp(),
      clock_timestamp() + interval '88 days', clock_timestamp()
    )
  `)
}

/** A Contact Request with an encrypted contact and one reveal audit for the response. */
async function seedContact(
  tx: Tx,
  cell: Pick<Cell, 'organizationId' | 'propertyId' | 'portalId'>,
  responseId: string,
  version: number,
): Promise<void> {
  const snapshotId = randomUUID()
  const contactRequestId = randomUUID()
  const digest = 'a'.repeat(64)
  await tx.execute(sql`
    INSERT INTO portal_publication_snapshots (
      id, organization_id, property_id, portal_id, version, configuration_digest,
      configuration, guest_locale, language_pack_version, private_feedback_threshold,
      contact_request_enabled, contact_notice_id, contact_notice_version,
      contact_notice_digest, contact_notice_locale, destination_uri,
      destination_retrieved_at, destination_source_epoch,
      destination_profile_version, created_by, created_at
    ) VALUES (
      ${snapshotId}::uuid, ${cell.organizationId}, ${cell.propertyId}::uuid,
      ${cell.portalId}::uuid, ${version}, ${digest}, '{}'::jsonb, 'en', 'guest-ui-en-v1', 3,
      true, 'guest-contact-notice', 'v1', ${digest}, 'en',
      'https://example.test/review', clock_timestamp(), 0, 1,
      'replay-proof-actor', clock_timestamp()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_contact_requests (
      id, organization_id, property_id, portal_id, response_id,
      publication_snapshot_id, publication_version, publication_digest,
      contact_request_enabled, notice_id, notice_version, notice_digest,
      notice_locale, retention_policy_version, purpose, consent_granted,
      encrypted_contact, encryption_key_id, status, submitted_at, expires_at,
      created_at, updated_at
    ) VALUES (
      ${contactRequestId}::uuid, ${cell.organizationId}, ${cell.propertyId}::uuid,
      ${cell.portalId}::uuid, ${responseId}::uuid, ${snapshotId}::uuid, ${version},
      ${digest}, true, 'guest-contact-notice', 'v1', ${digest}, 'en',
      'guest-contact-retention-30d-v1', 'manager_follow_up', true,
      ${CONTACT_CIPHERTEXT}, 'guest-contact-v1', 'active', now(),
      now() + interval '720 hours', now(), now()
    )
  `)
  await tx.execute(sql`
    INSERT INTO guest_contact_request_reveal_audits (
      id, contact_request_id, organization_id, property_id, portal_id, actor_id,
      access_purpose, authority_basis, revealed_at, created_at
    ) VALUES (
      gen_random_uuid(), ${contactRequestId}::uuid, ${cell.organizationId},
      ${cell.propertyId}::uuid, ${cell.portalId}::uuid, 'replay-proof-actor',
      'respond_to_contact_request', 'account_admin', clock_timestamp(), clock_timestamp()
    )
  `)
}

async function contactRows(tx: Tx, organizationId: string): Promise<[number, number]> {
  const result = await tx.execute(sql`
    SELECT
      (SELECT COUNT(*)::int FROM guest_contact_requests
        WHERE organization_id = ${organizationId}) AS requests,
      (SELECT COUNT(*)::int FROM guest_contact_request_reveal_audits
        WHERE organization_id = ${organizationId}) AS audits
  `)
  const row = result.rows[0] as { requests: number; audits: number }
  return [row.requests, row.audits]
}

async function seedCell(tx: Tx): Promise<Cell> {
  const organizationId = `replay-org-${randomUUID()}`
  const cell = {
    organizationId,
    propertyId: randomUUID(),
    portalId: randomUUID(),
    responseId: randomUUID(),
    otherResponseId: randomUUID(),
  }
  await tx.execute(sql`
    INSERT INTO organization (id, name, slug, "createdAt")
    VALUES (${organizationId}, 'Replay Proof', ${organizationId}, clock_timestamp())
  `)
  await tx.execute(sql`
    INSERT INTO properties (id, organization_id, name, slug, timezone, created_at, updated_at)
    VALUES (${cell.propertyId}::uuid, ${organizationId}, 'Replay House',
            ${`replay-${cell.propertyId}`}, 'UTC', clock_timestamp(), clock_timestamp())
  `)
  await tx.execute(sql`
    INSERT INTO portals (id, organization_id, property_id, entity_id, name, slug,
                         publication_state, created_at, updated_at)
    VALUES (${cell.portalId}::uuid, ${organizationId}, ${cell.propertyId}::uuid,
            ${cell.propertyId}::uuid, 'Front Desk', ${`portal-${cell.portalId}`},
            'published', clock_timestamp(), clock_timestamp())
  `)
  await seedResponse(tx, cell, cell.responseId)
  await seedResponse(tx, cell, cell.otherResponseId)
  return cell
}

function entryFor(
  cell: Cell,
  kind: 'guest_response' | 'guest_feedback',
  organizationId = cell.organizationId,
): BackupErasureLedgerEntry {
  const id = randomUUID()
  return {
    id,
    recordedBeforeErasure: true,
    subjectClass: 'privacy_subject',
    organizationId,
    propertyId: cell.propertyId,
    subjectRef: 'a'.repeat(64),
    context: 'guest',
    closureLineageId: id,
    lifecycleRevision: 1,
    effectiveErasureAt: ERASED_AT,
    erasedRowCount: 0,
    evidenceRef: kind,
    journalTargets: { kind, ids: [cell.responseId] },
  } as BackupErasureLedgerEntry
}

type State = Readonly<{
  status: string
  rating: number | null
  deleted: boolean
  feedbackSourceEventId: string | null
  feedbackWithdrawn: boolean
  feedbackRows: number
}>

async function stateOf(tx: Tx, responseId: string): Promise<State> {
  const result = await tx.execute(sql`
    SELECT r.status, r.rating, r.deleted_at IS NOT NULL AS deleted,
           r.feedback_source_event_id AS "feedbackSourceEventId",
           r.feedback_withdrawn_at IS NOT NULL AS "feedbackWithdrawn",
           (SELECT COUNT(*)::int FROM guest_response_private_feedback f
             WHERE f.response_id = r.id) AS "feedbackRows"
    FROM guest_responses r WHERE r.id = ${responseId}::uuid
  `)
  return result.rows[0] as State
}

const untouched: State = {
  status: 'submitted',
  rating: 2,
  deleted: false,
  feedbackSourceEventId: expect.any(String) as unknown as string,
  feedbackWithdrawn: false,
  feedbackRows: 1,
}

async function inRolledBackTransaction(
  proof: (tx: Tx, cell: Cell) => Promise<void>,
): Promise<void> {
  await expect(
    db.transaction(async (raw) => {
      const tx = raw as unknown as Tx
      await proof(tx, await seedCell(tx))
      throw ROLLBACK
    }),
  ).rejects.toBe(ROLLBACK)
}

describe('guest response erasure replayers (real PostgreSQL)', () => {
  it('re-erases a resurrected response and its feedback, and nothing else', async () => {
    await inRolledBackTransaction(async (tx, cell) => {
      const otherCell = await seedCell(tx)

      const count = await createGuestResponseErasureReplayer().reErase(
        tx,
        entryFor(cell, 'guest_response'),
      )

      expect(count).toBe(2)
      expect(await stateOf(tx, cell.responseId)).toMatchObject({
        status: 'deleted',
        rating: null,
        deleted: true,
        feedbackSourceEventId: null,
        feedbackRows: 0,
      })
      // Another subject in the same Organization and another Organization stay intact.
      expect(await stateOf(tx, cell.otherResponseId)).toMatchObject(untouched)
      expect(await stateOf(tx, otherCell.responseId)).toMatchObject(untouched)

      // Convergent: replaying again changes nothing.
      expect(
        await createGuestResponseErasureReplayer().reErase(
          tx,
          entryFor(cell, 'guest_response'),
        ),
      ).toBe(0)
    })
  })

  it('re-erases the linked contact request and its reveal audits', async () => {
    await inRolledBackTransaction(async (tx, cell) => {
      await seedContact(tx, cell, cell.responseId, 1)
      await seedContact(tx, cell, cell.otherResponseId, 2)

      const count = await createGuestResponseErasureReplayer().reErase(
        tx,
        entryFor(cell, 'guest_response'),
      )

      expect(count).toBe(3)
      // Only the contact of the erased response goes; the other response keeps its own.
      expect(await contactRows(tx, cell.organizationId)).toEqual([1, 1])
    })
  })

  it('does not reach a response whose id is journaled under another Organization', async () => {
    await inRolledBackTransaction(async (tx, cell) => {
      const otherCell = await seedCell(tx)

      const count = await createGuestResponseErasureReplayer().reErase(
        tx,
        entryFor(cell, 'guest_response', otherCell.organizationId),
      )

      expect(count).toBe(0)
      expect(await stateOf(tx, cell.responseId)).toMatchObject(untouched)
    })
  })

  it('re-erases resurrected private feedback and keeps the rating', async () => {
    await inRolledBackTransaction(async (tx, cell) => {
      const otherCell = await seedCell(tx)

      const count = await createGuestFeedbackErasureReplayer().reErase(
        tx,
        entryFor(cell, 'guest_feedback'),
      )

      expect(count).toBe(2)
      expect(await stateOf(tx, cell.responseId)).toMatchObject({
        status: 'submitted',
        rating: 2,
        deleted: false,
        feedbackSourceEventId: null,
        feedbackWithdrawn: true,
        feedbackRows: 0,
      })
      expect(await stateOf(tx, cell.otherResponseId)).toMatchObject(untouched)
      expect(await stateOf(tx, otherCell.responseId)).toMatchObject(untouched)

      expect(
        await createGuestFeedbackErasureReplayer().reErase(
          tx,
          entryFor(cell, 'guest_feedback'),
        ),
      ).toBe(0)
    })
  })

  it('does not reach feedback journaled under another Organization', async () => {
    await inRolledBackTransaction(async (tx, cell) => {
      const otherCell = await seedCell(tx)

      const count = await createGuestFeedbackErasureReplayer().reErase(
        tx,
        entryFor(cell, 'guest_feedback', otherCell.organizationId),
      )

      expect(count).toBe(0)
      expect(await stateOf(tx, cell.responseId)).toMatchObject(untouched)
    })
  })
})

describe('operator erasure commit (real PostgreSQL)', () => {
  it('erases without a session match, deletes private feedback and journals the ids', async () => {
    await inRolledBackTransaction(async (tx, cell) => {
      const put = vi.fn().mockResolvedValue(undefined)
      const store = createAtomicGuestResponseCommandStore(
        tx as unknown as Database,
        () => ERASED_AT,
        { put, alert: vi.fn(), idGen: () => randomUUID() },
      )
      const current = await tx.execute(sql`
        SELECT rating_source_event_id AS "ratingSourceEventId",
               feedback_source_event_id AS "feedbackSourceEventId"
        FROM guest_responses WHERE id = ${cell.responseId}::uuid
      `)
      const sources = current.rows[0] as {
        ratingSourceEventId: string
        feedbackSourceEventId: string
      }
      // No session binding row exists for this response.
      const response = {
        id: guestResponseId(cell.responseId),
        organizationId: toOrganizationId(cell.organizationId),
        propertyId: toPropertyId(cell.propertyId),
        portalId: toPortalId(cell.portalId),
        sessionId: guestSessionId(randomUUID()),
        status: 'deleted',
        correctionCount: 0,
        staffAttribution: null,
        ratingSourceEventId: sources.ratingSourceEventId,
        feedbackSourceEventId: sources.feedbackSourceEventId,
        deletedAt: ERASED_AT,
      } as unknown as GuestResponse

      await expect(store.commitErased(response, [])).resolves.toBe('applied')

      expect(await stateOf(tx, cell.responseId)).toMatchObject({
        status: 'deleted',
        deleted: true,
        feedbackRows: 0,
      })
      expect(await stateOf(tx, cell.otherResponseId)).toMatchObject(untouched)
      expect(put).toHaveBeenCalledOnce()
      expect(decodeErasureJournalEntry(put.mock.calls[0]![1]).journalTargets).toEqual({
        kind: 'guest_response',
        ids: [cell.responseId],
      })

      // Already erased: a second erase conflicts rather than rewriting.
      await expect(store.commitErased(response, [])).resolves.toBe('conflict')
    })
  })

  it('deletes the linked contact request and its reveal audits with the response', async () => {
    await inRolledBackTransaction(async (tx, cell) => {
      await seedContact(tx, cell, cell.responseId, 1)
      await seedContact(tx, cell, cell.otherResponseId, 2)
      const store = createAtomicGuestResponseCommandStore(
        tx as unknown as Database,
        () => ERASED_AT,
        {
          put: vi.fn().mockResolvedValue(undefined),
          alert: vi.fn(),
          idGen: () => randomUUID(),
        },
      )
      const current = await tx.execute(sql`
        SELECT rating_source_event_id AS "ratingSourceEventId",
               feedback_source_event_id AS "feedbackSourceEventId"
        FROM guest_responses WHERE id = ${cell.responseId}::uuid
      `)
      const sources = current.rows[0] as {
        ratingSourceEventId: string
        feedbackSourceEventId: string
      }
      const response = {
        id: guestResponseId(cell.responseId),
        organizationId: toOrganizationId(cell.organizationId),
        propertyId: toPropertyId(cell.propertyId),
        portalId: toPortalId(cell.portalId),
        sessionId: guestSessionId(randomUUID()),
        status: 'deleted',
        correctionCount: 0,
        staffAttribution: null,
        ratingSourceEventId: sources.ratingSourceEventId,
        feedbackSourceEventId: sources.feedbackSourceEventId,
        deletedAt: ERASED_AT,
      } as unknown as GuestResponse

      await expect(store.commitErased(response, [])).resolves.toBe('applied')

      expect(await contactRows(tx, cell.organizationId)).toEqual([1, 1])
    })
  })
})
