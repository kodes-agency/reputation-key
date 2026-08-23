import { createFileRoute, redirect } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { z } from 'zod/v4'
import { PageHeader } from '#/components/layout/page-header'
import { useActionMutation } from '#/components/hooks/use-action-mutation'
import { MerchantAiSettingsPage } from '#/components/features/settings'
import {
  changeMerchantAiCapabilitiesFn,
  enableMerchantAiFn,
  getMerchantAiAuthorizationFn,
  revokeMerchantAiFn,
} from '#/contexts/identity/server/merchant-ai'
import { updateProperty } from '#/contexts/property/server/properties'
import { MERCHANT_AI_NOTICE } from '#/contexts/identity/application/dto/merchant-ai-notice.dto'
import { can } from '#/shared/domain/permissions'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { propertiesQuery } from '#/routes/-queries/route-queries'
import { inboxKeys, propertyKeys } from '#/shared/queries/query-keys'

const merchantAiSearch = z.object({
  propertyId: z.string().uuid().optional(),
})

export const Route = createFileRoute('/_authenticated/settings/ai')({
  validateSearch: merchantAiSearch,
  beforeLoad: ({ context }) => {
    const { role } = context as AuthRouteContext
    if (!can(role, 'ai.manage')) throw redirect({ to: '/settings/profile' })
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => {
    const { properties } = await context.queryClient.ensureQueryData(propertiesQuery)
    const property = deps.propertyId
      ? properties.find((candidate) => candidate.id === deps.propertyId)
      : undefined
    if (deps.propertyId && !property) throw redirect({ to: '/settings/ai', search: {} })
    if (!deps.propertyId) return { authorization: null, notice: MERCHANT_AI_NOTICE }
    return getMerchantAiAuthorizationFn({ data: { propertyId: deps.propertyId } })
  },
  component: MerchantAiSettingsRoute,
})

function MerchantAiSettingsRoute() {
  const navigate = Route.useNavigate()
  const { propertyId } = Route.useSearch()
  const { authorization, notice } = Route.useLoaderData()
  const { data } = useSuspenseQuery(propertiesQuery)
  const enable = useActionMutation(enableMerchantAiFn, {
    successMessage: 'AI features enabled for this property',
  })
  const change = useActionMutation(changeMerchantAiCapabilitiesFn, {
    successMessage: 'AI feature access updated',
  })
  const revoke = useActionMutation(revokeMerchantAiFn, {
    successMessage: 'AI features turned off for this property',
  })
  const updateReplyLanguage = useActionMutation(updateProperty, {
    successMessage: 'Property reply language updated',
    invalidateKeys: [
      propertyKeys.list(),
      ...(propertyId ? [propertyKeys.detail(propertyId)] : []),
      inboxKeys.details(),
    ],
  })

  return (
    <>
      <PageHeader
        title="AI & replies"
        description="Set each property's reply language and control AI-assisted review processing."
        breadcrumbs={[{ label: 'Settings', to: '/settings' }, { label: 'AI & replies' }]}
      />
      <div className="mt-6">
        <MerchantAiSettingsPage
          key={propertyId ?? 'no-property'}
          properties={data.properties}
          propertyId={propertyId}
          snapshot={authorization}
          notice={notice}
          onPropertyChange={(nextPropertyId) =>
            navigate({ to: '/settings/ai', search: { propertyId: nextPropertyId } })
          }
          enable={enable}
          change={change}
          revoke={revoke}
          updateProperty={updateReplyLanguage}
        />
      </div>
    </>
  )
}
