import { createFileRoute } from '@tanstack/react-router'
import { validateStaffHomeSearch } from '#/shared/staff-home-search'

export const Route = createFileRoute('/my')({
  validateSearch: validateStaffHomeSearch,
  beforeLoad: async ({ location, context }) => {
    const { staffHomeEntry } = await import('./-staff-home-entry')
    return staffHomeEntry(location.href, context?.queryClient)
  },
  head: () => ({
    meta: [
      // The phone surface paints under the home indicator and the notch, and keeps
      // clear of them itself.
      {
        name: 'viewport',
        content: 'width=device-width, initial-scale=1, viewport-fit=cover',
      },
      { title: 'My code | Reputation Key' },
      { name: 'apple-mobile-web-app-title', content: 'My code' },
    ],
    links: [
      { rel: 'manifest', href: '/staff.webmanifest' },
      { rel: 'apple-touch-icon', href: '/icons/apple-touch-icon.png' },
    ],
  }),
})
