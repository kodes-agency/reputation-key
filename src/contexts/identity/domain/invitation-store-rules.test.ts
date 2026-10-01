import { describe, expect, it } from 'vitest'
import {
  INELIGIBLE_ROLE_MESSAGE,
  INVITATION_CONSUMED_MESSAGE,
  INVITATION_EXPIRED_MESSAGE,
  INVITATION_INACTIVE_MESSAGE,
  INVITATION_OTHER_ADDRESS_MESSAGE,
} from './invitation-copy'
import {
  assertAddressHasNoMembership,
  assertInvitationAcceptable,
  assertInvitationOpenForRegistration,
  assertRenewalHasNoCompetitor,
  consumedInvitation,
  encodePropertyIds,
  grantedRoleToken,
  lapsedCompetitorIds,
  parsePropertyIds,
  renewableInvitation,
  toOpenInvitations,
  type OpenInvitation,
} from './invitation-store-rules'

const NOW = new Date('2026-09-30T12:00:00.000Z')
const LATER = new Date('2026-10-07T12:00:00.000Z')
const EARLIER = new Date('2026-09-23T12:00:00.000Z')

const refusal = (run: () => unknown): { code: string; message: string } => {
  try {
    run()
  } catch (e) {
    return e as { code: string; message: string }
  }
  throw new Error('expected a refusal')
}

const open = (
  id: string,
  organizationId: string,
  state: OpenInvitation['state'],
  storedStatus = state as string,
): OpenInvitation => ({ id, organizationId, state, storedStatus })

describe('property ids column', () => {
  it('round-trips a list and stores none as null', () => {
    expect(parsePropertyIds(encodePropertyIds(['p1', 'p2']))).toEqual(['p1', 'p2'])
    expect(encodePropertyIds([])).toBeNull()
  })

  it.each([null, '', 'not json', '{"a":1}', '"p1"'])('reads %j as no Property', (raw) => {
    expect(parsePropertyIds(raw)).toEqual([])
  })

  it('drops entries that are not strings', () => {
    expect(parsePropertyIds('["p1", 2, null, "p3"]')).toEqual(['p1', 'p3'])
  })
})

describe('grantedRoleToken', () => {
  it.each([
    ['admin', 'admin'],
    [' Owner ', 'owner'],
    ['ADMIN', 'admin'],
  ])('grants a beta login for %j', (raw, token) => {
    expect(grantedRoleToken(raw)).toBe(token)
  })

  it.each([null, 'member', 'custom-role', 'admin,member'])(
    'grants nothing for %j',
    (raw) => {
      expect(grantedRoleToken(raw)).toBeNull()
    },
  )
})

describe('consumedInvitation', () => {
  it('reports the Organization, the Properties and the inviter of the row', () => {
    expect(
      consumedInvitation({
        organizationId: 'org-1',
        propertyIds: '["p1"]',
        inviterId: 'user-1',
      }),
    ).toEqual({ organizationId: 'org-1', propertyIds: ['p1'], inviterId: 'user-1' })
  })

  it('reports no inviter for a row without one', () => {
    expect(
      consumedInvitation({ organizationId: 'org-1', propertyIds: null, inviterId: null }),
    ).toEqual({ organizationId: 'org-1', propertyIds: [], inviterId: null })
  })
})

describe('assertInvitationOpenForRegistration', () => {
  const row = {
    email: 'Ana@Example.com',
    role: 'admin',
    status: 'pending',
    expiresAt: LATER,
  }
  const input = { email: 'ana@example.com', now: NOW }

  it('accepts a pending invitation at its address', () => {
    expect(() => assertInvitationOpenForRegistration(row, input)).not.toThrow()
  })

  it.each([
    ['is missing', undefined],
    ['is not pending', { ...row, status: 'accepted' }],
    ['has expired', { ...row, expiresAt: NOW }],
  ])('refuses an invitation that %s', (_label, inv) => {
    expect(refusal(() => assertInvitationOpenForRegistration(inv, input))).toMatchObject({
      code: 'invitation_not_found',
      message: 'Invitation is not available',
    })
  })

  it('refuses another address', () => {
    expect(
      refusal(() =>
        assertInvitationOpenForRegistration(row, { email: 'bo@example.com', now: NOW }),
      ),
    ).toMatchObject({ code: 'forbidden' })
  })

  it('refuses a role no beta login may hold', () => {
    expect(
      refusal(() =>
        assertInvitationOpenForRegistration({ ...row, role: 'member' }, input),
      ),
    ).toMatchObject({ code: 'forbidden', message: INELIGIBLE_ROLE_MESSAGE })
  })
})

describe('assertInvitationAcceptable', () => {
  const row = { email: 'Ana@Example.com', status: 'pending', expiresAt: LATER }

  it('lets the invitee accept a pending invitation', () => {
    expect(() => assertInvitationAcceptable(row, 'ana@example.com', NOW)).not.toThrow()
  })

  it('refuses another address before it looks at the lifecycle', () => {
    expect(
      refusal(() =>
        assertInvitationAcceptable({ ...row, status: 'accepted' }, 'bo@example.com', NOW),
      ),
    ).toMatchObject({ code: 'forbidden', message: INVITATION_OTHER_ADDRESS_MESSAGE })
  })

  it.each([
    ['a lapsed pending row', { ...row, expiresAt: EARLIER }],
    ['a stored expired row', { ...row, status: 'expired' }],
  ])('says %s has expired', (_label, inv) => {
    expect(
      refusal(() => assertInvitationAcceptable(inv, 'ana@example.com', NOW)),
    ).toMatchObject({ code: 'invitation_expired', message: INVITATION_EXPIRED_MESSAGE })
  })

  it.each(['accepted', 'rejected', 'canceled', 'something-else'])(
    'says a %s invitation is no longer active without echoing the status',
    (status) => {
      const error = refusal(() =>
        assertInvitationAcceptable({ ...row, status }, 'ana@example.com', NOW),
      )
      expect(error).toMatchObject({
        code: 'invitation_not_found',
        message: INVITATION_INACTIVE_MESSAGE,
      })
      expect(error.message).not.toContain(status)
    },
  )
})

describe('renewableInvitation', () => {
  it.each(['pending', 'expired'])('renews a stored %s invitation', (status) => {
    const inv = { status, role: ' Admin ' }
    expect(renewableInvitation(inv)).toEqual({ inv, role: 'admin' })
  })

  it.each([undefined, { status: 'accepted', role: 'admin' }])(
    'refuses a missing or closed invitation',
    (inv) => {
      expect(refusal(() => renewableInvitation(inv))).toMatchObject({
        code: 'invitation_not_found',
        message: INVITATION_CONSUMED_MESSAGE,
      })
    },
  )

  it('refuses a role no beta login may hold', () => {
    expect(
      refusal(() => renewableInvitation({ status: 'pending', role: 'member' })),
    ).toMatchObject({ code: 'forbidden', message: INELIGIBLE_ROLE_MESSAGE })
  })
})

describe('assertAddressHasNoMembership', () => {
  it('passes an address with no membership', () => {
    expect(() => assertAddressHasNoMembership([], 'org-1')).not.toThrow()
  })

  it('calls a membership of this Organization a duplicate', () => {
    expect(
      refusal(() => assertAddressHasNoMembership(['org-2', 'org-1'], 'org-1')),
    ).toMatchObject({ code: 'already_exists' })
  })

  it('calls a membership of another Organization a conflict', () => {
    expect(refusal(() => assertAddressHasNoMembership(['org-2'], 'org-1'))).toMatchObject(
      {
        code: 'organization_conflict',
      },
    )
  })
})

describe('toOpenInvitations', () => {
  const row = {
    id: 'inv-1',
    organizationId: 'org-1',
    status: 'pending',
    expiresAt: LATER,
  }

  it('reads a live pending row as pending', () => {
    expect(toOpenInvitations(row, NOW)).toEqual([
      { id: 'inv-1', organizationId: 'org-1', state: 'pending', storedStatus: 'pending' },
    ])
  })

  it('reads a lapsed pending row as expired and keeps what is stored', () => {
    expect(toOpenInvitations({ ...row, expiresAt: EARLIER }, NOW)).toEqual([
      { id: 'inv-1', organizationId: 'org-1', state: 'expired', storedStatus: 'pending' },
    ])
  })

  it.each(['accepted', 'rejected', 'canceled', 'unknown'])('skips a %s row', (status) => {
    expect(toOpenInvitations({ ...row, status }, NOW)).toEqual([])
  })
})

describe('lapsedCompetitorIds', () => {
  it('refuses an address this Organization already invited', () => {
    expect(
      refusal(() => lapsedCompetitorIds([open('a', 'org-1', 'pending')], 'org-1')),
    ).toMatchObject({
      code: 'already_exists',
      message: expect.stringContaining('already invited'),
    })
  })

  it('points a lapsed invitation of this Organization at Resend', () => {
    expect(
      refusal(() => lapsedCompetitorIds([open('a', 'org-1', 'expired')], 'org-1')),
    ).toMatchObject({
      code: 'already_exists',
      message: expect.stringContaining('Use Resend'),
    })
  })

  it('refuses while another Organization holds a live invitation', () => {
    expect(
      refusal(() => lapsedCompetitorIds([open('a', 'org-2', 'pending')], 'org-1')),
    ).toMatchObject({ code: 'organization_conflict' })
  })

  it('asks to mark only another Organization stored-pending lapsed rows expired', () => {
    expect(
      lapsedCompetitorIds(
        [
          open('lapsed', 'org-2', 'expired', 'pending'),
          open('already', 'org-3', 'expired', 'expired'),
        ],
        'org-1',
      ),
    ).toEqual(['lapsed'])
  })

  it('asks for nothing when the address has no open invitation', () => {
    expect(lapsedCompetitorIds([], 'org-1')).toEqual([])
  })
})

describe('assertRenewalHasNoCompetitor', () => {
  const renewed = { id: 'inv-1', organizationId: 'org-1' }

  it('ignores the renewed row itself and lapsed rows', () => {
    expect(() =>
      assertRenewalHasNoCompetitor(
        [open('inv-1', 'org-1', 'pending'), open('old', 'org-2', 'expired')],
        renewed,
      ),
    ).not.toThrow()
  })

  it('refuses a second live invitation of this Organization', () => {
    expect(
      refusal(() =>
        assertRenewalHasNoCompetitor([open('other', 'org-1', 'pending')], renewed),
      ),
    ).toMatchObject({ code: 'already_exists' })
  })

  it('refuses a live invitation of another Organization', () => {
    expect(
      refusal(() =>
        assertRenewalHasNoCompetitor([open('other', 'org-2', 'pending')], renewed),
      ),
    ).toMatchObject({ code: 'organization_conflict' })
  })
})
