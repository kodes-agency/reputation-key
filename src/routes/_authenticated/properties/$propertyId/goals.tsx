// Goals layout route — renders <Outlet /> for child routes (index, new, $goalId)
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { gateControlledRoute } from '#/shared/auth/controlled-route-gate'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals')({
  beforeLoad: async ({ params }) => {
    await gateControlledRoute({
      data: {
        capability: 'goal.use',
        featureLabel: 'Goals',
        propertyId: params.propertyId,
      },
    })
  },
  component: () => <Outlet />,
})
