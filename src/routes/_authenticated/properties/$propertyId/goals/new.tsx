// The old New goal page's address (PLAN PG-20). The page is gone: a goal for one
// Portal, for each, for a group, or the average is added from "Add a portal
// goal" on the Monthly portal goal's page, and this route only sends an old link
// or bookmark there, on the step it asked for (`-goal-new-redirect.ts`). No
// component, loader or search schema: the redirect is all that loads.
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
