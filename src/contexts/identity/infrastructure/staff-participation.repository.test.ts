// Identity People — Portal responsibility conflicts at the repository boundary.
//
// PostgreSQL keeps a Portal to one active primary responsibility
// (pr_unique_active_primary, pr_no_overlapping_primary_intervals). When a
// concurrent assignment wins that race, the insert fails inside the
// transaction and drizzle wraps the driver error in DrizzleQueryError. These
// tests pin the translation of exactly those violations into the typed 409
// `responsibility_conflict` StaffError, using a fake `Database` whose
// transaction fails the way PostgreSQL does. The in-transaction check and the
// race itself are proven against PostgreSQL in
// repositories/staff-participation.repository.test.ts.

import { describe, expect, it, vi } from 'vitest'
import { DrizzleQueryError } from 'drizzle-orm'
import type { Database } from '#/shared/db'
import { createStaffParticipationRepository } from './repositories/staff-participation.repository'

const input = {
  organizationId: 'org-1',
  propertyId: 'b0000000-0000-4000-8000-000000000001',
  staffParticipationId: 'b0000000-0000-4000-8000-000000000002',
  selections: [{ portalId: 'b0000000-0000-4000-8000-000000000003', kind: 'primary' }],
  actorId: 'manager-1',
  at: new Date('2026-09-28T12:00:00.000Z'),
  expectedRevision: 1,
} as const

/** The error drizzle raises when PostgreSQL rejects the responsibility insert. */
function constraintViolation(code: string, constraint: string): DrizzleQueryError {
  const driverError = Object.assign(new Error(`violates constraint "${constraint}"`), {
    code,
    constraint,
  })
  return new DrizzleQueryError('insert into "portal_responsibilities"', [], driverError)
}

const failingTransaction = (error: unknown): Database =>
  ({ transaction: vi.fn().mockRejectedValue(error) }) as unknown as Database

describe('staff participation repository — responsibility conflicts', () => {
  it.each([
    { code: '23505', constraint: 'pr_unique_active_primary' },
    { code: '23P01', constraint: 'pr_no_overlapping_primary_intervals' },
  ])(
    'reports a Portal whose primary was taken concurrently ($constraint) as a conflict',
    async ({ code, constraint }) => {
      const repo = createStaffParticipationRepository(
        failingTransaction(constraintViolation(code, constraint)),
      )

      await expect(repo.replaceResponsibilities(input)).rejects.toMatchObject({
        _tag: 'StaffError',
        code: 'responsibility_conflict',
      })
    },
  )

  it('leaves any other constraint violation untranslated', async () => {
    const violation = constraintViolation(
      '23P01',
      'pr_no_overlapping_responsibility_intervals',
    )
    const repo = createStaffParticipationRepository(failingTransaction(violation))

    await expect(repo.replaceResponsibilities(input)).rejects.toBe(violation)
  })
})
