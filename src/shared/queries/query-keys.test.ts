import { describe, expect, it } from 'vitest'
import { identityKeys } from './query-keys'

describe('identity query keys', () => {
  it('keeps personal and organization invitation response shapes disjoint', () => {
    const personal = identityKeys.userInvitations()
    const organization = identityKeys.organizationInvitations()

    expect(personal).not.toEqual(organization)
    expect(personal.slice(0, -1)).toEqual(identityKeys.invitations())
    expect(organization.slice(0, -1)).toEqual(identityKeys.invitations())
  })
})
