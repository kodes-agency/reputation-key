import { createFileRoute, redirect } from '@tanstack/react-router'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'
import { can } from '#/shared/domain/permissions'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/teams/')({
  beforeLoad: async ({ context, params }) => {
    await gateControlledRoute({
      data: {
        capability: 'team.use',
        featureLabel: 'Teams',
        propertyId: params.propertyId,
      },
    })
    if (!can((context as AuthRouteContext).role, 'team.read')) {
      throw redirect({ to: '/properties' })
    }
    throw redirect({
      to: '/properties/$propertyId/people',
      params: { propertyId: params.propertyId },
      search: { tab: 'teams' },
    })
  },
})
