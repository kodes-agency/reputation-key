import { StaffPersonAccess } from './staff-person-access'
import { ServerFunctionError } from '#/shared/auth/server-function-error'
import { StaffPersonGroup, StaffPersonTarget } from './staff-person-group'
import { StaffAccountRow } from './staff-account-row'
import { StaffColleagueSetting } from './staff-colleague-setting'
import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import { StaffPersonSheet } from './staff-person-sheet'
import { StaffPersonResults } from './staff-person-results'
import { StaffPersonPortals } from './staff-person-portals'
import { StaffPersonEdit } from './staff-person-edit'
import { StaffGuestWording } from './staff-guest-wording'
import { StaffSourcePreview } from './staff-source-preview'
import { runStaffBatch } from './staff-bulk-actions'
import { StaffAccountsContext } from './staff-accounts-context'
import {
  StaffManagerStory,
  STAFF_STORY_MEMBERS,
} from '../../../../../.storybook/staff-manager-fixtures'
import { avelaResults } from '#/components/features/portal/portal-overview/portal-overview-results-fixtures'
import { portalKeys, staffKeys } from '#/shared/queries/query-keys'
import type { Action } from '#/components/hooks/use-action'
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))
vi.mock('#/shared/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => true }),
}))
const member = STAFF_STORY_MEMBERS[0]!
const action: Action<string> = Object.assign(async () => undefined, {
  isPending: false,
  error: null,
  isSuccess: false,
  data: null,
})
const accounts = {
  propertyId: 'prop-1',
  ready: true,
  members: [member],
  colleagueListEnabled: false,
  canInvite: true,
  canRemove: true,
  canSettings: false,
  openAdd: vi.fn(),
  refresh: async () => undefined,
}
function render(child: ReactNode, seed?: (client: QueryClient) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  seed?.(client)
  return renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(StaffAccountsContext, { value: accounts }, child),
    ),
  )
}
it('shows the four manager periods and six measures without staff coaching', () => {
  const html = render(
    createElement(StaffPersonResults, { member, propertyId: 'prop-1' }),
    (client) =>
      client.setQueryData(
        portalKeys.resultsOverview('prop-1', 'month', false),
        avelaResults(),
      ),
  )
  expect(html).toContain('Results')
  expect(html).toContain('Scans')
  expect(html).toContain('Private notes')
  expect(html).toContain('Opened Google')
  expect(html).toContain('Last scan')
})
it('starts inline email correction with the invited address', () => {
  const html = render(
    createElement(StaffPersonEdit, {
      kind: 'email',
      value: 'wrong@example.com',
      action,
      onCancel: vi.fn(),
    }),
  )
  expect(html).toContain('New email')
  expect(html).toContain('wrong@example.com')
  expect(html).toContain('Save changes')
})
it('omits Portal actions before setup has made a Portal and closes a removed person', () => {
  expect(
    render(
      createElement(StaffPersonPortals, {
        member: { ...member, portalId: null },
        move: action,
      }),
    ),
  ).not.toContain('View and print')
  expect(
    render(
      createElement(StaffPersonSheet, {
        participationId: 'removed-person',
        onClose: vi.fn(),
      }),
    ),
  ).toBe('')
})
it('requires an account admin to write guest wording and gives admins the two fields', () => {
  const wording = {
    required: true,
    canWrite: false,
    locale: 'en' as const,
    title: 'Harbor',
    shortDescription: '',
  }
  const props = {
    wording,
    title: 'Harbor',
    shortDescription: '',
    setTitle: vi.fn(),
    setShortDescription: vi.fn(),
    busy: false,
  }
  const refused = render(createElement(StaffGuestWording, props))
  expect(refused).toContain('An account admin has to write')
  expect(refused).not.toContain('<input')
  const admin = render(
    createElement(StaffGuestWording, {
      ...props,
      wording: { ...wording, canWrite: true },
    }),
  )
  expect(admin).toContain('Title')
  expect(admin).toContain('Description')
  expect(admin).toContain('required')
})
it('shows omitted copy links before an Add is sent', () => {
  const html = render(
    createElement(StaffSourcePreview, {
      propertyId: 'prop-1',
      source: 'source',
      group: 'none',
      checkSource: vi.fn(),
    }),
    (client) =>
      client.setQueryData(staffKeys.source('prop-1', 'source', 'none'), {
        omittedLinks: [{ id: 'old', label: 'Old menu' }],
      }),
  )
  expect(html).toContain('The copy leaves out: Old menu')
})
it('continues a batch after one refusal and returns the name and reason', async () => {
  const seen: string[] = []
  const failures = await runStaffBatch(
    STAFF_STORY_MEMBERS.slice(0, 3),
    async (person) => {
      seen.push(person.displayName)
      if (person.displayName === 'Bob Smith')
        throw new ServerFunctionError(
          'PortalError',
          'End the running goal first.',
          'personal_portal_goal_locked',
          409,
        )
    },
  )
  expect(seen).toEqual(['Ana Jones', 'Bob Smith', 'Li May'])
  expect(failures).toEqual(['Bob Smith: End the running goal first.'])
})
it('keeps the story roster unique and renders an empty scene without opening a stale sheet', () => {
  expect(new Set(STAFF_STORY_MEMBERS.map((person) => person.participationId)).size).toBe(
    15,
  )
  expect(
    render(createElement(StaffManagerStory, { members: [], children: 'Empty' })),
  ).toBe('Empty')
})

it('shows the current group without offering a fake target or a forbidden setting', () => {
  expect(render(createElement(StaffPersonGroup, { member, move: action }))).toContain(
    'Group',
  )
  expect(render(createElement(StaffPersonTarget, { member }))).toBe('')
  expect(render(createElement(StaffColleagueSetting))).toBe('')
})
it('makes a single row keyboard reachable without a bulk checkbox', () => {
  const html = render(
    createElement(StaffAccountRow, {
      member,
      now: new Date(),
      selectable: false,
      selected: false,
      onSelect: vi.fn(),
      onOpen: vi.fn(),
    }),
  )
  expect(html).toContain('Ana Jones')
  expect(html).toContain('row-name')
  expect(html).not.toContain('role="checkbox"')
})

it('keeps access repairs out of a signed-in person’s sheet', () => {
  const html = render(
    createElement(StaffPersonAccess, {
      member,
      onChangeEmail: vi.fn(),
      onBusyChange: vi.fn(),
    }),
  )
  expect(html).not.toContain('Change email')
  expect(html).not.toContain('Resend invitation')
})
