import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'
import { PortalGroupPage } from './portal-group-page'
import { baseArgs, action } from '../portal-list-page-stories-data'
import { overviewGroup, overviewRow } from '../portal-overview/portal-overview-fixtures'
import {
  HISTORY,
  NAMES,
  NOW,
  PEOPLE,
  POOL_SIDE,
  ZONE,
  ready,
} from './portal-group-page-fixtures'
const header = vi.hoisted(() => vi.fn())
vi.mock('#/components/features/staff/accounts/staff-accounts-provider', () => ({
  StaffAccountsProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('#/components/features/staff/accounts/staff-accounts-context', () => ({
  useStaffAccounts: () => null,
}))
vi.mock('#/shared/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => false }),
}))
vi.mock('#/components/layout/page-header', () => ({
  PageHeader: (props: unknown) => {
    header(props)
    return null
  },
}))
vi.mock('./portal-group-portals', () => ({ PortalGroupPortals: () => null }))
vi.mock('./portal-group-history', () => ({ PortalGroupHistory: () => null }))
vi.mock('./portal-group-goals', () => ({ PortalGroupGoals: () => null }))
vi.mock('./portal-group-dialogs', () => ({
  PortalGroupAddPortalsDialog: () => null,
  PortalGroupRenameDialog: () => null,
}))
it('counts the visible Group roster in the page header after a person is removed', () => {
  const rowGroup = overviewGroup(POOL_SIDE.id, POOL_SIDE.name)
  renderToStaticMarkup(
    createElement(PortalGroupPage, {
      ...baseArgs,
      group: POOL_SIDE,
      timezone: ZONE,
      rows: [
        overviewRow('room', { group: rowGroup }),
        overviewRow('removed', {
          group: rowGroup,
          kind: 'personal',
          publicationState: 'archived',
        }),
      ],
      goals: ready([]),
      history: ready(HISTORY),
      names: NAMES,
      personName: PEOPLE,
      now: NOW,
      onRetryGoals: vi.fn(),
      onRetryHistory: vi.fn(),
      movePortalMutation: action(),
      removePortalMutation: action(),
    }),
  )
  expect(header.mock.lastCall![0].meta).toContain('1 portal at Avela Resort')
})
