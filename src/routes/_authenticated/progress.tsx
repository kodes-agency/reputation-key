import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'
import type { AuthRouteContext } from '#/routes/_authenticated'
import { can } from '#/shared/domain/permissions'

const progressSearch = z.object({
  propertyId: z.uuid().optional(),
})

/** Retained URL compatibility; redirects to the canonical Property Goal list. */
export const Route = createFileRoute('/_authenticated/progress')({
  validateSearch: progressSearch,
  beforeLoad: ({ context, search }) => {
    if (!search.propertyId || !can((context as AuthRouteContext).role, 'goal.read')) {
      throw redirect({ to: '/dashboard' })
    }

    throw redirect({
      to: '/properties/$propertyId/goals',
      params: { propertyId: search.propertyId },
    })
  },
})
