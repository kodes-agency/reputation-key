import type { Capability } from '#/shared/governance/capability-fate'

// Deliberately finite: copy validation checks these against Lucide and the router.
export const PRODUCT_UPDATE_ICONS = [
  'MessageCircle',
  'MessagesSquare',
  'ListFilter',
  'Check',
] as const
export const PRODUCT_UPDATE_ROUTES = [
  '/properties/$propertyId/guests',
  '/properties/$propertyId/settings/replies',
  '/inbox',
] as const

export type ProductUpdate = Readonly<{
  id: string
  publishedOn: string
  kind: 'highlight' | 'fix'
  audience: 'everyone' | 'account-admins'
  requires?: Readonly<{ capability?: Capability }>
  title: string
  body: string
  icon: (typeof PRODUCT_UPDATE_ICONS)[number]
  showMe?: Readonly<{
    to: (typeof PRODUCT_UPDATE_ROUTES)[number]
    needsProperty?: boolean
  }>
}>

export type ProductUpdatesView = Readonly<{
  entries: readonly ProductUpdate[]
  unseenIds: readonly string[]
  autoShow: boolean
  shouldAutoOpen: boolean
}>

export type ProductUpdatesClient = Readonly<{
  get: (input: { data: { propertyId?: string } }) => Promise<ProductUpdatesView>
  claim: (input: { data: { propertyId?: string } }) => Promise<boolean>
  markSeen: (input: {
    data: { propertyId?: string; entryIds: string[] }
  }) => Promise<void>
  setAutoShow: (input: { data: { autoShow: boolean } }) => Promise<void>
}>
export type ProductUpdatesClientGetter = () => Promise<ProductUpdatesClient>
