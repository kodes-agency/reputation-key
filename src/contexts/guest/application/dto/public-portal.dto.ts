export type ScanSource = 'qr' | 'nfc' | 'direct'

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
  categories: Array<{ id: string; title: string; sortKey: string }>
  links: Array<{
    id: string
    label: string
    url: string
    categoryId: string
    sortKey: string
  }>
  organizationId: string
  propertyId: string
}
