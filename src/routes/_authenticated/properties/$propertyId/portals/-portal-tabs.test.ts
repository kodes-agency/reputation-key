import { act, createElement, type ComponentProps } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { portalKeys } from '#/shared/queries/query-keys'
import { propertyQuery } from '#/routes/-queries/route-queries'
import { setupHookRoot } from '#/shared/testing/hook-root'
import type { SharePanel } from '#/components/features/portal/portal-detail/portal-detail-tab-panel'

const screen = vi.hoisted(() => ({
  tab: 'share' as 'share' | 'page' | 'results' | 'history',
  allowedResults: true,
  share: vi.fn(),
  results: vi.fn(),
  mounted: false,
}))
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ state: { resolvedLocation: undefined } }),
}))
vi.mock('#/shared/hooks/usePermissions', () => ({
  usePermissions: () => ({ can: () => true }),
}))
vi.mock('#/shared/hooks/useTenantScope', () => ({
  useTenantScope: () => ({ userId: 'user-1', organizationId: 'org-1' }),
}))
vi.mock('#/shared/hooks/useCapabilities', () => ({
  useCapabilities: () => ({ has: () => screen.allowedResults }),
}))
vi.mock('./-portal-goal-line', () => ({
  usePortalGoalLine: () => ({ pending: false, line: null }),
}))
vi.mock('./-portal-results-fns', () => ({ portalResultsFns: {} }))
vi.mock('#/components/features/portal/portal-detail/portal-detail-page', () => ({
  PortalDetailPage: () => createElement('p', null, 'Page editor ready'),
}))
vi.mock(
  '#/components/features/portal/portal-detail/portal-unsaved-changes-prompt',
  () => ({ PortalUnsavedChangesPrompt: () => null }),
)
vi.mock('#/components/features/portal/portal-workspace/portal-link-issuance', () => ({
  usePortalLinkIssuance: () => ({}),
}))
vi.mock('#/components/features/portal/portal-detail/portal-detail-tab-panel', () => ({
  SharePanel: (props: unknown) => {
    screen.share(props)
    return screen.mounted ? null : createElement('p', null, 'Share ready')
  },
  HistoryPanel: () => (screen.mounted ? null : createElement('p', null, 'History ready')),
  AnalyticsPanel: (props: unknown) => {
    screen.results(props)
    return createElement('p', null, 'Results ready')
  },
}))
vi.mock('#/contexts/portal/server/portals', () => ({
  getPortal: vi.fn(),
  listPortals: vi.fn(),
  getPropertyPortalExperience: vi.fn(),
  getPortalPublicationHistory: vi.fn(),
  listPortalApprovedDestinations: vi.fn(),
  getPortalHistory: vi.fn(),
  completeContentReview: vi.fn(),
  approvePortalApprovedDestination: vi.fn(),
  disablePortalApprovedDestination: vi.fn(),
  issuePortalToken: vi.fn(),
  requestPortalApprovedDestination: vi.fn(),
  revealPortalAddress: vi.fn(),
  revokePortalTokens: vi.fn(),
  rollbackPortalPublication: vi.fn(),
  rotatePortalToken: vi.fn(),
  savePortalLocalizedOverride: vi.fn(),
  savePropertyPortalBrandContent: vi.fn(),
  updatePortal: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-publish-changes', () => ({
  publishPortalChanges: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-look', () => ({
  savePortalLookColours: vi.fn(),
  savePortalLookIdentity: vi.fn(),
  savePortalLookPhoto: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-print-final', () => ({
  downloadPortalPrintFinal: vi.fn(),
  savePortalPrintWording: vi.fn(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('#/contexts/portal/server/portal-links', () => ({
  getPortalLinktree: vi.fn(),
  listPortalLinks: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-review', () => ({ getPortalReview: vi.fn() }))
vi.mock('#/contexts/portal/server/portal-language-coverage', () => ({
  getPortalLanguageCoverage: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-groups', () => ({ listPortalGroups: vi.fn() }))
vi.mock('#/contexts/portal/server/portal-responsible-managers', () => ({
  listPortalResponsibleManagers: vi.fn(),
  updatePortalResponsibleManagers: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-versions', () => ({
  getPortalVersion: vi.fn(),
  getPortalVersionPreview: vi.fn(),
  getPortalVersions: vi.fn(),
}))
vi.mock('#/contexts/portal/server/portal-preview', () => ({ getPortalPreview: vi.fn() }))
vi.mock('#/contexts/portal/server/portal-print-kit', () => ({
  getPortalPrintKit: vi.fn(),
}))
vi.mock('#/contexts/reporting/server/portal-analytics', () => ({
  getPortalAnalyticsFn: vi.fn(),
}))
vi.mock('#/routes/-queries/route-queries', () => ({
  propertyQuery: (id: string) => ({
    queryKey: ['property', id],
    queryFn: vi.fn(),
    staleTime: Infinity,
  }),
  membersQuery: () => ({ queryKey: ['members'], queryFn: vi.fn(), staleTime: Infinity }),
}))

import { Route } from './$portalId/index'
import { PortalWorkspaceHeaderSlot } from './-portal-workspace-header-slot'
import { revokePortalTokens, rotatePortalToken } from '#/contexts/portal/server/portals'
const portal = {
  id: 'portal-1',
  propertyId: 'property-1',
  name: 'Pool',
  publicationState: 'published',
}
const token = { hasActiveToken: true, qualifiedScanReady: true }
function clientWithPortal() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(portalKeys.detail('portal-1'), { portal, tokenStatus: token })
  client.setQueryData([...propertyQuery('property-1').queryKey], {
    property: { timezone: 'Europe/Sofia', countryCode: 'BG' },
  })
  return client
}
function render(client: QueryClient) {
  const Component = Route.options.component
  if (!Component) throw new Error('Missing Portal screen')
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Component)),
  )
}
beforeEach(() => {
  screen.mounted = false
  screen.tab = 'share'
  screen.allowedResults = true
  screen.share.mockClear()
  screen.results.mockClear()
  vi.spyOn(Route, 'useParams').mockReturnValue({
    propertyId: 'property-1',
    portalId: 'portal-1',
  })
  vi.spyOn(Route, 'useSearch').mockImplementation(() => ({
    tab: screen.tab,
    section: undefined,
  }))
  vi.spyOn(Route, 'useRouteContext').mockReturnValue({
    activeOrganization: { name: 'Hotel' },
  } as never)
})
describe('Portal commands across tab switches', () => {
  const root = setupHookRoot()
  type ShareProps = ComponentProps<typeof SharePanel>
  const share = () => screen.share.mock.lastCall?.[0] as ShareProps

  async function show(client: QueryClient, tab: typeof screen.tab) {
    screen.tab = tab
    const Component = Route.options.component
    if (!Component) throw new Error('Missing Portal screen')
    await root.render(
      createElement(QueryClientProvider, { client }, createElement(Component)),
    )
  }

  it.each([
    ['replacement', rotatePortalToken, 'rotateTokenMutation'],
    ['revocation', revokePortalTokens, 'revokeTokenMutation'],
  ] as const)(
    'keeps a deferred code %s pending and retains its refusal after leaving Share',
    async (_name, command, actionName) => {
      screen.mounted = true
      const client = clientWithPortal()
      client.setQueryData(portalKeys.responsibleManagers('portal-1'), { assignments: [] })
      client.setQueryData(['members'], { members: [] })
      client.setQueryData(portalKeys.publicationHistory('portal-1'), { current: null })
      const refusal = new Error('Code command refused')
      let reject!: (error: Error) => void
      vi.mocked(command).mockImplementationOnce(
        () =>
          new Promise<never>((_resolve, fail) => {
            reject = fail
          }),
      )
      await show(client, 'share')
      let pending!: Promise<unknown>
      await act(async () => {
        const action = share()[actionName]
        pending = action({
          data: {
            portalId: 'portal-1',
            reason: 'security',
          },
        }).catch((error: unknown) => error)
      })
      await root.flush()
      expect(command).toHaveBeenCalledTimes(1)
      expect(share()[actionName].isPending).toBe(true)

      await show(client, 'history')
      screen.share.mockClear()
      await show(client, 'share')
      expect(share()[actionName].isPending).toBe(true)

      await show(client, 'history')
      await act(async () => {
        reject(refusal)
        expect(await pending).toBe(refusal)
      })
      await show(client, 'share')
      expect(share()[actionName].isPending).toBe(false)
      expect(share()[actionName].error).toBe(refusal)

      await show(client, 'history')
      await show(client, 'share')
      expect(share()[actionName].error).toBe(refusal)
      client.clear()
    },
  )
})
describe('Portal tab reads', () => {
  it('keeps a header history failure local while Results remains usable', async () => {
    const client = clientWithPortal()
    await client
      .fetchQuery({
        queryKey: portalKeys.publicationHistory('portal-1'),
        queryFn: () => Promise.reject(new Error('history failed')),
      })
      .catch(() => undefined)
    const header = renderToStaticMarkup(
      createElement(
        QueryClientProvider,
        { client },
        createElement(PortalWorkspaceHeaderSlot, {
          propertyId: 'property-1',
          portalId: 'portal-1',
          reviewing: false,
          activeTab: 'results',
        }),
      ),
    )
    expect(header).toContain('portal status couldn’t be loaded.')
    expect(header).toContain('Try again')
    expect(header).not.toContain('Review &amp; publish')
    screen.tab = 'results'
    expect(render(client)).toContain('Results ready')
  })

  it('lets Share wait locally without starting Page or History queries', () => {
    const client = clientWithPortal()
    expect(render(client)).toContain('Loading sharing details')
    expect(
      client
        .getQueryCache()
        .find({ queryKey: portalKeys.responsibleManagers('portal-1') }),
    ).toBeDefined()
    for (const key of [
      portalKeys.links('portal-1'),
      portalKeys.publicationHistory('portal-1'),
      portalKeys.experience('property-1', 'portal-1'),
    ]) {
      expect(client.getQueryCache().find({ queryKey: key })).toBeUndefined()
    }
  })
  it('renders Share with its token, property and responsible managers', () => {
    const client = clientWithPortal()
    const managers = { assignments: [{ userId: 'u1' }] }
    const members = [{ userId: 'u1', name: 'Ana' }]
    client.setQueryData(portalKeys.responsibleManagers('portal-1'), managers)
    client.setQueryData(['members'], { members })
    expect(render(client)).toContain('Share ready')
    expect(screen.share).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenStatus: token,
        propertyTimeZone: 'Europe/Sofia',
        propertyCountryCode: 'BG',
        responsibleManagers: managers,
        responsibleManagerMembers: members,
      }),
    )
  })
  it('does not block Results on a failed Page resource', async () => {
    const client = clientWithPortal()
    await client
      .fetchQuery({
        queryKey: portalKeys.links('portal-1'),
        queryFn: () => Promise.reject(new Error('links failed')),
      })
      .catch(() => undefined)
    screen.tab = 'results'
    expect(render(client)).toContain('Results ready')
    expect(screen.results).toHaveBeenCalledWith(
      expect.objectContaining({ portal, tokenStatus: token }),
    )
    expect(
      client
        .getQueryCache()
        .find({ queryKey: portalKeys.responsibleManagers('portal-1') }),
    ).toBeUndefined()
  })
  it('keeps a failed Page read local and lets the user switch to History', async () => {
    const client = clientWithPortal()
    await client
      .fetchQuery({
        queryKey: portalKeys.links('portal-1'),
        queryFn: () => Promise.reject(new Error('private backend detail')),
      })
      .catch(() => undefined)
    screen.tab = 'page'
    const html = render(client)
    expect(html).toContain('page settings couldn’t be loaded.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('private backend detail')
    screen.tab = 'history'
    client.setQueryData(portalKeys.publicationHistory('portal-1'), { current: null })
    expect(render(client)).toContain('History ready')
  })
})
