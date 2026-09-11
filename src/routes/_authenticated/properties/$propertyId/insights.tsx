import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * `/insights` became `/guests` when the dashboard split into topic pages
 * (redesign rows 1, 2). The redirect is permanent, not transitional: bookmarks
 * and any link in the wild keep working, and the old numeric `?range=` is
 * dropped so the new page applies its own default rather than inheriting a
 * value from a vocabulary that no longer exists.
 */
export const Route = createFileRoute('/_authenticated/properties/$propertyId/insights')({
  beforeLoad: ({ params: { propertyId } }) => {
    throw redirect({
      to: '/properties/$propertyId/guests',
      params: { propertyId },
      replace: true,
    })
  },
})
