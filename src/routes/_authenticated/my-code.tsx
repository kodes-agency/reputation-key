import { createFileRoute } from '@tanstack/react-router'
import { validateStaffHomeSearch } from '#/shared/staff-home-search'

export const Route = createFileRoute('/_authenticated/my-code')({
  validateSearch: validateStaffHomeSearch,
  staticData: { page: { title: 'My code', tier: 'narrow' } },
  beforeLoad: async ({ location, context }) => {
    const { staffHomeEntry } = await import('../-staff-home-entry')
    return staffHomeEntry(location.href, context?.queryClient)
  },
})
