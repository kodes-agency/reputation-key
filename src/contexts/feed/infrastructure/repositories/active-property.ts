// Feed notification surface — the one definition of a Property notices may
// still reach.
//
// A Property is active while it is not deleted and its lifecycle state is
// `active`. In any other state (archived, suspended, disconnecting, on its way
// to purge, deleted) it is outside the workspace, and Feed treats it one way
// everywhere: its queued email is held, by the daily digest, the urgent path
// and the orphan sweep alike; a Response Target reminder about it is obsolete;
// and mail held for it is not late mail. Kept in one place so the email rule
// and the reminder rule cannot drift apart.

/**
 * The active-Property predicate over a `properties` row, as SQL text for raw
 * and `sql.raw` queries. `alias` qualifies the columns (`'p'` reads
 * `p.deleted_at`); without one they are unqualified.
 */
export const activePropertyCondition = (alias?: string): string => {
  const column = (name: string): string =>
    alias === undefined ? name : `${alias}.${name}`
  return `${column('deleted_at')} IS NULL AND ${column('lifecycle_state')} = 'active'`
}
