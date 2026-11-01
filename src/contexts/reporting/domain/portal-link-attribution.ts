import { z } from 'zod/v4'
import type { PortalDestinationKind } from './portal-lifetime-aggregate'

const linkIdSchema = z.uuid()

/** Old or synthetic destination ids cannot become a PostgreSQL uuid. */
export function secondaryPortalLinkId(
  destinationKind: PortalDestinationKind | null | undefined,
  linkId: string | null | undefined,
): string | null {
  if (destinationKind !== 'secondary_link') return null
  const parsed = linkIdSchema.safeParse(linkId)
  return parsed.success ? parsed.data.toLowerCase() : null
}
