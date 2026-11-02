import {
  StaffAccountFunctionsContext,
  useStaffFunctions,
} from './staff-account-functions'
import { createElement } from 'react'
import { setupHookRoot } from '#/shared/testing/hook-root'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { it, expect, vi } from 'vitest'
import { StaffAccountsProvider } from './staff-accounts-provider'
import { StaffAccountsContext } from './staff-accounts-context'
import { StaffAccountsList, StaffAddAction } from './staff-accounts-list'
import { StaffAddDialog } from './staff-add-dialog'
import { StaffAddForm } from './staff-add-form'
import { StaffAddRow } from './staff-add-row'
import { StaffMemberMenu, StaffRemoveDialog, StaffRetry } from './staff-member-actions'
import { StaffPortalMeta } from './staff-portal-meta'
import { newStaffRow } from './staff-batch'
import { Dialog } from '#/components/ui/dialog'
const state = vi.hoisted(() => ({ enabled: false, list: vi.fn() }))
vi.mock('#/shared/hooks/useCapabilities', () => ({
  useCapabilities: () => ({
    all: state.enabled ? ['staff.accounts'] : [],
    has: () => state.enabled,
  }),
}))
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))
vi.mock('#/contexts/identity/server/staff-accounts', () => ({
  listStaffMembers: state.list,
  checkStaffBatch: vi.fn(),
  addStaffMember: vi.fn(),
  removeStaffMember: vi.fn(),
  renameStaffMember: vi.fn(),
  resendStaffInvitation: vi.fn(),
  setColleagueListEnabled: vi.fn(),
}))
vi.mock('#/components/hooks/use-action-mutation', async (original) => ({
  ...(await original<object>()),
  useActionMutation: (fn: unknown) =>
    Object.assign(() => fn, { isPending: false, error: null, isSuccess: false }),
}))
function BoundFunctions({
  children,
}: Readonly<{ children: ReturnType<typeof createElement> }>) {
  const functions = useStaffFunctions()
  return createElement(
    StaffAccountFunctionsContext,
    { value: { ...functions, listStaffMembers: state.list } },
    children,
  )
}
const render = (child: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client: new QueryClient() },
      createElement(BoundFunctions, { children: child }),
    ),
  )

const hookRoot = setupHookRoot()
it.each([false, true])(
  'capability enabled=%s controls actual client roster requests',
  async (enabled) => {
    state.enabled = enabled
    state.list.mockReset().mockResolvedValue({ members: [], colleagueListEnabled: false })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    await hookRoot.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(BoundFunctions, {
          children: createElement(StaffAccountsProvider, {
            propertyId: 'p',
            children: null,
          }),
        }),
      ),
    )
    expect(state.list).toHaveBeenCalledTimes(enabled ? 1 : 0)
    client.clear()
    state.enabled = false
  },
)
it('an enabled context offers Add staff and renders the access state and colleague setting', () => {
  const html = render(
    createElement(
      StaffAccountsContext,
      {
        value: {
          propertyId: 'p',
          members: [
            {
              participationId: 'id',
              operationId: null,
              displayName: 'Ana',
              portalId: null,
              access: 'active',
              step: null,
              code: null,
            },
          ],
          colleagueListEnabled: false,
          canInvite: true,
          canRemove: true,
          canSettings: true,
          openAdd: vi.fn(),
          refresh: async () => undefined,
        },
      },
      createElement(
        'div',
        null,
        createElement(StaffAddAction),
        createElement(StaffAccountsList),
        createElement(StaffPortalMeta, { portalId: 'missing' }),
      ),
    ),
  )
  expect(html).toContain('Add staff')
  expect(html).toContain('Signed in')
  expect(html).toContain('Show staff each other&#x27;s scans')
})
it('starts the Add form on one editable person with the source before the optional group', () => {
  const html = render(
    createElement(
      Dialog,
      { open: true },
      createElement(StaffAddForm, { propertyId: 'p', portals: [], groups: [] }),
    ),
  )
  expect(html.match(/<fieldset/g)).toHaveLength(1)
  expect(html.indexOf('Portal to copy')).toBeLessThan(html.indexOf('Group'))
  expect(html).toContain('Add another')
  expect(html).not.toContain('Remove person 1')
})
it('a failed draft keeps its operation id, failure and retry control', () => {
  const html = render(
    createElement(StaffAddRow, {
      row: {
        ...newStaffRow('same-id'),
        state: 'failed',
        problem: "Setup didn't finish.",
      },
      index: 0,
      removable: false,
      busy: false,
      onChange: vi.fn(),
      onPaste: vi.fn(),
      onRemove: vi.fn(),
      onRetry: vi.fn(),
    }),
  )
  expect(html).toContain('same-id-email')
  expect(html).toContain('Try again')
})
// These dialog/row components are exercised interactively in staff-manager.stories.tsx.
it('exports the shared manager dialogs and retry controls', () => {
  expect(
    [StaffAddDialog, StaffMemberMenu, StaffRemoveDialog, StaffRetry].every(
      (component) => typeof component === 'function',
    ),
  ).toBe(true)
})

it('sets the capability on explicitly and enables Add staff without starting a loader call', () => {
  state.enabled = true
  const client = new QueryClient()
  client.setQueryData(['staff', 'accounts', 'p'], {
    members: [],
    colleagueListEnabled: false,
  })
  const html = renderToStaticMarkup(
    createElement(
      QueryClientProvider,
      { client },
      createElement(StaffAccountsProvider, {
        propertyId: 'p',
        children: createElement(StaffAddAction),
      }),
    ),
  )
  expect(html).toContain('Add staff')
  state.enabled = false
})

it('shows the empty staff state and Add staff when the first roster is empty', () => {
  const html = render(
    createElement(
      StaffAccountsContext,
      {
        value: {
          propertyId: 'p',
          ready: true,
          members: [],
          colleagueListEnabled: false,
          canInvite: true,
          canRemove: true,
          canSettings: true,
          openAdd: vi.fn(),
          refresh: async () => undefined,
        },
      },
      createElement(StaffAccountsList),
    ),
  )
  expect(html).toContain('No staff yet')
  expect(html).toContain('Add staff')
})
it('prints a row problem once and connects both fields to it', () => {
  const problem = 'This person is already staff here.'
  const html = render(
    createElement(StaffAddRow, {
      row: { ...newStaffRow('id'), problem },
      index: 0,
      removable: false,
      busy: false,
      onChange: vi.fn(),
      onPaste: vi.fn(),
      onRemove: vi.fn(),
      onRetry: vi.fn(),
    }),
  )
  expect(html.split(problem)).toHaveLength(2)
  expect(html.match(/aria-describedby="id-status"/gu)).toHaveLength(2)
})
