// LIF-01-T20 — Guest's privacy subject contributor.
//
// SUBJECT IDENTITY. A Guest has no account. The only thing that binds a person
// to their submissions is the session the Portal issued them, held in
// `guest_response_session_bindings.session_id`. The privacy request therefore
// carries the SHA-256 of that session id as the subject reference, and this
// adapter resolves it by hashing the session id inside the
// database — the plaintext session id is never sent to the application, and the
// request record never holds it. `sha256(convert_to(...))` is the built-in
// digest — pgcrypto is not installed in this cell, and adding an extension for
// one expression would be a deployment dependency for a privacy read path.
//
// SCOPE. Every statement filters on organization_id AND property_id AND the
// subject digest. `resolve` is separate from `access` precisely so a
// cross-tenant or cross-property lookup is refused BEFORE any row is read: an
// empty package and "not your data" must not look the same.
//
// WITHDRAWAL leaves a minimal tombstone rather than deleting the response. The
// `guest_responses` row is content-free once the rating and private feedback
// are gone, and it is what a notification deep link resolves against — deleting
// it would turn an honest "withdrawn" screen into a 404 that tells the guest
// nothing.

import { sql } from 'drizzle-orm'
import type {
  PrivacyContributorCounts,
  PrivacyCorrectionRequest,
  PrivacyPackageSection,
  PrivacySubjectContributor,
  PrivacySubjectScope,
} from '#/shared/ops/privacy/privacy-subject-contributor.port'
import { privacyRequestError } from '#/shared/ops/privacy/privacy-request'
import type { Tx } from '#/shared/outbox/commit'

/** The only fields a Guest may correct. Anything else is not their data. */
const CORRECTABLE_FIELDS = new Set(['rating', 'private_feedback_body'])

/**
 * Response ids belonging to this subject within EXACTLY this tenant/property.
 *
 * The digest is computed in SQL so the plaintext session id never leaves the
 * database, and the join is anchored on the session binding so a response with
 * no binding (and therefore no provable owner) is never returned.
 */
const subjectResponses = (scope: PrivacySubjectScope) => sql`
  SELECT b.response_id
  FROM guest_response_session_bindings b
  WHERE b.organization_id = ${scope.organizationId}
    AND b.property_id = ${scope.propertyId}::uuid
    AND encode(sha256(convert_to(b.session_id::text, 'UTF8')), 'hex') = ${scope.subjectRef}
`

const countRows = async (tx: Tx, statement: ReturnType<typeof sql>): Promise<number> => {
  const result = await tx.execute(statement)
  return Number((result.rows[0] as { rows: number | string } | undefined)?.rows ?? 0)
}

export const createGuestPrivacySubjectContributor = (): PrivacySubjectContributor => ({
  context: 'guest',

  resolve: async (tx, scope) => {
    if (scope.subjectType !== 'guest') return false
    return (
      (await countRows(
        tx,
        sql`SELECT COUNT(*)::int AS "rows" FROM (${subjectResponses(scope)}) s`,
      )) > 0
    )
  },

  access: async (tx, scope): Promise<readonly PrivacyPackageSection[]> => {
    if (scope.subjectType !== 'guest') return []
    // Only the subject's own rows, only in this tenant and Property. No
    // encryption key material, no other subject's response, no manager notes.
    const responses = await tx.execute(sql`
      SELECT r.id, r.status, r.rating, r.response_consent, r.text_consent,
             r.submitted_at, r.corrected_at, r.feedback_withdrawn_at
      FROM guest_responses r
      WHERE r.organization_id = ${scope.organizationId}
        AND r.property_id = ${scope.propertyId}::uuid
        AND r.id IN (${subjectResponses(scope)})
      ORDER BY r.id
    `)
    const feedback = await tx.execute(sql`
      SELECT f.response_id, f.body, f.submitted_at, f.expires_at
      FROM guest_response_private_feedback f
      WHERE f.organization_id = ${scope.organizationId}
        AND f.property_id = ${scope.propertyId}::uuid
        AND f.response_id IN (${subjectResponses(scope)})
      ORDER BY f.response_id
    `)
    const contact = await tx.execute(sql`
      SELECT c.id, c.purpose, c.consent_granted, c.status, c.submitted_at,
             c.expires_at, c.withdrawn_at
      FROM guest_contact_requests c
      WHERE c.organization_id = ${scope.organizationId}
        AND c.property_id = ${scope.propertyId}::uuid
        AND c.response_id IN (${subjectResponses(scope)})
      ORDER BY c.id
    `)
    return [
      {
        context: 'guest',
        table: 'guest_responses',
        classification: 'personal',
        records: responses.rows as readonly Record<string, unknown>[],
      },
      {
        context: 'guest',
        table: 'guest_response_private_feedback',
        classification: 'sensitive',
        records: feedback.rows as readonly Record<string, unknown>[],
      },
      {
        // The ciphertext and the key id are deliberately NOT selected: they are
        // secrets, and a privacy export must never widen access to them.
        context: 'guest',
        table: 'guest_contact_requests',
        classification: 'sensitive',
        records: contact.rows as readonly Record<string, unknown>[],
      },
    ]
  },

  /**
   * Update ONLY the named field.
   *
   * `correction_count` and `corrected_at` advance so the correction is visible
   * to the Metric projection, but the response row itself — the correction root
   * and its prior-value history — is preserved.
   */
  correct: async (
    tx: Tx,
    request: PrivacyCorrectionRequest,
  ): Promise<PrivacyContributorCounts> => {
    if (request.scope.subjectType !== 'guest') return { affected: 0 }
    if (!CORRECTABLE_FIELDS.has(request.field)) {
      throw privacyRequestError(
        'subject_content_in_record',
        `Guest subjects may not correct "${request.field}"`,
      )
    }
    const scope = request.scope
    if (request.field === 'rating') {
      const updated = await tx.execute(sql`
        UPDATE guest_responses
        SET rating = ${Number(request.value)},
            -- The product caps a Guest at one correction; the CHECK enforces
            -- it, so a second correction must not blow up the privacy path.
            correction_count = LEAST(correction_count + 1, 1),
            corrected_at = now(),
            updated_at = now()
        WHERE organization_id = ${scope.organizationId}
          AND property_id = ${scope.propertyId}::uuid
          AND id IN (${subjectResponses(scope)})
        RETURNING id
      `)
      return { affected: updated.rows.length }
    }
    const updated = await tx.execute(sql`
      UPDATE guest_response_private_feedback
      SET body = ${String(request.value)}
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND response_id IN (${subjectResponses(scope)})
      RETURNING response_id
    `)
    return { affected: updated.rows.length }
  },

  /**
   * Retract the rating and the feedback, leaving a minimal tombstone.
   *
   * The `guest_responses` row survives with no rating and a withdrawal instant,
   * so a notification deep link resolves to an honest withdrawn/redacted state
   * instead of vanishing.
   */
  withdraw: async (tx, scope): Promise<PrivacyContributorCounts> => {
    if (scope.subjectType !== 'guest') return { affected: 0 }
    const feedback = await tx.execute(sql`
      DELETE FROM guest_response_private_feedback
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND response_id IN (${subjectResponses(scope)})
      RETURNING response_id
    `)
    const responses = await tx.execute(sql`
      UPDATE guest_responses
      SET rating = NULL,
          -- guest_responses_status_valid admits no 'withdrawn' value, and
          -- inventing one would be a vocabulary change on a live compatibility
          -- surface. The honest withdrawal signal is feedback_withdrawn_at
          -- with a null rating; the status records that the guest changed
          -- their submission.
          status = 'corrected',
          feedback_withdrawn_at = now(),
          -- guest_responses_feedback_withdrawal_valid requires both of these
          -- alongside the withdrawal instant: consent is gone with the text.
          text_consent = false,
          feedback_source_event_id = NULL,
          correction_count = LEAST(correction_count + 1, 1),
          corrected_at = now(),
          updated_at = now()
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND id IN (${subjectResponses(scope)})
        AND feedback_withdrawn_at IS NULL
      RETURNING id
    `)
    return { affected: feedback.rows.length + responses.rows.length }
  },

  /**
   * IRREVERSIBLE. Feedback text, permitted contact and the reveal audits for
   * that contact all go; the content-free `guest_responses` fact and the
   * anonymous lifetime aggregate survive.
   */
  erase: async (tx, scope): Promise<PrivacyContributorCounts> => {
    if (scope.subjectType !== 'guest') return { affected: 0 }
    const reveals = await tx.execute(sql`
      DELETE FROM guest_contact_request_reveal_audits
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND contact_request_id IN (
          SELECT c.id FROM guest_contact_requests c
          WHERE c.organization_id = ${scope.organizationId}
            AND c.property_id = ${scope.propertyId}::uuid
            AND c.response_id IN (${subjectResponses(scope)})
        )
      RETURNING id
    `)
    const contact = await tx.execute(sql`
      DELETE FROM guest_contact_requests
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND response_id IN (${subjectResponses(scope)})
      RETURNING id
    `)
    const feedback = await tx.execute(sql`
      DELETE FROM guest_response_private_feedback
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND response_id IN (${subjectResponses(scope)})
      RETURNING response_id
    `)
    // The rating and consent flags go with the text; the row stays as a
    // content-free fact so the anonymous aggregate remains rebuildable.
    //
    // `status` and `deleted_at` are deliberately NOT touched. Marking the row
    // deleted would remove it from the projection that rebuilds the anonymous
    // lifetime aggregate, which is the one thing an erasure must leave standing.
    const responses = await tx.execute(sql`
      UPDATE guest_responses
      SET rating = NULL,
          text_consent = false,
          media_consent = false,
          feedback_source_event_id = NULL,
          feedback_withdrawn_at = CASE
            WHEN feedback_submitted_at IS NULL THEN NULL
            ELSE COALESCE(feedback_withdrawn_at, now())
          END,
          updated_at = now()
      WHERE organization_id = ${scope.organizationId}
        AND property_id = ${scope.propertyId}::uuid
        AND id IN (${subjectResponses(scope)})
      RETURNING id
    `)
    return {
      affected:
        reveals.rows.length +
        contact.rows.length +
        feedback.rows.length +
        responses.rows.length,
    }
  },
})
