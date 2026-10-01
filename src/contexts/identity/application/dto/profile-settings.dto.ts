import { z } from 'zod/v4'
import { identityAssetKeyFromPath } from '../identity-assets'

export const updateProfileInputSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name must be 100 characters or less'),
})

/**
 * An avatar is a URL, or the path an uploaded one is stored at on the app
 * itself (see identity-assets.ts), which carries no host.
 */
export const updateUserImageInputSchema = z.object({
  imageUrl: z.union([
    z.url(),
    z.string().refine((path) => identityAssetKeyFromPath(path)?.startsWith('avatars/')),
  ]),
})

export type UpdateProfileInput = z.infer<typeof updateProfileInputSchema>
