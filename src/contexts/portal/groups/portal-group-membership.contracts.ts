// Portal context — portal group membership DTOs
// Per architecture: "Zod schema for HTTP input, also reused as the form schema."

import { z } from 'zod/v4'

/** One Portal and the group it joins, leaves or moves to. */
export const portalGroupMemberSchema = z.object({
  portalGroupId: z.string().min(1),
  portalId: z.string().min(1),
})

export type PortalGroupMemberInput = z.infer<typeof portalGroupMemberSchema>

/** The "Add portals" dialog: which Portals to bring into the group. */
export const addPortalsToGroupFormSchema = z.object({
  portalIds: z.array(z.string().min(1)).min(1, 'Choose at least one portal'),
})
