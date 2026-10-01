/** A group as the property's group list reads it: its id, name and the Portals in it today. */
export type PortalGroupView = Readonly<{
  id: string
  name: string
  portalIds: readonly string[]
}>
