import { it, expect } from 'vitest'
import {
  staffAccessLine,
  staffMemberMenu,
  staffRemovalWords,
  staffRepairAction,
} from './staff-account-view'
it.each(['active', 'invited', 'invite_expired', 'failed'] as const)(
  'offers only staff actions for %s',
  (access) => {
    const menu = staffMemberMenu(
      { access, step: null, portalId: 'portal' },
      { invite: true, remove: true },
    )
    expect(menu).toEqual([
      'code',
      'rename',
      ...(['invited', 'invite_expired'].includes(access) ? ['resend'] : []),
      'remove',
    ])
    expect(staffAccessLine(access)).toBeTruthy()
    expect(menu).not.toContain('archive')
  },
)
it('has no invitation actions without permission, and no rename during removal', () => {
  expect(
    staffMemberMenu(
      { access: 'failed', step: 'removal', portalId: null },
      { invite: true, remove: true },
    ),
  ).toEqual(['remove'])
  expect(
    staffMemberMenu(
      { access: 'invited', step: null, portalId: 'p' },
      { invite: false, remove: false },
    ),
  ).toEqual(['code'])
})
it('only says sign-in ends when the server confirms it, and cancels pending invitations', () => {
  expect(
    staffRemovalWords({ displayName: 'Ana', access: 'active' }, false).description,
  ).not.toContain('sign-in')
  expect(
    staffRemovalWords({ displayName: 'Ana', access: 'active' }, true).description,
  ).toContain('Their sign-in ends.')
  expect(
    staffRemovalWords({ displayName: 'Ana', access: 'invited' }, false).confirmLabel,
  ).toBe('Cancel invitation')
})

it('a failed removal retries Remove, and an interrupted setup retries Add', () => {
  expect(staffRepairAction({ step: 'removal' })).toBe('remove')
  expect(staffRepairAction({ step: 'publication' })).toBe('add')
})
