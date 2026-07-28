// Goals layout route — renders <Outlet /> for child routes (index, new, $goalId)
import { createFileRoute, Outlet } from '@tanstack/react-router'
import { gateDarkRoute } from '#/shared/auth/dark-route-gate'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals')({
  beforeLoad: async () => {
    await gateDarkRoute({ data: { capability: 'goal.use', featureLabel: 'Goals' } })
  },
  component: () => <Outlet />,
})
