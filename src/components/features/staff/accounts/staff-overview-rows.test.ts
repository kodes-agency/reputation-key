import { it, expect } from 'vitest'
import { withStaffSetupRows } from './staff-overview-rows'
import { staffAccountsQuery } from './staff-accounts-query'
import { overviewRow } from '#/components/features/portal/portal-overview/portal-overview-fixtures'
import type { StaffMember } from './staff-account-view'
const failed: StaffMember = {
  participationId: 'person',
  operationId: 'retry-this',
  displayName: 'Ana',
  portalId: null,
  access: 'failed',
  code: 'step_failed',
  step: 'person',
  group: { id: 'g', name: 'Reception' },
}
it('keeps a failed setup in its chosen Group before a Portal exists', () => {
  const rows = withStaffSetupRows([], [failed], 'p')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({
    portalId: 'person',
    kind: 'personal',
    name: 'Ana',
    group: { id: 'g', name: 'Reception' },
  })
})
it('does not duplicate an existing personal Portal or add an ordinary active member', () => {
  const rows = [overviewRow('portal', { kind: 'personal', name: 'Ana' })]
  expect(withStaffSetupRows(rows, [{ ...failed, portalId: 'portal' }], 'p')).toEqual(rows)
  expect(withStaffSetupRows([], [{ ...failed, access: 'active' }], 'p')).toEqual([])
})
it('uses the Property roster key shared by lists and row providers', () => {
  expect(
    staffAccountsQuery('p', async () => ({ members: [], colleagueListEnabled: false }))
      .queryKey,
  ).toEqual(['staff', 'accounts', 'p'])
})
