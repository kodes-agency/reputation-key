import { describe, expect, it } from 'vitest'
import type { PortalLinktreeDestination } from '#/contexts/portal/application/public-api'
import { LINK_APPROVAL_NAMES } from './linktree-approval-names'
import {
  countHiddenLinks,
  describeHiddenFromGuests,
  describeLinkApproval,
  siteForLink,
} from './linktree-approval-rules'

const destination = (
  state: PortalLinktreeDestination['state'],
  overrides: Partial<PortalLinktreeDestination> = {},
): PortalLinktreeDestination => ({
  state,
  sourceType: null,
  approvedByUserId: null,
  ...overrides,
})

describe('describeLinkApproval', () => {
  const names = new Map([['admin-1', 'Elena Petrova']])

  it('names the approver of a custom destination', () => {
    expect(
      describeLinkApproval(
        destination('approved', { sourceType: 'custom', approvedByUserId: 'admin-1' }),
        names,
      ),
    ).toEqual({ tone: 'ok', text: 'Approved · Elena Petrova' })
  })

  it('does not invent a name it cannot resolve', () => {
    expect(
      describeLinkApproval(
        destination('approved', { sourceType: 'custom', approvedByUserId: 'gone' }),
        names,
      ),
    ).toEqual({ tone: 'ok', text: 'Approved' })
  })

  it('says a recognised service was approved automatically, spelled as the list spells it', () => {
    expect(
      describeLinkApproval(
        destination('approved', {
          sourceType: 'recognized',
          approvedByUserId: 'admin-1',
        }),
        names,
      ),
    ).toEqual({ tone: 'ok', text: 'Approved · recognised service' })
  })

  it.each([
    ['pending', 'Waiting for approval · '],
    ['disabled', 'Turned off · '],
    ['quarantined', 'Held back for safety · '],
    ['unclassified', 'Not checked · '],
  ] as const)(
    'warns about a %s destination, starting with its shared name',
    (state, start) => {
      const approval = describeLinkApproval(destination(state), names)

      expect(approval.tone).toBe('warn')
      expect(approval.text.startsWith(start)).toBe(true)
      expect(approval.text.startsWith(LINK_APPROVAL_NAMES[state])).toBe(true)
    },
  )

  it('tells a manager an account admin approves, and an account admin that they do', () => {
    expect(describeLinkApproval(destination('pending'), names).text).toContain(
      'until an account admin approves it',
    )
    expect(
      describeLinkApproval(destination('pending'), names, { canApprove: true }).text,
    ).toContain('until you approve it')
  })

  it('says why guests do not see a link in every warning', () => {
    for (const state of ['pending', 'disabled', 'quarantined', 'unclassified'] as const) {
      expect(describeLinkApproval(destination(state), names).text).toMatch(/guests/u)
    }
  })
})

describe('describeHiddenFromGuests', () => {
  it('stays quiet for an approved tile', () => {
    expect(describeHiddenFromGuests(destination('approved'))).toBeNull()
  })

  it.each([
    ['pending', 'Hidden from guests · waiting for approval'],
    ['disabled', 'Hidden from guests · turned off'],
    ['quarantined', 'Hidden from guests · held back for safety'],
    ['unclassified', 'Hidden from guests · not checked'],
  ] as const)('names the reason for a %s tile', (state, marker) => {
    expect(describeHiddenFromGuests(destination(state))).toBe(marker)
  })
})

describe('countHiddenLinks', () => {
  it('counts the tiles whose address is not approved', () => {
    expect(
      countHiddenLinks([
        { destination: destination('approved') },
        { destination: destination('pending') },
        { destination: destination('disabled') },
      ]),
    ).toBe(2)
    expect(countHiddenLinks([])).toBe(0)
  })
})

describe('siteForLink', () => {
  const sites = [
    { id: 's-1', hostname: 'avela.bg', normalizedUri: 'https://avela.bg/menu' },
    { id: 's-2', hostname: 'example.com', normalizedUri: 'https://example.com/' },
  ]

  it('finds the allowed site a tile opens by its saved address', () => {
    expect(siteForLink({ url: 'https://example.com/' }, sites)?.id).toBe('s-2')
  })

  it('finds none for a link the list does not know', () => {
    expect(siteForLink({ url: 'https://old.example/' }, sites)).toBeNull()
  })
})
