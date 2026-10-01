// New portal dialog — the shapes its parts share.
import type { GuestLocale } from '#/shared/domain/guest-locale'
import type { Action } from '#/components/hooks/use-action'
import type { CreatePortalInput } from '#/contexts/portal/application/dto/create-portal.dto'
import type { PortalManagerName } from '../portal-overview/portal-overview-view'
import type { PortalNewOptions } from './portal-new-rules'

/** A TanStack Form field, as far as the dialog's inputs read it. */
export type PortalNewField<TValue> = Readonly<{
  name: string
  state: Readonly<{
    value: TValue
    meta: Readonly<{
      isTouched: boolean
      isValid: boolean
      errors: Array<{ message?: string } | undefined>
    }>
  }>
  handleBlur: () => void
  handleChange: (value: TValue) => void
}>

/** A portal of the Property that can be copied (a `PortalOverviewRow` fits). */
export type PortalNewSource = Readonly<{
  portalId: string
  name: string
  primaryGuestLocale: GuestLocale
  additionalGuestLocales: readonly GuestLocale[]
}>

/** A group the new portal can join. */
export type PortalNewGroup = Readonly<{ id: string; name: string }>

/** Everything the form reads once the Property's options have loaded. */
export type PortalNewData = Readonly<{
  propertyId: string
  propertyName: string
  options: PortalNewOptions
  groups: readonly PortalNewGroup[]
  sources: readonly PortalNewSource[]
  /** Names for the managers a portal can be given to; may be empty. */
  members: readonly PortalManagerName[]
  /** The signed-in person, who is responsible by default when eligible. */
  creatorId: string
  mutation: Action<{ data: CreatePortalInput }>
}>
