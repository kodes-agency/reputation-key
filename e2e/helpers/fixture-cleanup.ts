import { dbQuery } from './fixture-db'

// ── Cleanup (prefix-scoped, FK-safe order) ────────────────────────────

/**
 * Every review a spec's prefix reaches — by its own external id, OR through the
 * prefixed property or Google connection that owns it.
 *
 * external_id alone was too narrow. Specs routinely seed a review whose id has
 * to match a provider resource name (`dis-r1`, `happy-r1`) while the prefix
 * lives on the property slug and the connection subject. Those reviews matched
 * none of the review-anchored deletes below, survived into the next run, and
 * the property sweep later tried to cascade them away — which
 * `inbox_handling_cycle_heads_material_revision_fk` (RESTRICT) refuses, so
 * cleanup aborted and left the database permanently poisoned for that file.
 */
const FIXTURE_REVIEWS = `SELECT r.id FROM reviews r
     JOIN properties p ON p.id = r.property_id
     LEFT JOIN review_source_contents c ON c.review_id = r.id
     LEFT JOIN google_connections gc ON gc.id = p.google_connection_id
     WHERE r.organization_id = $1
       AND (c.external_id LIKE $2 OR p.slug LIKE $2 OR gc.google_subject LIKE $2)`

/**
 * Delete every fixture-created row matching the spec's prefix, in FK-safe
 * order. Prefixes match: review_source_contents.external_id, google_connections.google_subject,
 * properties.slug, user.email. Call in beforeEach so reruns start clean.
 */
export async function cleanupE2eData(input: {
  organizationId: string
  prefix: string
}): Promise<void> {
  const like = `${input.prefix}%`
  const args = [input.organizationId, like]
  // Inbox first: inbox_items has no FK to reviews, so it does not cascade, and
  // its handling-cycle heads RESTRICT onto material_review_revisions — which is
  // what a review DELETE would otherwise cascade into.
  await dbQuery(
    `DELETE FROM inbox_notes WHERE inbox_item_id IN (
       SELECT id FROM inbox_items WHERE organization_id = $1 AND source_id IN (${FIXTURE_REVIEWS}))`,
    args,
  )
  await dbQuery(
    `DELETE FROM inbox_items WHERE organization_id = $1 AND source_id IN (${FIXTURE_REVIEWS})`,
    args,
  )
  // Then the RESTRICT children of reviews that publishing creates. (The CASCADE
  // ones — ai_review_analyses, review_source_contents, review_source_observations,
  // material_review_revisions — need no statement of their own.)
  // Reply publication has a dependency graph of its own, unwound from the
  // leaves. Observation HEADS point at observations; observations and attempts
  // then point at EACH OTHER -- an attempt names the observation that confirmed
  // it, and an observation names the attempt it matched. Neither order works,
  // and the columns cannot simply be nulled: check constraints couple each
  // reference to the row's outcome, on purpose.
  //
  // Both sides therefore go in ONE statement. RESTRICT is checked at the end of
  // the statement, by which point neither row is left to reference the other.
  await dbQuery(
    `DELETE FROM google_reply_observation_heads WHERE review_id IN (${FIXTURE_REVIEWS})`,
    args,
  )
  await dbQuery(
    `WITH observations AS (
       DELETE FROM google_reply_observations WHERE review_id IN (${FIXTURE_REVIEWS})
       RETURNING 1
     )
     DELETE FROM reply_publication_attempts WHERE review_id IN (${FIXTURE_REVIEWS})`,
    args,
  )
  await dbQuery(
    `DELETE FROM reply_publication_authorizations
     WHERE review_id IN (${FIXTURE_REVIEWS})`,
    args,
  )
  await dbQuery(`DELETE FROM replies WHERE review_id IN (${FIXTURE_REVIEWS})`, args)
  await dbQuery(`DELETE FROM reviews WHERE id IN (${FIXTURE_REVIEWS})`, args)
  // Remove grants for prefix-matched users and properties before their RESTRICT parents.
  await dbQuery(
    `DELETE FROM property_access_grant WHERE organization_id = $1 AND (
       user_id IN (SELECT id FROM "user" WHERE email LIKE $2) OR
       property_id IN (SELECT id FROM properties WHERE organization_id = $1 AND slug LIKE $2))`,
    [input.organizationId, like],
  )
  await dbQuery(
    'DELETE FROM notifications WHERE user_id IN (SELECT id FROM "user" WHERE email LIKE $1)',
    [like],
  )
  await dbQuery('DELETE FROM invitation WHERE email LIKE $1', [like])
  await dbQuery(
    `DELETE FROM idempotency_receipts
     WHERE scope = 'property_operation'
       AND payload->>'organizationId' = $1
       AND payload->>'destinationPropertyId' IN (
         SELECT p.id::text
         FROM properties p
         LEFT JOIN google_connections gc ON gc.id = p.google_connection_id
         WHERE p.organization_id = $1
           AND (p.slug LIKE $2 OR gc.google_subject LIKE $2))`,
    [input.organizationId, like],
  )
  // A spec may give its fixture Property a Portal brand profile, whose name the
  // reply voice signs with; the profile RESTRICTs the Property delete below.
  await dbQuery(
    `DELETE FROM property_portal_brand_profiles
     WHERE organization_id = $1 AND property_id IN (
       SELECT p.id
       FROM properties p
       LEFT JOIN google_connections gc ON gc.id = p.google_connection_id
       WHERE p.organization_id = $1
         AND (p.slug LIKE $2 OR gc.google_subject LIKE $2))`,
    [input.organizationId, like],
  )
  await dbQuery(
    // Delete a fixture Property only after its Reviews are gone. The
    // defensive NOT EXISTS keeps unexpected retained Review data from being
    // removed by cascade or aborting the rest of cleanup.
    `DELETE FROM properties
     WHERE organization_id = $1 AND id IN (
       SELECT p.id
       FROM properties p
       LEFT JOIN google_connections gc ON gc.id = p.google_connection_id
       WHERE p.organization_id = $1
         AND (p.slug LIKE $2 OR gc.google_subject LIKE $2)
         AND NOT EXISTS (
           SELECT 1 FROM reviews r WHERE r.property_id = p.id
         ))`,
    [input.organizationId, like],
  )
  await dbQuery(
    // Skip a connection a surviving Property is still bound to: removing it
    // would null one leg of the binding tuple and properties_google_binding_
    // tuple_valid refuses the partial state.
    `DELETE FROM google_connections connection
     WHERE connection.organization_id = $1
       AND connection.google_subject LIKE $2
       AND NOT EXISTS (
         SELECT 1 FROM properties p WHERE p.google_connection_id = connection.id
       )`,
    [input.organizationId, like],
  )
  // Better Auth mirrors do not declare cross-track FKs in application code;
  // remove fixture memberships explicitly before the account row.
  await dbQuery(
    `DELETE FROM member
      WHERE "userId" IN (SELECT id FROM "user" WHERE email LIKE $1)`,
    [like],
  )
  // fixture users (account/session rows cascade from "user")
  await dbQuery('DELETE FROM "user" WHERE email LIKE $1', [like])
}
