import { createFileRoute } from '@tanstack/react-router'
import { validateStaffHomeSearch } from '#/shared/staff-home-search'

export const Route = createFileRoute('/my')({
  validateSearch: validateStaffHomeSearch,
  beforeLoad: async ({ location }) => {
    const { staffHomeEntry } = await import('./-staff-home-entry')
    return staffHomeEntry(location.href)
  },
  head: () => ({
    meta: [{ title: 'My code | Reputation Key' }],
    links: [{ rel: 'manifest', href: '/staff.webmanifest' }],
  }),
})
