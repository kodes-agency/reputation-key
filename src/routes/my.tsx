import { createFileRoute } from '@tanstack/react-router'
import { validateStaffHomeSearch } from '#/shared/staff-home-search'

export const Route = createFileRoute('/my')({
  validateSearch: validateStaffHomeSearch,
  beforeLoad: async ({ location, context }) => {
    const { staffHomeEntry } = await import('./-staff-home-entry')
    return staffHomeEntry(location.href, context?.queryClient)
  },
  head: () => ({
    meta: [{ title: 'My code | Reputation Key' }],
    links: [{ rel: 'manifest', href: '/staff.webmanifest' }],
  }),
})
