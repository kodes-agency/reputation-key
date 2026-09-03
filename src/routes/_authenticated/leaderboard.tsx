import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'

const achievementBoardSearch = z.object({
  propertyId: z.uuid().optional(),
  portalGroupId: z.uuid().optional(),
})

/**
 * The legacy Leaderboard/Recognition model is not an initial-beta capability.
 * Keep the address for stale bookmarks, but do not read or reconcile the
 * post-core model from an interactive beta route.
 */
export const Route = createFileRoute('/_authenticated/leaderboard')({
  validateSearch: achievementBoardSearch,
  beforeLoad: () => {
    // `leaderboard.use` is legacy_blocked in CAPABILITY_FATE, so the refusal
    // category is fixed and needs no policy read.
    throw redirect({
      to: '/unavailable',
      search: { feature: 'Achievement Board', category: 'not_in_beta' },
    })
  },
})
