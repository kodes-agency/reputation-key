import { createFileRoute, redirect } from '@tanstack/react-router'
import { z } from 'zod/v4'

const recognitionSettingsSearch = z.object({
  propertyId: z.uuid().optional(),
})

/**
 * Recognition is a post-core program (REC-01), not a beta capability. Keep the
 * route so stale bookmarks receive an honest state, but never load or mutate
 * the legacy recognition model from the beta application shell.
 */
export const Route = createFileRoute('/_authenticated/settings/recognition')({
  validateSearch: recognitionSettingsSearch,
  beforeLoad: () => {
    // `badge.use` is legacy_blocked in CAPABILITY_FATE, so the refusal category
    // is fixed and needs no policy read.
    throw redirect({
      to: '/unavailable',
      search: { feature: 'Recognition', category: 'not_in_beta' },
    })
  },
})
