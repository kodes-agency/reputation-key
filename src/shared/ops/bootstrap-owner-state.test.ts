// ops:bootstrap-owner creates the owner through Better Auth's sign-up, which
// commits the user on its own connection before the command's own writes. A
// run that failed after that point left one user behind, and the empty-database
// guard then refused every re-run. The precondition resumes exactly that state
// and nothing else, so the command still cannot open a populated cell.

import { describe, expect, it } from 'vitest'
import { bootstrapState, type BootstrapSnapshot } from './bootstrap-owner-state'

const OWNER = 'owner@example.test'
const SOLE_USER = { id: 'user-1', email: OWNER } as const
const EMPTY: BootstrapSnapshot = {
  users: 0,
  organizations: 0,
  members: 0,
  soleUser: null,
}
const INTERRUPTED: BootstrapSnapshot = { ...EMPTY, users: 1, soleUser: SOLE_USER }

describe('bootstrapState', () => {
  it('bootstraps an empty database from scratch', () => {
    expect(bootstrapState(EMPTY, OWNER)).toEqual({ kind: 'fresh' })
  })

  it('resumes the lone owner an interrupted run left behind', () => {
    expect(bootstrapState(INTERRUPTED, OWNER)).toEqual({
      kind: 'resume',
      userId: 'user-1',
    })
  })

  it('matches the owner email case-insensitively', () => {
    expect(bootstrapState(INTERRUPTED, 'Owner@Example.TEST')).toEqual({
      kind: 'resume',
      userId: 'user-1',
    })
  })

  it.each<[string, BootstrapSnapshot, string]>([
    ['the lone user is someone else', INTERRUPTED, 'other@example.test'],
    ['an Organization exists', { ...INTERRUPTED, organizations: 1 }, OWNER],
    ['a membership exists', { ...INTERRUPTED, members: 1 }, OWNER],
    ['an Organization exists without users', { ...EMPTY, organizations: 1 }, OWNER],
    ['more than one user exists', { ...INTERRUPTED, users: 2 }, OWNER],
    ['the lone user was not read', { ...INTERRUPTED, soleUser: null }, OWNER],
  ])('refuses when %s', (_label, snapshot, email) => {
    const state = bootstrapState(snapshot, email)
    expect(state.kind).toBe('refuse')
    expect(state).toMatchObject({
      reason: expect.stringContaining(
        `users=${snapshot.users}, organizations=${snapshot.organizations}, members=${snapshot.members}`,
      ),
    })
  })
})
