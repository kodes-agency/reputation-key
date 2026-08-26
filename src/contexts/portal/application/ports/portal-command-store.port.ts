// Portal command store — one authoritative state + lifecycle-fact boundary.
//
// Production commits each command's Portal rows and every required outbox row
// in one regional PostgreSQL transaction. The in-process bus is emitted only
// after commit and is never the recovery authority.

import type { OrganizationId, PortalId, PropertyId, UserId } from '#/shared/domain/ids'
import type { Portal } from '../../domain/types'
import type {
  PortalPublicationActivation,
  PortalPublicationSnapshot,
} from '../../domain/portal-publication-snapshot'
import type {
  PortalCreated,
  PortalDeleted,
  PortalResponsibilityNeeded,
  PortalTokenRevoked,
  PortalUpdated,
} from '../../domain/events'

export type CreatePortalCommand = Readonly<{
  organizationId: OrganizationId
  portal: Portal
  initialResponsibleManagerId: UserId | null
  event: PortalCreated
  responsibilityNeededEvent?: PortalResponsibilityNeeded
}>

export type UpdatePortalCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  /** Optimistic fence captured by the application pre-read. */
  expectedUpdatedAt: Date
  patch: Readonly<Partial<Portal>>
  publication?: PortalPublicationMutation
  event: PortalUpdated
}>

export type PortalPublicationMutation =
  | Readonly<{
      kind: 'publish'
      snapshot: PortalPublicationSnapshot
      activation: PortalPublicationActivation & Readonly<{ kind: 'publish' }>
    }>
  | Readonly<{
      kind: 'rollback'
      snapshotId: string
      snapshotVersion: number
      activation: PortalPublicationActivation & Readonly<{ kind: 'rollback' }>
    }>
  | Readonly<{
      kind: 'deactivate'
      reason: 'disabled' | 'archived'
      at: Date
    }>

export type DeletePortalCommand = Readonly<{
  organizationId: OrganizationId
  propertyId: PropertyId
  portalId: PortalId
  /** Optimistic fence captured by the application pre-read. */
  expectedUpdatedAt: Date
  revokedBy: UserId
  reason: string
  at: Date
  event: PortalDeleted
  /** Recorded only when the transaction actually revokes a live token. */
  tokenRevokedEvent: PortalTokenRevoked
}>

export type PortalCommandStore = Readonly<{
  createPortal(command: CreatePortalCommand): Promise<void>
  updatePortal(command: UpdatePortalCommand): Promise<void>
  deletePortal(command: DeletePortalCommand): Promise<Readonly<{ revoked: number }>>
}>
