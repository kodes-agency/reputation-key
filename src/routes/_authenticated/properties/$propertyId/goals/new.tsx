// Keep old links and bookmarks working through the add-sheet redirect without loading a
// form.

import { createFileRoute, redirect } from '@tanstack/react-router'
import { goalNewRedirect } from './-goal-new-redirect'

export const Route = createFileRoute('/_authenticated/properties/$propertyId/goals/new')({
  beforeLoad: ({ params, location }) => {
    throw redirect({
      to: '/properties/$propertyId/goals/portals',
      params,
      search: goalNewRedirect(location.search),
      replace: true,
    })
  },
})
