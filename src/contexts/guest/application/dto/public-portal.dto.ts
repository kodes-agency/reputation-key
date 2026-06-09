// F066: Re-export ScanSource from domain/types instead of duplicating the union
export type { ScanSource } from '../../domain/types'

export type PublicPortalLoaderData = {
  portal: {
    id: string
    name: string
    slug: string
    description: string | null
    heroImageUrl: string | null
    theme: Record<string, string | number | boolean | null> | null
    smartRoutingEnabled: boolean
    smartRoutingThreshold: number
    organizationName: string
  }
  categories: ReadonlyArray<{ id: string; title: string; sortKey: string }>
  links: ReadonlyArray<{
    id: string
    label: string
    url: string
    categoryId: string | null
    sortKey: string
  }>
  organizationId: string
  propertyId: string
}
