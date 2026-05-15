// Shared types for portal feature components.
// Extracted from portal-detail-page, portal-settings, and edit-portal-form
// to eliminate duplication and ensure consistency.

export type FormLike = { handleSubmit: () => void }

export type PortalData = Readonly<{
  id: string
  name: string
  slug: string
  description: string | null
  heroImageUrl: string | null
  theme: { primaryColor: string }
  smartRoutingEnabled: boolean
  smartRoutingThreshold: number
  isActive: boolean
}>

export type UpdatePortalVariables = {
  data: {
    portalId: string
    name?: string
    slug?: string
    description?: string | null
    theme?: { primaryColor: string }
    smartRoutingEnabled?: boolean
    smartRoutingThreshold?: number
    isActive?: boolean
  }
}
