import type { GoogleConnectionId, OrganizationId, PropertyId } from '#/shared/domain/ids'
import type { GoogleConnection } from '../domain/types'
import { GOOGLE_BUSINESS_MANAGE_SCOPE } from './google-provider-contract'

export type GooglePropertyAuthorizationView = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  state: string
  connectionId: GoogleConnectionId | null
  locationId: string | null
  sourceEpoch: number
  profileVersion: number
  profileSource: 'legacy' | 'tenant_confirmed'
  profileConfirmedAt: Date | null
  lifecycleState: string
  deletedAt: Date | null
}>

export type GooglePropertyAuthorizationReader = Readonly<{
  readBinding(
    organizationId: OrganizationId,
    propertyId: PropertyId,
  ): Promise<GooglePropertyAuthorizationView | null>
  findConnection(
    organizationId: OrganizationId,
    connectionId: GoogleConnectionId,
  ): Promise<GoogleConnection | null>
}>

type PropertyAuthorizationScope = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  connectionId: GoogleConnectionId
  sourceEpoch: number
}>

type CurrentBinding = GooglePropertyAuthorizationView & {
  connectionId: GoogleConnectionId
  locationId: string
}

function currentBinding(
  binding: GooglePropertyAuthorizationView | null,
  input: PropertyAuthorizationScope,
): binding is CurrentBinding {
  return Boolean(
    binding &&
    binding.organizationId === input.organizationId &&
    binding.propertyId === input.propertyId &&
    binding.connectionId === input.connectionId &&
    binding.locationId &&
    binding.sourceEpoch === input.sourceEpoch &&
    binding.state === 'active' &&
    binding.lifecycleState === 'active' &&
    binding.deletedAt === null,
  )
}

export function googleConnectionHasUsableCredential(
  connection: GoogleConnection,
): boolean {
  return (
    connection.status === 'active' &&
    connection.credentialUseState === 'active' &&
    connection.scopes.includes(GOOGLE_BUSINESS_MANAGE_SCOPE)
  )
}

/** Reads authority afresh on each side of token access, scoped to the requested tenant. */
export async function readGooglePropertyAuthorization(
  deps: GooglePropertyAuthorizationReader,
  input: PropertyAuthorizationScope,
): Promise<
  | Readonly<{ ok: true; binding: CurrentBinding; connection: GoogleConnection }>
  | Readonly<{
      ok: false
      code: 'runtime_unavailable' | 'stale_source' | 'authorization_denied'
    }>
> {
  let binding: GooglePropertyAuthorizationView | null
  let connection: GoogleConnection | null
  try {
    ;[binding, connection] = await Promise.all([
      deps.readBinding(input.organizationId, input.propertyId),
      deps.findConnection(input.organizationId, input.connectionId),
    ])
  } catch {
    return { ok: false, code: 'runtime_unavailable' }
  }
  if (!currentBinding(binding, input)) return { ok: false, code: 'stale_source' }
  // A missing or foreign connection is an inconsistency, not a grant awaiting reconnect.
  if (
    !connection ||
    connection.organizationId !== input.organizationId ||
    connection.id !== input.connectionId
  ) {
    return { ok: false, code: 'authorization_denied' }
  }
  return { ok: true, binding, connection }
}
