import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'

const achievementBoardSearch = z.object({
  propertyId: z.string().uuid().optional(),
  portalGroupId: z.string().uuid().optional(),
})

/**
 * The legacy Leaderboard/Recognition model is not an initial-beta capability.
 * Keep the address for stale bookmarks, but do not read or reconcile the
 * post-core model from an interactive beta route.
 */
export const Route = createFileRoute('/_authenticated/leaderboard')({
  validateSearch: achievementBoardSearch,
  beforeLoad: () => {
    throw redirect({
      to: '/unavailable',
      search: { feature: 'Achievement Board' },
    })
  },
})
