// Portal command stores — telling "a unique index already holds it" from a fault.
//
// A use case checks that a name or an address is free before it asks the store
// to write, and the unique index is what holds when two commands pass that
// check together. The loser's statement then fails with SQLSTATE 23505, which
// without a translation reaches the caller as an untyped failure and a
// sanitized 500 instead of the refusal the check would have given. A foreign
// key that refuses a reference read a moment before (SQLSTATE 23503) is told
// apart the same way.

import { portalError } from '../domain/errors'

const UNIQUE_VIOLATION = '23505'
const FOREIGN_KEY_VIOLATION = '23503'

/** A Portal's address is unique among the live Portals of its Property. */
export const PORTAL_SLUG_UNIQUE = 'portals_org_property_slug_unique'

/** A Portal Group's name is unique among the live groups of its Property. */
export const PORTAL_GROUP_NAME_UNIQUE = 'portal_groups_org_property_name_unique'

/** The refusal the use case's own pre-check gives for an address already in use. */
export const slugTaken = () =>
  portalError('slug_taken', 'a portal with this slug already exists')

/** The refusal the use case's own pre-check gives for a group name already in use. */
export const groupNameTaken = () =>
  portalError('group_name_taken', 'a group with this name already exists')

/** How deep the driver's error may sit under the ORM's wrapper. */
const CAUSE_DEPTH = 3

/** Whether the driver's error, at most a few causes deep, is `sqlState` on the named constraint. */
function violates(error: unknown, sqlState: string, constraint: string): boolean {
  let current = error
  for (let depth = 0; depth < CAUSE_DEPTH; depth += 1) {
    if (!current || typeof current !== 'object') return false
    const { code, constraint: violated } = current as {
      code?: unknown
      constraint?: unknown
    }
    if (code === sqlState && violated === constraint) return true
    current = (current as { cause?: unknown }).cause
  }
  return false
}

/** Whether the database refused the write because the named unique index holds it. */
export const isUniqueViolation = (error: unknown, constraint: string): boolean =>
  violates(error, UNIQUE_VIOLATION, constraint)

/** Whether the database refused the write because the named foreign key finds no row. */
export const isForeignKeyViolation = (error: unknown, constraint: string): boolean =>
  violates(error, FOREIGN_KEY_VIOLATION, constraint)

/** Runs a write and answers the refusal it would have got from its pre-check when the index holds the value. */
export async function refusingWhenTaken<T>(
  write: () => Promise<T>,
  constraint: string,
  refusal: () => Error,
): Promise<T> {
  try {
    return await write()
  } catch (error) {
    throw isUniqueViolation(error, constraint) ? refusal() : error
  }
}
