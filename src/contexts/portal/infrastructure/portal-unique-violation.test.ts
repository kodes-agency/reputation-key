import { describe, expect, it } from 'vitest'
import { isPortalError } from '../domain/errors'
import {
  groupNameTaken,
  isUniqueViolation,
  PORTAL_GROUP_NAME_UNIQUE,
  PORTAL_SLUG_UNIQUE,
  refusingWhenTaken,
  slugTaken,
} from './portal-unique-violation'

const violation = (constraint: string, code = '23505') =>
  Object.assign(new Error('duplicate key value'), { code, constraint })

/** The ORM wraps the driver's error as its `cause`. */
const wrapped = (inner: unknown) =>
  Object.assign(new Error('Failed query'), { cause: inner })

describe('isUniqueViolation', () => {
  it('recognises the named index, bare or under the ORM wrapper', () => {
    expect(isUniqueViolation(violation(PORTAL_SLUG_UNIQUE), PORTAL_SLUG_UNIQUE)).toBe(
      true,
    )
    expect(
      isUniqueViolation(wrapped(violation(PORTAL_SLUG_UNIQUE)), PORTAL_SLUG_UNIQUE),
    ).toBe(true)
  })

  it('does not take another unique index, another SQLSTATE or a non-error for it', () => {
    expect(
      isUniqueViolation(violation(PORTAL_GROUP_NAME_UNIQUE), PORTAL_SLUG_UNIQUE),
    ).toBe(false)
    expect(
      isUniqueViolation(violation(PORTAL_SLUG_UNIQUE, '23503'), PORTAL_SLUG_UNIQUE),
    ).toBe(false)
    expect(isUniqueViolation(null, PORTAL_SLUG_UNIQUE)).toBe(false)
    expect(isUniqueViolation('23505', PORTAL_SLUG_UNIQUE)).toBe(false)
  })
})

describe('refusingWhenTaken', () => {
  it('answers the use case’s own refusal when the index holds the value', async () => {
    const refusal = await refusingWhenTaken(
      () => Promise.reject(wrapped(violation(PORTAL_GROUP_NAME_UNIQUE))),
      PORTAL_GROUP_NAME_UNIQUE,
      groupNameTaken,
    ).catch((error: unknown) => error)

    expect(isPortalError(refusal)).toBe(true)
    expect(refusal).toMatchObject({ code: 'group_name_taken' })
  })

  it('lets any other failure through untouched', async () => {
    const other = violation(PORTAL_GROUP_NAME_UNIQUE)

    await expect(
      refusingWhenTaken(() => Promise.reject(other), PORTAL_SLUG_UNIQUE, slugTaken),
    ).rejects.toBe(other)
  })

  it('returns what the write returns', async () => {
    await expect(
      refusingWhenTaken(() => Promise.resolve('written'), PORTAL_SLUG_UNIQUE, slugTaken),
    ).resolves.toBe('written')
  })
})
