import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'

// A property id this old link does not carry in a readable form is dropped:
// the link still redirects (to the properties list) instead of failing.
const progressSearch = z.object({
  propertyId: z.uuid().optional().catch(undefined),
})

/** Retained URL compatibility; redirects to the canonical Property Goal list. */
export const Route = createFileRoute('/_authenticated/progress')({
  validateSearch: progressSearch,
  beforeLoad: ({ context, search }) => {
    if (!search.propertyId || !can((context as AuthRouteContext).role, 'goal.read')) {
      throw redirect({ to: '/properties' })
    }

    throw redirect({
      to: '/properties/$propertyId/goals',
      params: { propertyId: search.propertyId },
    })
  },
})
