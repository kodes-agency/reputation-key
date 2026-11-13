import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createKeys, inboxKeys } from '#/shared/queries/query-keys'

const server = vi.hoisted(() => ({
  organization: vi.fn(),
  policy: vi.fn(),
  google: vi.fn(),
  feedback: vi.fn(),
}))
vi.mock('#/contexts/identity/server/organizations', () => ({
  getActiveOrganization: server.organization,
  updateOrganization: vi.fn(),
  requestOrgLogoUpload: vi.fn(),
  finalizeOrgLogoUpload: vi.fn(),
}))
vi.mock('#/contexts/inbox/server/inbox', () => ({
  getResponseTargetPolicySettingsFn: server.policy,
  getGoogleReviewTargetAnalyticsFn: server.google,
  getPrivateFeedbackTargetAnalyticsFn: server.feedback,
  setResponseTargetPolicyFn: vi.fn(),
}))
vi.mock('#/shared/hooks/useTenantScope', () => ({
  useTenantScope: () => ({ userId: 'user-1', organizationId: 'org-1' }),
}))
vi.mock('#/components/hooks/use-action-mutation', () => ({
  useActionMutation: () => Object.assign(vi.fn(), { isPending: false }),
}))
vi.mock('#/components/layout/page-header', () => ({ PageHeader: () => null }))
vi.mock('#/components/features/organization', () => ({
  OrganizationSettingsPage: ({ responseTargets }: { responseTargets: ReactNode }) =>
    createElement('main', null, 'Organization identity form', responseTargets),
}))
vi.mock('#/contexts/reputation/response-targets/ui/settings-card', () => ({
  ResponseTargetSettingsCard: ({
    googleReviewSummary,
    privateFeedbackSummary,
  }: {
    googleReviewSummary: ReactNode
    privateFeedbackSummary: ReactNode
  }) =>
    createElement(
      'section',
      null,
      'Response policy forms',
      googleReviewSummary,
      privateFeedbackSummary,
    ),
}))
vi.mock('#/contexts/reputation/response-targets/ui/analytics-summary', () => ({
  GoogleReviewTargetSummary: () => createElement('p', null, 'Google performance ready'),
  PrivateFeedbackTargetSummary: () =>
    createElement('p', null, 'Feedback performance ready'),
}))

import { Route } from './organization'
const scope = { userId: 'user-1', organizationId: 'org-1' }
const context = (queryClient: QueryClient) => ({
  queryClient,
  user: { id: scope.userId },
  activeOrganization: { id: scope.organizationId },
})
function load(client: QueryClient) {
  const loader = Route.options.loader
  if (typeof loader !== 'function') throw new Error('Missing organization loader')
  return loader({ context: context(client) } as never)
}
function render(client: QueryClient) {
  const Component = Route.options.component
  if (!Component) throw new Error('Missing organization screen')
  return renderToStaticMarkup(
    createElement(QueryClientProvider, { client }, createElement(Component)),
  )
}
function clientWithIdentity() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(createKeys(scope).identityKeys.activeOrg(), {
    organization: { id: 'org-1', name: 'Hotel' },
  })
  return client
}

beforeEach(() => {
  vi.resetAllMocks()
  server.organization.mockResolvedValue({ organization: { id: 'org-1', name: 'Hotel' } })
})
describe('organization section loading', () => {
  it('resolves identity without starting ancillary reads that would reject or wait', async () => {
    server.policy.mockRejectedValue(new Error('policy failed'))
    server.google.mockRejectedValue(new Error('analytics failed'))
    server.feedback.mockReturnValue(new Promise(() => undefined))
    await expect(load(new QueryClient())).resolves.toBeUndefined()
    expect(server.organization).toHaveBeenCalledOnce()
    expect(server.policy).not.toHaveBeenCalled()
    expect(server.google).not.toHaveBeenCalled()
    expect(server.feedback).not.toHaveBeenCalled()
  })
  it('keeps identity visible while response settings are pending', () => {
    const html = render(clientWithIdentity())
    expect(html).toContain('Organization identity form')
    expect(html).toContain('Loading response targets')
  })
  it('keeps policy forms and the other performance section when Google analytics fails', async () => {
    const client = clientWithIdentity()
    client.setQueryData(inboxKeys.responseTargetPolicies(), { organization: {} })
    client.setQueryData(inboxKeys.privateFeedbackTargetAnalytics(), {
      measuredCycleCount: 3,
    })
    await client
      .fetchQuery({
        queryKey: inboxKeys.googleReviewTargetAnalytics(),
        queryFn: () => Promise.reject(new Error('secret backend detail')),
      })
      .catch(() => undefined)
    const html = render(client)
    expect(html).toContain('Organization identity form')
    expect(html).toContain('Response policy forms')
    expect(html).toContain('Feedback performance ready')
    expect(html).toContain('Google review performance couldn’t be loaded.')
    expect(html).toContain('Try again')
    expect(html).not.toContain('secret backend detail')
  })
  it('keeps identity when policy settings fail and offers local recovery', async () => {
    const client = clientWithIdentity()
    await client
      .fetchQuery({
        queryKey: inboxKeys.responseTargetPolicies(),
        queryFn: () => Promise.reject(new Error('policy failed')),
      })
      .catch(() => undefined)
    const html = render(client)
    expect(html).toContain('Organization identity form')
    expect(html).toContain('response targets couldn’t be loaded.')
    expect(html).toContain('Try again')
  })
})
