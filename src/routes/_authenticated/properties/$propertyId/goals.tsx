// Goals layout route — renders <Outlet /> for child routes (index, new, $goalId)
import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals')({
  component: () => <Outlet />,
})
